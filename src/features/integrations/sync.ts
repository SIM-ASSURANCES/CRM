import "server-only";
import { accountScopeWhere } from "@/features/accounts/scope";
import {
  MAX_CONNECTIONS_PER_RUN,
  MAX_PAGES_PER_FOLDER,
  PROVIDER_MICROSOFT,
  SYNC_INTERVAL_MINUTES,
  SYNC_LOCK_TIMEOUT_MINUTES,
} from "@/features/integrations/config";
import { getAccessToken, markNeedsReconnect, ReconnectRequiredError } from "@/features/integrations/connection";
import { getExcludedDomains } from "@/features/integrations/exclusions";
import { GraphError, type DeltaPage, type MailFolder, type MailMessage } from "@/features/integrations/microsoft/graph";
import { counterparts, dedupeKey, describeMessage, messageDate, safeWebLink, skipReason } from "@/features/integrations/rules";
import { clock, type IntegrationDeps } from "@/features/integrations/setup";
import type { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { toRole } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Moteur de synchronisation des e-mails (CDC 7.1) : lit les nouveaux messages de la boîte de réception et des éléments
// envoyés, les rapproche des contacts que l'utilisateur voit, et crée UNE activité « e-mail » par compte concerné.
// Lecture seule côté Microsoft ; côté CRM, tout est idempotent (clé unique par message et par compte).

export type SyncTrigger = "manual" | "schedule" | "webhook";

export type SyncOutcome = {
  status: "success" | "partial" | "error" | "skipped";
  fetched: number;
  imported: number;
  skipped: number;
  duplicates: number;
  message: string | null;
};

type Stats = Pick<SyncOutcome, "fetched" | "imported" | "skipped" | "duplicates">;

const FOLDERS: MailFolder[] = ["inbox", "sentitems"];
const SUBJECT_MAX = 200;
const MANUAL_SYNC_COOLDOWN_SECONDS = 30;

const emptyStats = (): Stats => ({ fetched: 0, imported: 0, skipped: 0, duplicates: 0 });

function addStats(into: Stats, from: Stats): void {
  into.fetched += from.fetched;
  into.imported += from.imported;
  into.skipped += from.skipped;
  into.duplicates += from.duplicates;
}

// --- Rapprochement et enregistrement ----------------------------------------------------------------------------

/**
 * Transforme une page de messages en activités. Un message n'est retenu que si l'un de ses interlocuteurs est un contact
 * rattaché à un compte que le propriétaire de la boîte VOIT : on ne journalise jamais un échange dans un dossier hors
 * périmètre. Un message vu par deux comptes donne deux activités.
 */
async function importMessages(owner: CurrentUser, ownAddress: string, messages: MailMessage[], excluded: readonly string[]): Promise<Stats> {
  const stats: Stats = { fetched: messages.length, imported: 0, skipped: 0, duplicates: 0 };

  const candidates: { message: MailMessage; who: string[] }[] = [];
  for (const message of messages) {
    if (skipReason(message)) {
      stats.skipped++;
      continue;
    }
    const who = counterparts(message, ownAddress, excluded);
    if (who.length === 0) stats.skipped++;
    else candidates.push({ message, who });
  }
  if (candidates.length === 0) return stats;

  const addresses = [...new Set(candidates.flatMap((candidate) => candidate.who))];
  const contacts = await db.contact.findMany({
    where: { email: { in: addresses }, archivedAt: null },
    select: {
      id: true,
      email: true,
      accounts: { where: { account: { AND: [{ archivedAt: null }, accountScopeWhere(owner)] } }, select: { accountId: true } },
    },
  });
  const byAddress = new Map<string, { contactId: string; accountId: string }[]>();
  for (const contact of contacts) {
    if (!contact.email) continue;
    const links = byAddress.get(contact.email) ?? [];
    for (const { accountId } of contact.accounts) links.push({ contactId: contact.id, accountId });
    byAddress.set(contact.email, links);
  }

  const rows: Prisma.ActivityCreateManyInput[] = [];
  for (const { message, who } of candidates) {
    // Un contact par compte suffit : le premier interlocuteur reconnu pour ce compte.
    const perAccount = new Map<string, string>();
    for (const address of who) {
      for (const link of byAddress.get(address) ?? []) if (!perAccount.has(link.accountId)) perAccount.set(link.accountId, link.contactId);
    }
    if (perAccount.size === 0) {
      stats.skipped++;
      continue;
    }
    for (const [accountId, contactId] of perAccount) {
      rows.push({
        type: "email",
        subject: (message.subject || "(sans objet)").slice(0, SUBJECT_MAX),
        occurredAt: messageDate(message, ownAddress),
        authorUserId: owner.id,
        accountId,
        contactId,
        outcome: describeMessage(message, ownAddress),
        origin: "sync",
        externalProvider: PROVIDER_MICROSOFT,
        externalId: dedupeKey(message),
        externalUrl: safeWebLink(message.webLink),
      });
    }
  }

  if (rows.length > 0) {
    // ON CONFLICT DO NOTHING sur l'index unique (auteur, fournisseur, message, compte) : relancer ne crée rien de plus.
    const result = await db.activity.createMany({ data: rows, skipDuplicates: true });
    stats.imported = result.count;
    stats.duplicates = rows.length - result.count;
  }
  return stats;
}

// --- Lecture d'un dossier ---------------------------------------------------------------------------------------

type FolderContext = {
  connectionId: string;
  owner: CurrentUser;
  ownAddress: string;
  excluded: readonly string[];
  since: Date;
  deps: IntegrationDeps;
  cursors: Record<string, string>;
  token: string;
  tokenRefreshed: boolean;
};

/**
 * Lit un dossier page par page. Le curseur est enregistré après CHAQUE page : une interruption reprend là où elle s'est
 * arrêtée. Retourne `complete: false` quand la borne de pages est atteinte (la suite sera lue à la prochaine exécution).
 */
async function syncFolder(ctx: FolderContext, folder: MailFolder): Promise<{ stats: Stats; complete: boolean }> {
  const stats = emptyStats();
  let cursor: string | null = ctx.cursors[folder] ?? null;
  let resynced = false;
  let pages = 0;

  while (pages < MAX_PAGES_PER_FOLDER) {
    let page: DeltaPage;
    try {
      page = await ctx.deps.graph.messagesDelta(ctx.token, { folder, cursor, since: ctx.since });
    } catch (error) {
      if (error instanceof GraphError && error.kind === "unauthorized" && !ctx.tokenRefreshed) {
        // Jeton refusé alors qu'il n'avait pas expiré : un renouvellement forcé, une seule fois.
        ctx.tokenRefreshed = true;
        ctx.token = await getAccessToken(ctx.connectionId, ctx.deps, { force: true });
        continue;
      }
      if (error instanceof GraphError && error.kind === "unauthorized") {
        await markNeedsReconnect(ctx.connectionId, "Microsoft refuse l'accès à la messagerie.", clock(ctx.deps));
        throw new ReconnectRequiredError();
      }
      if (error instanceof GraphError && error.kind === "gone" && !resynced) {
        // Curseur perdu (expiré, ou invalide) : on repart de la date de départ ; les messages déjà importés sont ignorés.
        resynced = true;
        cursor = null;
        delete ctx.cursors[folder];
        continue;
      }
      throw error;
    }

    addStats(stats, await importMessages(ctx.owner, ctx.ownAddress, page.messages, ctx.excluded));
    cursor = page.cursor;
    ctx.cursors[folder] = page.cursor;
    await db.integrationConnection.update({ where: { id: ctx.connectionId }, data: { cursors: { ...ctx.cursors } } });
    pages++;
    if (page.done) return { stats, complete: true };
  }
  return { stats, complete: false };
}

// --- Synchronisation d'une connexion ----------------------------------------------------------------------------

function toOwner(user: { id: string; name: string; email: string; role: string | null; teamId: string | null; mustChangePassword: boolean }): CurrentUser {
  return { id: user.id, name: user.name, email: user.email, role: toRole(user.role), teamId: user.teamId, mustChangePassword: user.mustChangePassword };
}

const lockLimit = (now: Date) => new Date(now.getTime() - SYNC_LOCK_TIMEOUT_MINUTES * 60_000);

/**
 * Synchronise la messagerie d'UNE connexion. Un verrou en base (`syncingSince`) garantit qu'une seule exécution lit la
 * boîte à la fois ; un verrou plus vieux que le délai est considéré comme orphelin (processus interrompu) et repris.
 * Ne lève jamais : tout échec est consigné au journal (`sync_events`) et visible sur la connexion (REC-07, 08 et 11).
 */
export async function syncConnection(connectionId: string, trigger: SyncTrigger, deps: IntegrationDeps): Promise<SyncOutcome> {
  const startedAt = clock(deps);

  const claimed = await db.integrationConnection.updateMany({
    where: { id: connectionId, status: "active", OR: [{ syncingSince: null }, { syncingSince: { lt: lockLimit(startedAt) } }] },
    data: { syncingSince: startedAt },
  });
  if (claimed.count === 0) {
    return { ...emptyStats(), status: "skipped", message: "Synchronisation déjà en cours, ou connexion inactive." };
  }

  const connection = await db.integrationConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { user: true } });
  const event = await db.syncEvent.create({
    data: { connectionId, userId: connection.userId, provider: connection.provider, kind: "mail_sync", trigger, status: "running", startedAt },
  });

  const totals = emptyStats();
  let status: SyncOutcome["status"] = "success";
  let message: string | null = null;
  let reconnect = false;

  try {
    const owner = toOwner(connection.user);
    if (connection.user.banned) throw new GraphError("unavailable", "Le compte de l'utilisateur est désactivé.");
    if (!can(owner.role, "integration:connect")) throw new GraphError("unavailable", "Cet utilisateur n'a plus le droit de synchroniser sa messagerie.");
    if (!connection.accountEmail) throw new GraphError("unavailable", "Adresse du compte Microsoft inconnue : reconnectez-vous.");

    const ctx: FolderContext = {
      connectionId,
      owner,
      ownAddress: connection.accountEmail,
      excluded: await getExcludedDomains(),
      since: connection.syncSince,
      deps,
      cursors: (connection.cursors ?? {}) as Record<string, string>,
      token: await getAccessToken(connectionId, deps),
      tokenRefreshed: false,
    };

    let complete = true;
    for (const folder of FOLDERS) {
      const result = await syncFolder(ctx, folder);
      addStats(totals, result.stats);
      if (!result.complete) complete = false;
    }
    if (!complete) {
      status = "partial";
      message = "Volume important : la suite sera lue à la prochaine synchronisation.";
    }
  } catch (error) {
    if (error instanceof ReconnectRequiredError) {
      status = "error";
      reconnect = true;
      message = "Reconnexion Microsoft nécessaire.";
    } else if (error instanceof GraphError && error.kind === "throttled") {
      status = "partial";
      message = `Microsoft limite temporairement les requêtes : reprise dans ${error.retryAfterSeconds ?? 30} s.`;
    } else if (error instanceof GraphError) {
      status = "error";
      message = error.message;
    } else {
      // Détail technique dans les journaux serveur seulement : le message affiché reste générique.
      logger.error({ err: error, connectionId }, "Échec inattendu de la synchronisation des e-mails");
      status = "error";
      message = "Erreur inattendue pendant la synchronisation.";
    }
  }

  const finishedAt = clock(deps);
  await db.integrationConnection.updateMany({
    where: { id: connectionId },
    data: {
      syncingSince: null,
      lastSyncAt: finishedAt,
      ...(status === "success" ? { lastSuccessAt: finishedAt } : {}),
      // Une reconnexion nécessaire a déjà fixé son propre message d'erreur.
      ...(reconnect ? {} : { lastError: status === "success" ? null : message }),
    },
  });
  // La demande de synchronisation d'un webhook est soldée seulement si elle date d'avant le début de CETTE exécution.
  await db.integrationConnection.updateMany({ where: { id: connectionId, syncRequestedAt: { lte: startedAt } }, data: { syncRequestedAt: null } });
  await db.syncEvent.update({ where: { id: event.id }, data: { status, finishedAt, error: message, ...totals } });

  return { status, message, ...totals };
}

// --- Points d'entrée --------------------------------------------------------------------------------------------

/** « Synchroniser maintenant » : l'utilisateur déclenche la lecture de SA messagerie (jamais celle d'un autre). */
export async function syncMyMailbox(user: CurrentUser, deps: IntegrationDeps): Promise<SyncOutcome> {
  if (!can(user.role, "integration:connect")) throw errors.forbidden();
  const connection = await db.integrationConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: PROVIDER_MICROSOFT } } });
  if (!connection || connection.status === "revoked") throw errors.validation("Connectez d'abord votre messagerie Microsoft.");
  if (connection.status === "needs_reconnect") throw errors.validation("Reconnectez d'abord votre messagerie Microsoft.");

  const now = clock(deps);
  if (connection.lastSyncAt && now.getTime() - connection.lastSyncAt.getTime() < MANUAL_SYNC_COOLDOWN_SECONDS * 1000) {
    throw errors.rateLimited("Une synchronisation vient d'avoir lieu. Patientez quelques secondes.");
  }
  return syncConnection(connection.id, "manual", deps);
}

export type RunSummary = { processed: number; success: number; partial: number; error: number; skipped: number; imported: number };

/**
 * Exécution planifiée : synchronise les connexions actives dont la dernière lecture est ancienne, ou qu'un webhook a
 * signalées. Les connexions sont traitées l'une après l'autre et en nombre borné, pour tenir dans la durée d'un appel.
 */
export async function runDueSyncs(deps: IntegrationDeps): Promise<RunSummary> {
  const now = clock(deps);
  const due = await db.integrationConnection.findMany({
    where: {
      provider: PROVIDER_MICROSOFT,
      status: "active",
      AND: [
        { OR: [{ syncingSince: null }, { syncingSince: { lt: lockLimit(now) } }] },
        { OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - SYNC_INTERVAL_MINUTES * 60_000) } }, { syncRequestedAt: { not: null } }] },
      ],
    },
    orderBy: [{ lastSyncAt: { sort: "asc", nulls: "first" } }],
    take: MAX_CONNECTIONS_PER_RUN,
    select: { id: true, syncRequestedAt: true },
  });

  const summary: RunSummary = { processed: 0, success: 0, partial: 0, error: 0, skipped: 0, imported: 0 };
  for (const connection of due) {
    const outcome = await syncConnection(connection.id, connection.syncRequestedAt ? "webhook" : "schedule", deps);
    summary.processed++;
    summary[outcome.status]++;
    summary.imported += outcome.imported;
  }
  return summary;
}
