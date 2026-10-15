import "server-only";
import writeExcelFile from "write-excel-file/node";
import {
  EXPORT_ROW_LIMIT,
  GRANULARITIES,
  KPI_DEFINITIONS,
  LOSS_DIMENSIONS,
  REPORT_KINDS,
  SEGMENTS,
  type ExportFormat,
  type ReportKind,
} from "@/features/reporting/config";
import { periodLabel, type Attainment, type Totals } from "@/features/reporting/rules";
import type { ForecastFilters, LossFilters } from "@/features/reporting/schemas";
import { getForecast, getLosses, getOpportunityDetail, listReportOwners, type DetailRow, type ForecastView, type LossView } from "@/features/reporting/service";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { toCsv, type CsvCell } from "@/lib/csv";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Exports CSV et XLSX des rapports (CDC 8.3). Le rapport est d'abord transformé en un TABLEAU neutre ; les deux formats
// sérialisent ce même tableau, qui est lui-même construit à partir des mêmes fonctions que les écrans (REC-10).

export type ExportCell = string | number | null;

export type ExportTable = {
  title: string;
  /** Filtres appliqués (CDC 8.3 : « avec filtres appliqués et date de génération »). */
  filters: [string, string][];
  header: string[];
  /** Indices des colonnes de montants et de pourcentages, pour le format des cellules XLSX. */
  money: number[];
  percent: number[];
  rows: ExportCell[][];
  truncated: boolean;
};

const NOT_COMPUTABLE = "non calculable";
const rateCell = (attainment: Attainment | null): ExportCell => (attainment === null ? null : attainment.rate === null ? NOT_COMPUTABLE : attainment.rate);

const isoDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

// --- Tableaux ----------------------------------------------------------------------------------------------------

/** Lignes du forecast : une ligne par segment et par période, puis les totaux. Colonnes = celles de l'écran. */
export function forecastTable(view: ForecastView, filterLines: [string, string][]): ExportTable {
  const { report, targets } = view;
  const line = (segment: string, period: string, totals: Totals, attainment: Attainment | null): ExportCell[] => [
    segment,
    period,
    totals.openCount,
    totals.gross,
    totals.weighted,
    totals.wonCount,
    totals.signed,
    totals.forecast,
    attainment?.target ?? null,
    attainment?.gap ?? null,
    rateCell(attainment),
  ];

  const rows: ExportCell[][] = [];
  for (const segment of report.segments) {
    const attainment = targets?.bySegment?.[segment.key];
    for (const period of report.periods) rows.push(line(segment.label, periodLabel(period), segment.periods[period], attainment?.byPeriod[period] ?? null));
  }
  for (const period of report.periods) rows.push(line("TOTAL", periodLabel(period), report.periodTotals[period], targets?.byPeriod[period] ?? null));
  rows.push(line("TOTAL", "Toutes périodes", report.total, targets?.total ?? null));

  return {
    title: "Prévisions de chiffre d'affaires",
    filters: filterLines,
    header: ["Segment", "Période", "Opportunités ouvertes", "Pipeline brut", "Pipeline pondéré", "Gagnées", "Revenu signé", "Forecast", "Objectif", "Écart à l'objectif", "Taux d'atteinte (%)"],
    money: [3, 4, 6, 7, 8, 9],
    percent: [10],
    rows,
    truncated: false,
  };
}

/** Matrice des motifs de perte en lignes : axe × motif (nombre et montant), puis les totaux par motif. */
export function lossTable(view: LossView, filterLines: [string, string][]): ExportTable {
  const dimension = LOSS_DIMENSIONS.find((candidate) => candidate.code === view.filters.dimension)?.label ?? "Axe";
  const { matrix } = view;
  const rows: ExportCell[][] = [];
  for (const row of [...matrix.rows, matrix.total]) {
    const label = row.key === "total" ? "TOTAL" : row.label;
    for (const reason of matrix.reasons) {
      const cell = row.byReason[reason.code];
      if (cell.count > 0) rows.push([label, reason.label, cell.count, cell.amount]);
    }
    if (row.key === "total") rows.push([label, "Tous motifs", row.total.count, row.total.amount]);
  }
  return {
    title: "Motifs de perte",
    filters: filterLines,
    header: [dimension, "Motif de perte", "Opportunités perdues", "Montant annualisé"],
    money: [3],
    percent: [],
    rows,
    truncated: false,
  };
}

/** Détail des opportunités comptées dans le forecast, plafonné à EXPORT_ROW_LIMIT lignes. */
export function detailTable(details: readonly DetailRow[], filterLines: [string, string][]): ExportTable {
  const truncated = details.length > EXPORT_ROW_LIMIT;
  return {
    title: "Détail des opportunités",
    filters: filterLines,
    header: [
      "Compte",
      "Opportunité",
      "Produit",
      "Commercial",
      "Équipe",
      "Secteur",
      "Étape (%)",
      "Statut",
      "Montant saisi",
      "Période de revenu",
      "Montant annualisé",
      "Montant pondéré",
      "Clôture prévisionnelle",
      "Clôturée le",
    ],
    money: [8, 10, 11],
    percent: [],
    rows: details.slice(0, EXPORT_ROW_LIMIT).map((row) => [
      row.accountName,
      row.name,
      row.productLabel,
      row.ownerName,
      row.teamName,
      row.sector,
      row.stage,
      row.status === "won" ? "Gagnée" : "Ouverte",
      row.amount,
      row.revenuePeriod === "monthly" ? "Mensuel" : row.revenuePeriod === "annual" ? "Annuel" : "Unique",
      row.annualized,
      row.weighted,
      isoDay(row.expectedCloseDate),
      isoDay(row.closedAt),
    ]),
    truncated,
  };
}

// --- Sérialisation -----------------------------------------------------------------------------------------------

/** CSV pour Excel français : « ; », virgule décimale, BOM, puis filtres, date de génération et définitions des KPI. */
export function serializeCsv(table: ExportTable, now: Date): string {
  const rows: CsvCell[][] = [
    [table.title],
    ["Généré le", now.toISOString()],
    ...table.filters.map(([label, value]): CsvCell[] => [label, value]),
    [],
    table.header,
    ...table.rows,
  ];
  if (table.truncated) rows.push([], [`Export tronqué : seules les ${EXPORT_ROW_LIMIT} premières lignes sont incluses. Affinez les filtres.`]);
  rows.push([], ["Définitions des indicateurs"], ...KPI_DEFINITIONS.map((kpi): CsvCell[] => [kpi.label, kpi.definition]));
  return toCsv(rows, ";", { decimalComma: true });
}

/** XLSX : un onglet « Rapport » (filtres, date de génération, tableau) et un onglet « Définitions ». */
export async function serializeXlsx(table: ExportTable, now: Date): Promise<Buffer> {
  const bold = { fontWeight: "bold" as const };
  const head = (value: string) => ({ value, fontWeight: "bold" as const, backgroundColor: "#E8EEF8" });

  const body = table.rows.map((row) =>
    row.map((cell, index) => {
      if (cell === null) return null;
      if (typeof cell === "number") return { value: cell, type: Number, format: table.percent.includes(index) ? '0.0"%"' : table.money.includes(index) ? "#,##0" : "0" };
      return { value: cell };
    }),
  );
  const data = [
    [{ value: table.title, ...bold }],
    [{ value: "Généré le", ...bold }, { value: now.toISOString() }],
    ...table.filters.map(([label, value]) => [{ value: label, ...bold }, { value }]),
    [],
    table.header.map(head),
    ...body,
  ];
  if (table.truncated) data.push([], [{ value: `Export tronqué : seules les ${EXPORT_ROW_LIMIT} premières lignes sont incluses. Affinez les filtres.` }]);

  const widths = table.header.map((title, index) => ({
    width: Math.min(60, Math.max(14, title.length + 2, ...table.rows.slice(0, 200).map((row) => String(row[index] ?? "").length + 2))),
  }));

  return writeExcelFile([
    { data, sheet: "Rapport", columns: widths },
    {
      data: [[head("Indicateur"), head("Définition")], ...KPI_DEFINITIONS.map((kpi) => [{ value: kpi.label, ...bold }, { value: kpi.definition }])],
      sheet: "Définitions",
      columns: [{ width: 28 }, { width: 120 }],
    },
  ]).toBuffer();
}

// --- Point d'entrée ----------------------------------------------------------------------------------------------

export type ReportExportInput =
  | { report: "forecast" | "opportunities"; format: ExportFormat; filters: ForecastFilters }
  | { report: "losses"; format: ExportFormat; filters: LossFilters };

export type ExportResult = { filename: string; contentType: string; body: Buffer | string; rows: number; truncated: boolean };

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Libellés lisibles des filtres : le produit et le commercial sont nommés, jamais montrés par leur identifiant. */
async function filterLines(user: CurrentUser, filters: ForecastFilters | LossFilters): Promise<[string, string][]> {
  const lines: [string, string][] = [["Période", `${periodLabel(filters.from)} → ${periodLabel(filters.to)}`]];
  if ("granularity" in filters) {
    lines.push(["Granularité", GRANULARITIES.find((g) => g.code === filters.granularity)?.label ?? filters.granularity]);
    lines.push(["Segmentation", SEGMENTS.find((s) => s.code === filters.segment)?.label ?? filters.segment]);
  } else {
    lines.push(["Axe de croisement", LOSS_DIMENSIONS.find((d) => d.code === filters.dimension)?.label ?? filters.dimension]);
  }
  if (filters.productId) {
    const product = await db.product.findUnique({ where: { id: filters.productId }, select: { label: true } });
    lines.push(["Produit", product?.label ?? "Produit inconnu"]);
  }
  if (filters.ownerId) {
    // Seuls les commerciaux de son périmètre sont nommés : un identifiant quelconque ne révèle le nom de personne.
    const owner = (await listReportOwners(user)).find((candidate) => candidate.id === filters.ownerId);
    lines.push(["Commercial", owner?.name ?? "Hors de votre périmètre"]);
  }
  lines.push(["Périmètre", `Données visibles par ${user.name}`]);
  return lines;
}

const FILENAMES: Record<ReportKind, string> = { forecast: "previsions", losses: "motifs-de-perte", opportunities: "detail-opportunites" };

/**
 * Produit un export CSV ou XLSX. Réservé à `report:export` (manager et au-dessus) ; le périmètre est celui de l'utilisateur ;
 * l'export est limité en volume et lui-même tracé dans le journal d'audit (CDC 8.3).
 */
export async function exportReport(user: CurrentUser, input: ReportExportInput, now: Date = new Date()): Promise<ExportResult> {
  if (!can(user.role, "report:export")) throw errors.forbidden();

  const lines = await filterLines(user, input.filters);
  let table: ExportTable;
  if (input.report === "losses") table = lossTable(await getLosses(user, input.filters as LossFilters), lines);
  else if (input.report === "opportunities") table = detailTable(await getOpportunityDetail(user, input.filters as ForecastFilters), lines);
  else table = forecastTable(await getForecast(user, input.filters as ForecastFilters), lines);

  const body = input.format === "csv" ? serializeCsv(table, now) : await serializeXlsx(table, now);

  await writeAudit({
    actorUserId: user.id,
    action: "report.exported",
    entityType: "report",
    metadata: {
      report: input.report,
      reportLabel: REPORT_KINDS.find((kind) => kind.code === input.report)?.label ?? input.report,
      format: input.format,
      rows: table.rows.length,
      truncated: table.truncated,
      // Seuls des critères : jamais le contenu de l'export.
      filters: {
        from: input.filters.from,
        to: input.filters.to,
        productId: input.filters.productId ?? null,
        ownerId: input.filters.ownerId ?? null,
        ...("granularity" in input.filters ? { granularity: input.filters.granularity, segment: input.filters.segment } : { dimension: input.filters.dimension }),
      },
    },
  });

  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return {
    filename: `${FILENAMES[input.report]}_${input.filters.from}_${input.filters.to}_${stamp}.${input.format}`,
    contentType: CONTENT_TYPES[input.format],
    body,
    rows: table.rows.length,
    truncated: table.truncated,
  };
}
