import "server-only";
import { z } from "zod";
import { PROVIDER_MICROSOFT } from "@/features/integrations/config";
import { constantTimeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";

// Notifications Microsoft (webhooks, CDC 7.3 et REC-07/08). Le contenu d'une notification n'est JAMAIS cru : il ne sert
// qu'à dire « il y a peut-être du nouveau pour cette connexion ». Le CRM relit lui-même la boîte avec ses propres jetons,
// plus tard, via la synchronisation planifiée. La réponse à Microsoft doit être très rapide (quelques secondes au plus) :
// ici, une seule écriture en base, aucun appel réseau.

/** Taille maximale acceptée pour un corps de notification (Microsoft en envoie de petits lots). */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

const payloadSchema = z.object({
  value: z
    .array(z.object({ subscriptionId: z.string().min(1).max(256), clientState: z.string().max(512).optional() }))
    .max(200),
});

/**
 * Marque les connexions concernées « à synchroniser ». Les notifications dont l'abonnement est inconnu ou dont le secret
 * (`clientState`) ne correspond pas sont ignorées sans bruit : l'appelant reçoit la même réponse dans tous les cas, ce qui
 * ne révèle pas quels abonnements existent. Retourne le nombre de connexions signalées.
 */
export async function handleNotifications(body: unknown, now: Date = new Date()): Promise<{ valid: boolean; flagged: number }> {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return { valid: false, flagged: 0 };

  const subscriptionIds = [...new Set(parsed.data.value.map((notification) => notification.subscriptionId))];
  const connections = await db.integrationConnection.findMany({
    where: { provider: PROVIDER_MICROSOFT, status: "active", subscriptionId: { in: subscriptionIds } },
    select: { id: true, subscriptionId: true, webhookSecret: true },
  });
  const bySubscription = new Map(connections.map((connection) => [connection.subscriptionId, connection]));

  const toFlag = new Set<string>();
  for (const notification of parsed.data.value) {
    const connection = bySubscription.get(notification.subscriptionId);
    if (!connection?.webhookSecret || !notification.clientState) continue;
    if (constantTimeEqual(notification.clientState, connection.webhookSecret)) toFlag.add(connection.id);
  }
  if (toFlag.size === 0) return { valid: true, flagged: 0 };

  await db.integrationConnection.updateMany({ where: { id: { in: [...toFlag] } }, data: { syncRequestedAt: now } });
  return { valid: true, flagged: toFlag.size };
}
