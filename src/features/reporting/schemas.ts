import { z } from "zod";
import {
  EXPORT_FORMATS,
  GRANULARITY_CODES,
  LOSS_DIMENSION_CODES,
  MAX_PERIODS,
  REPORT_KIND_CODES,
  SEGMENT_CODES,
} from "@/features/reporting/config";
import { isMonthKey, monthsBetween, periodsBetween } from "@/features/reporting/rules";

// Filtres des rapports (CDC 8.2 et 8.3). Un paramètre invalide est REFUSÉ, jamais ignoré : on n'affiche ni n'exporte
// « tout » parce qu'un filtre était mal formé.

/** Année civile en cours : période par défaut des rapports. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear();
  return { from: `${year}-01`, to: `${year}-12` };
}

const month = z.string().refine(isMonthKey, "Mois attendu au format AAAA-MM.");

const optionalUuid = z.preprocess((value) => (value === "" || value === null ? undefined : value), z.uuid("Identifiant invalide.").optional());

const range = z.object({ from: month, to: month });

/** Plage non inversée. Le nombre de périodes est borné pour que le tableau et le graphique restent lisibles. */
function checkRange(value: { from: string; to: string; granularity?: (typeof GRANULARITY_CODES)[number] }, context: z.RefinementCtx, maxMonths: number) {
  if (value.from > value.to) {
    context.addIssue({ code: "custom", path: ["to"], message: "La fin de période précède son début." });
    return;
  }
  if (monthsBetween(value.from, value.to).length > maxMonths) {
    context.addIssue({ code: "custom", path: ["to"], message: `La période ne peut pas dépasser ${maxMonths} mois.` });
    return;
  }
  if (value.granularity && periodsBetween(value.from, value.to, value.granularity).length > MAX_PERIODS) {
    context.addIssue({ code: "custom", path: ["to"], message: `Au plus ${MAX_PERIODS} périodes par rapport.` });
  }
}

export const forecastFiltersSchema = range
  .extend({
    granularity: z.enum(GRANULARITY_CODES),
    segment: z.enum(SEGMENT_CODES),
    productId: optionalUuid,
    ownerId: optionalUuid,
  })
  .superRefine((value, context) => checkRange(value, context, MAX_PERIODS * 12));
export type ForecastFilters = z.infer<typeof forecastFiltersSchema>;

export const lossFiltersSchema = range
  .extend({
    dimension: z.enum(LOSS_DIMENSION_CODES),
    productId: optionalUuid,
    ownerId: optionalUuid,
  })
  .superRefine((value, context) => checkRange(value, context, 60));
export type LossFilters = z.infer<typeof lossFiltersSchema>;

export const exportRequestSchema = z.object({
  report: z.enum(REPORT_KIND_CODES),
  format: z.enum(EXPORT_FORMATS),
});

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === null || value === "" ? undefined : value;
}

/**
 * Filtres du forecast depuis les paramètres d'adresse. Les paramètres ABSENTS prennent leur valeur par défaut (année en
 * cours, par mois, sans segmentation) ; les paramètres PRÉSENTS mais invalides font échouer la validation.
 */
export function parseForecastParams(params: Params, now: Date = new Date()) {
  const fallback = defaultRange(now);
  return forecastFiltersSchema.safeParse({
    from: read(params, "du") ?? fallback.from,
    to: read(params, "au") ?? fallback.to,
    granularity: read(params, "periode") ?? "month",
    segment: read(params, "segment") ?? "none",
    productId: read(params, "produit"),
    ownerId: read(params, "commercial"),
  });
}

export function parseLossParams(params: Params, now: Date = new Date()) {
  const fallback = defaultRange(now);
  return lossFiltersSchema.safeParse({
    from: read(params, "du") ?? fallback.from,
    to: read(params, "au") ?? fallback.to,
    dimension: read(params, "axe") ?? "product",
    productId: read(params, "produit"),
    ownerId: read(params, "commercial"),
  });
}
