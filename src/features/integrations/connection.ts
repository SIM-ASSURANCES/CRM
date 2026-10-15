import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { INITIAL_SYNC_DAYS, OAUTH_STATE_TTL_MINUTES, PROVIDER_MICROSOFT, SYNC_EVENTS_SHOWN, TOKEN_REFRESH_MARGIN_SECONDS } from "@/features/integrations/config";
import { GraphError } from "@/features/integrations/microsoft/graph";
import { authorizeUrl, exchangeCode, generatePkce, generateState, OAuthError, refreshAccessToken } from "@/features/integrations/microsoft/oauth";
import { clock, redirectUri, type IntegrationDeps, type IntegrationSetup } from "@/features/integrations/setup";
import { createNotifications } from "@/features/notifications/service";
import type { IntegrationConnection } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Connexion d'un utilisateur à sa messagerie Microsoft 365 (CDC 7.3) : consentement OAuth explicite, jetons chiffrés en
// base, reconnexion guidée quand l'accès est révoqué. Les jetons ne quittent jamais ce module en clair, sauf pour
// l'appel à Microsoft qui en a besoin, et ne sont jamais écrits dans le journal ni l'audit.

/** L'accès Microsoft est révoqué ou expiré : l'utilisateur doit se reconnecter (la connexion passe à « À reconnecter »). */
export class ReconnectRequiredError extends Error {
  constructor(message = "La connexion Microsoft doit être refaite.") {
    super(message);
    this.name = "ReconnectRequiredError";
  }
}

function assertCanConnect(user: CurrentUser): void {
  if (!can(user.role, "integration:connect")) throw errors.forbidden();
}

const accessContext = (connectionId: string) => `${connectionId}:access`;
const refreshContext = (connectionId: string) => `${connectionId}:refresh`;

// --- Lecture (statut visible, CDC 7.3 et REC-11) ----------------------------------------------------------------

export type ConnectionView = {
  id: string;
  status: string;
  accountEmail: string | null;
  syncSince: Date;
  consentedAt: Date;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  /** Notifications Microsoft actives : la synchronisation est alors quasi immédiate. */
  realtime: boolean;
};

export type SyncEventView = {
  id: string;
  kind: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  fetched: number;
  imported: number;
  skipped: number;
  duplicates: number;
  error: string | null;
};

export function toConnectionView(connection: IntegrationConnection, now: Date = new Date()): ConnectionView {
  return {
    id: connection.id,
    status: connection.status,
    accountEmail: connection.accountEmail,
    syncSince: connection.syncSince,
    consentedAt: connection.consentedAt,
    lastSyncAt: connection.lastSyncAt,
    lastSuccessAt: connection.lastSuccessAt,
    lastError: connection.lastError,
    realtime: Boolean(connection.subscriptionId && connection.subscriptionExpiresAt && connection.subscriptionExpiresAt > now),
  };
}

/** Connexion de l'utilisateur de la session (jamais celle d'un autre : l'identifiant vient de la session). */
export async function getMyConnection(user: CurrentUser): Promise<ConnectionView | null> {
  assertCanConnect(user);
  const connection = await db.integrationConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: PROVIDER_MICROSOFT } } });
  return connection ? toConnectionView(connection) : null;
}

export async function listMyEvents(user: CurrentUser, take: number = SYNC_EVENTS_SHOWN): Promise<SyncEventView[]> {
  assertCanConnect(user);
  const events = await db.syncEvent.findMany({
    where: { userId: user.id, provider: PROVIDER_MICROSOFT },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take,
  });
  return events.map((event) => ({
    id: event.id,
    kind: event.kind,
    trigger: event.trigger,
    status: event.status,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    fetched: event.fetched,
    imported: event.imported,
    skipped: event.skipped,
    duplicates: event.duplicates,
    error: event.error,
  }));
}

export type ConnectionOverviewRow = {
  id: string;
  userName: string;
  userEmail: string;
  accountEmail: string | null;
  status: string;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  realtime: boolean;
};

/** Ordre d'affichage : les connexions à traiter d'abord. */
const OVERVIEW_PRIORITY: Record<string, number> = { needs_reconnect: 0, active: 1, revoked: 2 };

/**
 * Vue d'ensemble de TOUTES les connexions (REC-11) : qui est connecté, depuis quand tout va bien, qui doit se reconnecter.
 * Réservée à l'administration et à l'audit ; ne contient jamais de jeton ni de contenu de message.
 */
export async function listConnectionsOverview(user: CurrentUser, now: Date = new Date()): Promise<ConnectionOverviewRow[]> {
  if (!can(user.role, "settings:manage") && !can(user.role, "audit:read")) throw errors.forbidden();

  const rows = await db.integrationConnection.findMany({
    where: { provider: PROVIDER_MICROSOFT },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows
    .map((row) => ({
      id: row.id,
      userName: row.user.name,
      userEmail: row.user.email,
      accountEmail: row.accountEmail,
      status: row.status,
      lastSyncAt: row.lastSyncAt,
      lastSuccessAt: row.lastSuccessAt,
      lastError: row.lastError,
      realtime: toConnectionView(row, now).realtime,
    }))
    .sort((a, b) => (OVERVIEW_PRIORITY[a.status] ?? 3) - (OVERVIEW_PRIORITY[b.status] ?? 3));
}

// --- Connexion --------------------------------------------------------------------------------------------------

/**
 * Prépare le consentement : mémorise l'état anti-CSRF et le vérificateur PKCE, puis renvoie l'adresse de la page Microsoft.
 * L'état est lié à l'utilisateur, à usage unique et expire vite : un retour forgé ou rejoué est refusé.
 */
export async function beginMicrosoftConnection(user: CurrentUser, setup: IntegrationSetup, now: Date = new Date()): Promise<string> {
  assertCanConnect(user);
  const { verifier, challenge } = generatePkce();
  const state = generateState();

  await db.$transaction([
    // Ménage : demandes périmées de tous, et demandes en attente de cet utilisateur (une seule à la fois).
    db.oAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { userId: user.id, provider: PROVIDER_MICROSOFT }] } }),
    db.oAuthState.create({
      data: {
        state,
        userId: user.id,
        provider: PROVIDER_MICROSOFT,
        codeVerifier: verifier,
        expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  return authorizeUrl(setup.microsoft, { redirectUri: redirectUri(setup), state, challenge });
}

const hasMailScope = (scope: string) => scope.toLowerCase().split(/\s+/).some((s) => s.endsWith("mail.readbasic"));

/**
 * Retour de la page de consentement : vérifie l'état, échange le code contre des jetons, lit le profil, puis enregistre la
 * connexion (jetons chiffrés). Reconnecter le MÊME compte conserve les curseurs (aucun trou, aucun doublon) ; connecter un
 * AUTRE compte repart de zéro.
 */
export async function completeMicrosoftConnection(
  user: CurrentUser,
  input: { code: string; state: string },
  deps: IntegrationDeps,
): Promise<{ id: string }> {
  assertCanConnect(user);
  const now = clock(deps);

  const pending = await db.oAuthState.findFirst({
    where: { state: input.state, userId: user.id, provider: PROVIDER_MICROSOFT, expiresAt: { gt: now } },
  });
  // Usage unique : la suppression est la preuve que CETTE requête a consommé l'état (deux retours simultanés → un seul passe).
  const consumed = pending ? await db.oAuthState.deleteMany({ where: { state: pending.state } }) : { count: 0 };
  if (!pending || consumed.count === 0) throw errors.validation("La demande de connexion a expiré ou n'est pas valide. Recommencez.");

  let tokens;
  let profile;
  try {
    tokens = await exchangeCode(deps.setup.microsoft, { code: input.code, redirectUri: redirectUri(deps.setup), verifier: pending.codeVerifier }, deps.fetchImpl, now);
    profile = await deps.graph.profile(tokens.accessToken);
  } catch (error) {
    if (error instanceof OAuthError || error instanceof GraphError) throw errors.validation(error.message);
    throw error;
  }
  if (!hasMailScope(tokens.scope)) {
    throw errors.validation("Le droit de lecture des e-mails n'a pas été accordé. Recommencez en acceptant la demande d'accès.");
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.integrationConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: PROVIDER_MICROSOFT } } });
    const id = existing?.id ?? randomUUID();
    const sameAccount = existing?.externalUserId === profile.id;

    const secrets = {
      status: "active",
      accountEmail: profile.email,
      externalUserId: profile.id,
      scopes: tokens.scope,
      accessTokenEnc: encryptSecret(tokens.accessToken, deps.setup.key, accessContext(id)),
      refreshTokenEnc: encryptSecret(tokens.refreshToken, deps.setup.key, refreshContext(id)),
      accessTokenExpiresAt: tokens.expiresAt,
      lastError: null,
      consentedAt: now,
      syncingSince: null,
    };

    if (existing) {
      await tx.integrationConnection.update({
        where: { id },
        data: {
          ...secrets,
          // Autre compte : ses messages n'ont rien à voir avec les curseurs, l'abonnement et la date de départ de l'ancien.
          ...(sameAccount ? {} : { cursors: {}, syncSince: new Date(now.getTime() - INITIAL_SYNC_DAYS * 86_400_000), subscriptionId: null, subscriptionExpiresAt: null }),
          webhookSecret: existing.webhookSecret ?? randomBytes(32).toString("base64url"),
        },
      });
    } else {
      await tx.integrationConnection.create({
        data: {
          id,
          userId: user.id,
          provider: PROVIDER_MICROSOFT,
          ...secrets,
          syncSince: new Date(now.getTime() - INITIAL_SYNC_DAYS * 86_400_000),
          webhookSecret: randomBytes(32).toString("base64url"),
        },
      });
    }

    await tx.syncEvent.create({
      data: { connectionId: id, userId: user.id, provider: PROVIDER_MICROSOFT, kind: "connected", trigger: "manual", status: "success", startedAt: now, finishedAt: now },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        action: "integration.connected",
        entityType: "integration_connection",
        entityId: id,
        // Jamais de jeton : seulement le fournisseur et les droits accordés.
        metadata: { provider: PROVIDER_MICROSOFT, scopes: tokens.scope, reconnected: Boolean(existing) },
      },
      tx,
    );
    return { id };
  });
}

/**
 * Déconnexion volontaire : les jetons sont effacés, l'abonnement aux notifications est supprimé (au mieux), et plus rien
 * n'est lu. Les activités déjà importées restent dans les dossiers (l'historique des échanges appartient au compte client).
 */
export async function disconnectMicrosoft(user: CurrentUser, deps: IntegrationDeps): Promise<void> {
  assertCanConnect(user);
  const now = clock(deps);
  const connection = await db.integrationConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: PROVIDER_MICROSOFT } } });
  if (!connection || connection.status === "revoked") return;

  // Au mieux : on ne renouvelle pas le jeton pour cela. Sans abonnement supprimé, Microsoft cesse d'appeler à son expiration
  // et la route de notification ignore de toute façon une connexion révoquée.
  if (connection.subscriptionId && connection.accessTokenEnc && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt > now) {
    try {
      await deps.graph.deleteSubscription(decryptSecret(connection.accessTokenEnc, deps.setup.key, accessContext(connection.id)), connection.subscriptionId);
    } catch {
      // Ignoré volontairement : la déconnexion ne doit jamais échouer à cause du fournisseur.
    }
  }

  await db.$transaction(async (tx) => {
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "revoked",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        accessTokenExpiresAt: null,
        subscriptionId: null,
        subscriptionExpiresAt: null,
        webhookSecret: null,
        cursors: {},
        syncingSince: null,
        syncRequestedAt: null,
        lastError: null,
      },
    });
    await tx.syncEvent.create({
      data: { connectionId: connection.id, userId: user.id, provider: PROVIDER_MICROSOFT, kind: "disconnected", trigger: "manual", status: "success", startedAt: now, finishedAt: now },
    });
    await writeAudit(
      { actorUserId: user.id, action: "integration.disconnected", entityType: "integration_connection", entityId: connection.id, metadata: { provider: PROVIDER_MICROSOFT } },
      tx,
    );
  });
}

// --- Jetons -----------------------------------------------------------------------------------------------------

/**
 * Passe la connexion à « À reconnecter » (une seule fois), prévient son propriétaire et inscrit l'échec au journal.
 * Appelé quand Microsoft refuse le renouvellement : consentement retiré, mot de passe changé, jeton expiré…
 */
export async function markNeedsReconnect(connectionId: string, reason: string, now: Date = new Date()): Promise<void> {
  const flipped = await db.integrationConnection.updateMany({
    where: { id: connectionId, status: "active" },
    data: { status: "needs_reconnect", lastError: reason, syncingSince: null },
  });
  if (flipped.count === 0) return;

  const connection = await db.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) return;
  await db.syncEvent.create({
    data: { connectionId, userId: connection.userId, provider: connection.provider, kind: "token_refresh", trigger: "system", status: "error", startedAt: now, finishedAt: now, error: reason },
  });
  await createNotifications([
    {
      userId: connection.userId,
      source: "integration",
      title: "Reconnectez votre messagerie Microsoft",
      body: "Votre messagerie n'est plus synchronisée avec le CRM : l'accès a été retiré ou a expiré.",
      href: "/integrations",
      // Une alerte par période de consentement : une panne répétée ne spamme pas, une nouvelle panne après reconnexion alerte.
      dedupeKey: `integration_reconnect:${connection.id}:${connection.consentedAt.getTime()}`,
    },
  ]);
}

/**
 * Jeton d'accès en clair pour appeler Microsoft. Renouvelé s'il expire bientôt (ou si `force`, après un refus 401).
 * Microsoft fait tourner le jeton d'actualisation : le nouveau est enregistré avant d'être utilisé.
 * @throws ReconnectRequiredError si l'accès est révoqué ou illisible (la connexion est alors marquée « À reconnecter »).
 */
export async function getAccessToken(connectionId: string, deps: IntegrationDeps, options: { force?: boolean } = {}): Promise<string> {
  const now = clock(deps);
  const connection = await db.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status !== "active" || !connection.accessTokenEnc || !connection.refreshTokenEnc) throw new ReconnectRequiredError();

  const margin = TOKEN_REFRESH_MARGIN_SECONDS * 1000;
  if (!options.force && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() - now.getTime() > margin) {
    try {
      return decryptSecret(connection.accessTokenEnc, deps.setup.key, accessContext(connection.id));
    } catch {
      // Illisible (clé changée ?) : on tente un renouvellement, qui échouera proprement si le jeton d'actualisation l'est aussi.
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(connection.refreshTokenEnc, deps.setup.key, refreshContext(connection.id));
  } catch {
    await markNeedsReconnect(connection.id, "Les jetons enregistrés sont illisibles (clé de chiffrement modifiée ?).", now);
    throw new ReconnectRequiredError();
  }

  try {
    const tokens = await refreshAccessToken(deps.setup.microsoft, refreshToken, deps.fetchImpl, now);
    await db.integrationConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken, deps.setup.key, accessContext(connection.id)),
        refreshTokenEnc: encryptSecret(tokens.refreshToken, deps.setup.key, refreshContext(connection.id)),
        accessTokenExpiresAt: tokens.expiresAt,
      },
    });
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof OAuthError && error.code === "invalid_grant") {
      await markNeedsReconnect(connection.id, error.message, now);
      throw new ReconnectRequiredError();
    }
    throw error;
  }
}
