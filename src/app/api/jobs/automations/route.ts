import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { runAutomations } from "@/features/automations/engine";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// Point d'entrée du planificateur (cron système, tâche planifiée du cloud…) : exécute les règles de relance.
// Protégé par un secret partagé (CRON_SECRET). Sans secret configuré, la route n'existe pas (404) : aucune exécution
// anonyme n'est possible. Le moteur est idempotent : un appel répété dans la même période ne crée rien de plus.

/** Comparaison en temps constant : on compare des empreintes de même longueur, jamais les secrets bruts. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export async function POST(request: Request) {
  await connection();
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(token, env.CRON_SECRET)) return new Response(null, { status: 401 });

  try {
    const results = await runAutomations({ trigger: "schedule" });
    // Uniquement des compteurs : ni nom de compte, ni destinataire.
    return Response.json({
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
