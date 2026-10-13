// Exécute les règles de relance automatique depuis la ligne de commande : `npm run jobs:run`.
// Pratique pour un cron système ou un essai local ; l'équivalent HTTP est POST /api/jobs/automations.
// Idempotent : le relancer dans la même période ne crée ni tâche ni notification en double.
import "dotenv/config";
import { runAutomations } from "../src/features/automations/engine";
import { ruleLabel } from "../src/features/automations/config";
import { db } from "../src/lib/db";

runAutomations({ trigger: "schedule" })
  .then((results) => {
    for (const r of results) {
      const detail =
        r.status === "disabled"
          ? "désactivée"
          : r.status === "error"
            ? `ERREUR : ${r.error}`
            : `${r.evaluated} évalué(s), ${r.tasksCreated} tâche(s), ${r.notificationsCreated} notification(s), ${r.skipped} déjà traité(s)`;
      console.log(`${ruleLabel(r.ruleCode)} : ${detail}`);
    }
    if (results.some((r) => r.status === "error")) process.exitCode = 1;
  })
  .catch((error) => {
    console.error("Échec des automatisations :", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
