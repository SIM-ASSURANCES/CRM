import { connection } from "next/server";
import { defaultDeps, loadIntegrationSetup } from "@/features/integrations/setup";
import { maintainSubscriptions } from "@/features/integrations/subscriptions";
import { runDueSyncs } from "@/features/integrations/sync";
import { rejectUnauthorizedCron } from "@/lib/cron";
import { logger } from "@/lib/logger";

// Point d'entrée du planificateur pour les intégrations (toutes les 15 minutes environ) : synchronise les messageries
// échues ou signalées par un webhook. Protégé par CRON_SECRET (voir lib/cron.ts). Idempotent : un appel répété ne
// recrée aucune activité, et un verrou par connexion empêche deux lectures simultanées de la même boîte.

export async function POST(request: Request) {
  await connection();
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const setup = loadIntegrationSetup();
  // Intégration non configurée : rien à faire, ce n'est pas une erreur du planificateur.
  if (!setup) return Response.json({ status: "disabled" });

  try {
    const deps = defaultDeps(setup);
    // Les abonnements d'abord : une connexion tout juste créée est alors déjà abonnée quand sa première lecture a lieu.
    const subscriptions = await maintainSubscriptions(deps);
    // Uniquement des compteurs : ni adresse e-mail, ni nom de compte, ni identifiant de message.
    return Response.json({ status: "ok", ...(await runDueSyncs(deps)), subscriptions });
  } catch (error) {
    logger.error({ err: error }, "Échec de l'exécution planifiée des synchronisations");
    return Response.json({ status: "error" }, { status: 500 });
  }
}
