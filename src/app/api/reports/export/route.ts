import { connection } from "next/server";
import { isFeatureEnabled } from "@/features/modules/service";
import { exportReport } from "@/features/reporting/export";
import { exportRequestSchema, parseForecastParams, parseLossParams } from "@/features/reporting/schemas";
import { apiUser, fileResponse } from "@/lib/api";
import { errors, toErrorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

// Export CSV ou XLSX d'un rapport (CDC 8.3), avec les filtres de l'écran. Réservé à `report:export` (vérifié par le
// service) ; limité en fréquence ; journalisé. Un filtre invalide est refusé : on n'exporte jamais « tout » par erreur.

export async function GET(request: Request) {
  await connection();
  try {
    const user = await apiUser();
    if (!rateLimit(`report-export:${user.id}`, { limit: 10, windowMs: 60_000 }).ok) throw errors.rateLimited();

    const params = new URL(request.url).searchParams;
    const kind = exportRequestSchema.safeParse({ report: params.get("report"), format: params.get("format") });
    if (!kind.success) throw errors.validation("Rapport ou format d'export invalide.");
    // Un export dont l'écran est désactivé par l'administrateur n'existe plus (même réponse qu'une page introuvable).
    const feature = kind.data.report === "losses" ? "motifs_perte" : "previsions";
    if (!(await isFeatureEnabled(feature))) throw errors.notFound();

    let result;
    if (kind.data.report === "losses") {
      const filters = parseLossParams(params);
      if (!filters.success) throw errors.validation("Filtres d'export invalides.");
      result = await exportReport(user, { report: "losses", format: kind.data.format, filters: filters.data });
    } else {
      const filters = parseForecastParams(params);
      if (!filters.success) throw errors.validation("Filtres d'export invalides.");
      result = await exportReport(user, { report: kind.data.report, format: kind.data.format, filters: filters.data });
    }

    return fileResponse(result.filename, result.contentType, result.body, {
      "X-Export-Rows": String(result.rows),
      "X-Export-Truncated": String(result.truncated),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
