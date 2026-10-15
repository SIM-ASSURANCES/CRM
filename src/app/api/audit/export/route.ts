import { connection } from "next/server";
import { auditFiltersSchema, exportAuditLogs } from "@/features/audit/service";
import { apiUser, csvResponse } from "@/lib/api";
import { errors, toErrorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

// Export CSV du journal d'audit, avec les filtres de l'écran. Réservé à `audit:export` (vérifié par le service) ;
// plafonné en volume et en fréquence ; chaque export est lui-même journalisé (CDC 8.3).

export async function GET(request: Request) {
  await connection();
  try {
    const user = await apiUser();
    if (!rateLimit(`audit-export:${user.id}`, { limit: 5, windowMs: 60_000 }).ok) throw errors.rateLimited();

    const params = new URL(request.url).searchParams;
    // Un filtre invalide est refusé : on n'exporte jamais « tout » parce qu'un paramètre était mal formé.
    const parsed = auditFiltersSchema.safeParse({
      action: params.get("action"),
      entityType: params.get("objet"),
      actorId: params.get("auteur"),
      from: params.get("du"),
      to: params.get("au"),
    });
    if (!parsed.success) throw errors.validation("Filtres d'export invalides.");

    const result = await exportAuditLogs(user, parsed.data);
    return csvResponse(result.filename, result.csv, {
      "X-Export-Rows": String(result.rows),
      "X-Export-Truncated": String(result.truncated),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
