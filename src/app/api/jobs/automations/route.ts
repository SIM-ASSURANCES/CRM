import { connection } from "next/server";
import { runAutomations } from "@/features/automations/engine";
import { purgeExpiredSources } from "@/features/imports/migration";
import { rejectUnauthorizedCron } from "@/lib/cron";
import { logger } from "@/lib/logger";

// Point d'entrée du planificateur (cron système, tâche planifiée du cloud…) : exécute les règles de relance.
// Protégé par le secret partagé CRON_SECRET (voir lib/cron.ts). Le moteur est idempotent : un appel répété dans la même
// période ne crée rien de plus.

export async function POST(request: Request) {
  await connection();
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  try {
    const results = await runAutomations({ trigger: "schedule" });
    // Minimisation des données : la source des lots d'import non validés est effacée d'office après 90 jours.
    const sourcePurge = await purgeExpiredSources();
    // Uniquement des compteurs : ni nom de compte, ni destinataire.
    return Response.json({
      sourcePurge,
      results: results.map((r) => ({
        rule: r.ruleCode,
        status: r.status,
        evaluated: r.evaluated,
        tasksCreated: r.tasksCreated,
        notificationsCreated: r.notificationsCreated,
        skipped: r.skipped,
      })),
    });
  } catch (error) {
    logger.error({ err: error }, "Échec de l'exécution planifiée des automatisations");
    return Response.json({ status: "error" }, { status: 500 });
  }
}
