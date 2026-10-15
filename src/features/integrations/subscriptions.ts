import "server-only";
import {
  MAX_CONNECTIONS_PER_RUN,
  PROVIDER_MICROSOFT,
  SUBSCRIPTION_ERROR_LOG_HOURS,
  SUBSCRIPTION_LIFETIME_MINUTES,
  SUBSCRIPTION_RENEW_BEFORE_MINUTES,
} from "@/features/integrations/config";
import { getAccessToken, ReconnectRequiredError } from "@/features/integrations/connection";
import { GraphError, type Subscription } from "@/features/integrations/microsoft/graph";
import { clock, webhookUrl, type IntegrationDeps } from "@/features/integrations/setup";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Abonnement aux notifications Microsoft (webhooks, CDC 7.3) : Microsoft appelle le CRM dès qu'un message arrive, ce qui
// déclenche une synchronisation quasi immédiate. C'est un ACCÉLÉRATEUR, jamais une dépendance : sans abonnement (adresse
// non publique, panne), la lecture régulière continue de fonctionner.

export type SubscriptionOutcome = "created" | "renewed" | "unchanged" | "skipped" | "unavailable";

/**
 * Crée ou renouvelle l'abonnement d'une connexion. Microsoft exige une adresse HTTPS publique : en développement local
 * (http://localhost), l'abonnement est simplement ignoré. Ne lève jamais.
 */
export async function ensureSubscription(connectionId: string, deps: IntegrationDeps): Promise<SubscriptionOutcome> {
  const now = clock(deps);
  if (!deps.setup.baseUrl.startsWith("https://")) return "skipped";

  const connection = await db.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status !== "active" || !connection.webhookSecret) return "skipped";

  const renewLimit = new Date(now.getTime() + SUBSCRIPTION_RENEW_BEFORE_MINUTES * 60_000);
  if (connection.subscriptionId && connection.subscriptionExpiresAt && connection.subscriptionExpiresAt > renewLimit) return "unchanged";

  const expiresAt = new Date(now.getTime() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000);
  try {
    const token = await getAccessToken(connection.id, deps);

    let subscription: Subscription | null = null;
    let outcome: SubscriptionOutcome = "created";
    if (connection.subscriptionId) {
      try {
        subscription = await deps.graph.renewSubscription(token, connection.subscriptionId, expiresAt);
        outcome = "renewed";
      } catch (error) {
        // Abonnement disparu ou refusé : on en recrée un. Un refus d'accès, lui, vaut pour la création aussi.
        if (!(error instanceof GraphError) || error.kind === "unauthorized") throw error;
      }
    }
    subscription ??= await deps.graph.createSubscription(token, { notificationUrl: webhookUrl(deps.setup), clientState: connection.webhookSecret, expiresAt });

    await db.integrationConnection.update({
      where: { id: connection.id },
      data: { subscriptionId: subscription.id, subscriptionExpiresAt: subscription.expiresAt },
    });
    await db.syncEvent.create({
      data: { connectionId: connection.id, userId: connection.userId, provider: PROVIDER_MICROSOFT, kind: "subscription", trigger: "system", status: "success", startedAt: now, finishedAt: now },
    });
    return outcome;
  } catch (error) {
    // La reconnexion a déjà été signalée à l'utilisateur par la gestion des jetons.
    if (error instanceof ReconnectRequiredError) return "unavailable";

    logger.warn({ err: error, connectionId }, "Abonnement aux notifications Microsoft impossible");
    const message = error instanceof GraphError ? error.message : "Abonnement aux notifications impossible.";
    const since = new Date(now.getTime() - SUBSCRIPTION_ERROR_LOG_HOURS * 3_600_000);
    const recent = await db.syncEvent.findFirst({ where: { connectionId: connection.id, kind: "subscription", status: "error", startedAt: { gt: since } }, select: { id: true } });
    // Une seule inscription par période : sans cela, chaque exécution planifiée remplirait le journal du même incident.
    if (!recent) {
      await db.syncEvent.create({
        data: { connectionId: connection.id, userId: connection.userId, provider: PROVIDER_MICROSOFT, kind: "subscription", trigger: "system", status: "error", startedAt: now, finishedAt: now, error: message },
      });
    }
    return "unavailable";
  }
}

export type SubscriptionSummary = Record<SubscriptionOutcome, number>;

/** Passe sur les connexions actives sans abonnement, ou dont l'abonnement expire bientôt. */
export async function maintainSubscriptions(deps: IntegrationDeps): Promise<SubscriptionSummary> {
  const summary: SubscriptionSummary = { created: 0, renewed: 0, unchanged: 0, skipped: 0, unavailable: 0 };
  if (!deps.setup.baseUrl.startsWith("https://")) return summary;

  const now = clock(deps);
  const due = await db.integrationConnection.findMany({
    where: {
      provider: PROVIDER_MICROSOFT,
      status: "active",
      webhookSecret: { not: null },
      OR: [{ subscriptionId: null }, { subscriptionExpiresAt: null }, { subscriptionExpiresAt: { lt: new Date(now.getTime() + SUBSCRIPTION_RENEW_BEFORE_MINUTES * 60_000) } }],
    },
    orderBy: { subscriptionExpiresAt: { sort: "asc", nulls: "first" } },
    take: MAX_CONNECTIONS_PER_RUN,
    select: { id: true },
  });
  for (const connection of due) summary[await ensureSubscription(connection.id, deps)]++;
  return summary;
}
