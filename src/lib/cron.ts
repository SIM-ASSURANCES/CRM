import "server-only";
import { constantTimeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

// Authentification des routes appelées par le planificateur (cron système, tâche planifiée du cloud…). Protégées par un
// secret partagé (CRON_SECRET). Sans secret configuré, la route n'existe pas (404) : aucune exécution anonyme possible.

/** `null` si l'appel est autorisé ; sinon la réponse à renvoyer telle quelle (404 sans secret configuré, 401 si invalide). */
export function rejectUnauthorizedCron(request: Request): Response | null {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return constantTimeEqual(token, env.CRON_SECRET) ? null : new Response(null, { status: 401 });
}
