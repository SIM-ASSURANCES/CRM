import { LOSS_REASONS } from "@/features/leads/config";
import { weightedAmount } from "@/features/opportunities/rules";
import { SIZE_BANDS, type Granularity } from "@/features/reporting/config";

// Règles pures du reporting (sans accès base) : le même calcul alimente les écrans ET les exports (REC-10). Les dates sont
// lues en UTC, qui est le fuseau d'Abidjan : un mois civil est donc un mois UTC.

const MONTH_NAMES = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const round2 = (value: number) => Math.round(value * 100) / 100;
const pad = (value: number) => String(value).padStart(2, "0");

/** Montant annualisé : mensuel × 12, annuel et unique tels que saisis (décision du 15/10/2026, CDC 5.3). */
export function annualize(amount: number, revenuePeriod: string): number {
  return round2(revenuePeriod === "monthly" ? amount * 12 : amount);
}

// --- Périodes ----------------------------------------------------------------------------------------------------

export const isMonthKey = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Clé de période d'une date : « 2026-10 » (mois), « 2026-T4 » (trimestre) ou « 2026 » (année). */
export function periodKeyOf(date: Date, granularity: Granularity): string {
  if (granularity === "month") return monthKeyOf(date);
  if (granularity === "quarter") return `${date.getUTCFullYear()}-T${Math.floor(date.getUTCMonth() / 3) + 1}`;
  return String(date.getUTCFullYear());
}

export function periodLabel(key: string): string {
  if (isMonthKey(key)) return `${MONTH_NAMES[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
  const quarter = /^(\d{4})-T([1-4])$/.exec(key);
  return quarter ? `T${quarter[2]} ${quarter[1]}` : key;
}

/** Premier jour d'un mois « 2026-10 ». */
export function monthStartDate(monthKey: string): Date {
  return new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5)) - 1, 1));
}

/** Premier jour du mois suivant : borne EXCLUE d'une plage de mois. */
export function nextMonthStartDate(monthKey: string): Date {
  return new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5)), 1));
}

/** Mois couverts par une période (un objectif trimestriel ou annuel est la somme de ses mois). */
export function monthsOfPeriod(key: string): string[] {
  if (isMonthKey(key)) return [key];
  const quarter = /^(\d{4})-T([1-4])$/.exec(key);
  if (quarter) {
    const first = (Number(quarter[2]) - 1) * 3 + 1;
    return [0, 1, 2].map((offset) => `${quarter[1]}-${pad(first + offset)}`);
  }
  return Array.from({ length: 12 }, (_, index) => `${key}-${pad(index + 1)}`);
}

/** Tous les mois de `from` à `to` inclus ; vide si la plage est inversée. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5));
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5));
  while (year * 12 + month <= end) {
    months.push(`${year}-${pad(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Périodes distinctes, dans l'ordre, qui couvrent la plage de mois. */
export function periodsBetween(from: string, to: string, granularity: Granularity): string[] {
  const keys: string[] = [];
  for (const month of monthsBetween(from, to)) {
    const key = granularity === "month" ? month : periodKeyOf(monthStartDate(month), granularity);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

// --- Forecast ----------------------------------------------------------------------------------------------------

export type ReportOpportunity = {
  status: "open" | "won" | "lost";
  amount: number;
  revenuePeriod: string;
  stage: number;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  lossReason: string | null;
  /** Valeur de l'axe de segmentation choisi (produit, équipe, commercial…), fixée par le service. */
  segmentKey: string;
  segmentLabel: string;
};

export type Totals = {
  openCount: number;
  gross: number;
  weighted: number;
  wonCount: number;
  signed: number;
  /** Forecast = revenu signé + pipeline pondéré. */
  forecast: number;
};

export const emptyTotals = (): Totals => ({ openCount: 0, gross: 0, weighted: 0, wonCount: 0, signed: 0, forecast: 0 });

function addTo(totals: Totals, opportunity: ReportOpportunity): void {
  const amount = annualize(opportunity.amount, opportunity.revenuePeriod);
  if (opportunity.status === "open") {
    totals.openCount += 1;
    totals.gross += amount;
    totals.weighted += weightedAmount(amount, opportunity.stage);
  } else if (opportunity.status === "won") {
    totals.wonCount += 1;
    totals.signed += amount;
  }
}

function finalize(totals: Totals): Totals {
  const gross = round2(totals.gross);
  const weighted = round2(totals.weighted);
  const signed = round2(totals.signed);
  return { ...totals, gross, weighted, signed, forecast: round2(weighted + signed) };
}

function sumTotals(list: readonly Totals[]): Totals {
  const sum = emptyTotals();
  for (const item of list) {
    sum.openCount += item.openCount;
    sum.gross += item.gross;
    sum.weighted += item.weighted;
    sum.wonCount += item.wonCount;
    sum.signed += item.signed;
  }
  return finalize(sum);
}

/** Période d'une opportunité : date de clôture prévisionnelle si ouverte, date de clôture réelle si gagnée ou perdue. */
export function bucketKey(opportunity: ReportOpportunity, granularity: Granularity): string | null {
  const date = opportunity.status === "open" ? opportunity.expectedCloseDate : opportunity.closedAt;
  return date ? periodKeyOf(date, granularity) : null;
}

export type ForecastSegment = {
  key: string;
  label: string;
  periods: Record<string, Totals>;
  total: Totals;
};

export type ForecastReport = {
  granularity: Granularity;
  periods: string[];
  segments: ForecastSegment[];
  periodTotals: Record<string, Totals>;
  total: Totals;
};

/** Segment sans aucune opportunité : un commercial qui a un objectif mais pas de pipeline doit apparaître, à zéro. */
export function emptySegment(key: string, label: string, periods: readonly string[]): ForecastSegment {
  const zero = finalize(emptyTotals());
  return { key, label, periods: Object.fromEntries(periods.map((period) => [period, zero])), total: zero };
}

/**
 * Forecast par période et par segment. Une opportunité ouverte compte dans la période de sa date de clôture prévisionnelle,
 * une gagnée dans celle de sa clôture ; une perdue ne compte jamais (elle relève de l'analyse des motifs de perte).
 */
export function buildForecast(
  opportunities: readonly ReportOpportunity[],
  options: { granularity: Granularity; periods: readonly string[] },
): ForecastReport {
  const wanted = new Set(options.periods);
  const segments = new Map<string, { label: string; periods: Map<string, Totals> }>();

  for (const opportunity of opportunities) {
    if (opportunity.status === "lost") continue;
    // La base garantit une date de clôture prévisionnelle aux ouvertes et une date de clôture aux gagnées ; sans date, ou hors
    // des périodes demandées, l'opportunité ne peut être placée nulle part.
    const key = bucketKey(opportunity, options.granularity);
    if (key === null || !wanted.has(key)) continue;

    let segment = segments.get(opportunity.segmentKey);
    if (!segment) {
      segment = { label: opportunity.segmentLabel, periods: new Map() };
      segments.set(opportunity.segmentKey, segment);
    }
    const totals = segment.periods.get(key) ?? emptyTotals();
    addTo(totals, opportunity);
    segment.periods.set(key, totals);
  }

  const built: ForecastSegment[] = [...segments.entries()].map(([key, segment]) => {
    const periods: Record<string, Totals> = {};
    for (const period of options.periods) periods[period] = finalize(segment.periods.get(period) ?? emptyTotals());
    return { key, label: segment.label, periods, total: sumTotals(Object.values(periods)) };
  });
  built.sort((a, b) => b.total.forecast - a.total.forecast || b.total.gross - a.total.gross || a.label.localeCompare(b.label, "fr"));

  const periodTotals: Record<string, Totals> = {};
  for (const period of options.periods) periodTotals[period] = sumTotals(built.map((segment) => segment.periods[period]));

  return {
    granularity: options.granularity,
    periods: [...options.periods],
    segments: built,
    periodTotals,
    total: sumTotals(Object.values(periodTotals)),
  };
}

// --- Objectifs ---------------------------------------------------------------------------------------------------

export type Attainment = {
  target: number;
  forecast: number;
  /** Forecast − objectif (négatif = en retard sur l'objectif). */
  gap: number;
  /** Forecast ÷ objectif en pourcentage (1 décimale) ; null = « non calculable » (objectif nul ou absent). */
  rate: number | null;
};

export function attainment(forecast: number, target: number): Attainment {
  return {
    target: round2(target),
    forecast: round2(forecast),
    gap: round2(forecast - target),
    rate: target > 0 ? Math.round((forecast / target) * 1000) / 10 : null,
  };
}

/** Objectif d'une période = somme des objectifs de ses mois. */
export function targetOfPeriod(key: string, byMonth: ReadonlyMap<string, number>): number {
  return round2(monthsOfPeriod(key).reduce((sum, month) => sum + (byMonth.get(month) ?? 0), 0));
}

// --- Motifs de perte ---------------------------------------------------------------------------------------------

export type LossCell = { count: number; amount: number };
export type LossRow = { key: string; label: string; byReason: Record<string, LossCell>; total: LossCell };
export type LossMatrix = { reasons: { code: string; label: string }[]; rows: LossRow[]; total: LossRow };

const UNKNOWN_REASON = { code: "unknown", label: "Non renseigné" };

/** Tranche de taille d'un compte d'après son effectif. */
export function sizeBandOf(employeeCount: number | null): { key: string; label: string } {
  const code =
    employeeCount === null || employeeCount <= 0 ? "unknown" : employeeCount < 50 ? "small" : employeeCount < 250 ? "medium" : employeeCount < 1000 ? "large" : "xlarge";
  const band = SIZE_BANDS.find((candidate) => candidate.code === code)!;
  return { key: band.code, label: band.label };
}

/** Croise les motifs de perte avec l'axe choisi (produit, secteur, commercial, taille, équipe) : nombre et montant annualisé. */
export function buildLossMatrix(opportunities: readonly ReportOpportunity[]): LossMatrix {
  const lost = opportunities.filter((opportunity) => opportunity.status === "lost");
  const known = new Set<string>(LOSS_REASONS.map((reason) => reason.code));
  const reasons: { code: string; label: string }[] = LOSS_REASONS.map((reason) => ({ code: reason.code, label: reason.label }));
  if (lost.some((opportunity) => !opportunity.lossReason || !known.has(opportunity.lossReason))) reasons.push(UNKNOWN_REASON);

  const blank = (): Record<string, LossCell> => Object.fromEntries(reasons.map((reason) => [reason.code, { count: 0, amount: 0 }]));
  const rows = new Map<string, LossRow>();
  const total: LossRow = { key: "total", label: "Total", byReason: blank(), total: { count: 0, amount: 0 } };

  for (const opportunity of lost) {
    const reason = opportunity.lossReason && known.has(opportunity.lossReason) ? opportunity.lossReason : UNKNOWN_REASON.code;
    const amount = annualize(opportunity.amount, opportunity.revenuePeriod);
    let row = rows.get(opportunity.segmentKey);
    if (!row) {
      row = { key: opportunity.segmentKey, label: opportunity.segmentLabel, byReason: blank(), total: { count: 0, amount: 0 } };
      rows.set(opportunity.segmentKey, row);
    }
    for (const target of [row, total]) {
      target.byReason[reason].count += 1;
      target.byReason[reason].amount += amount;
      target.total.count += 1;
      target.total.amount += amount;
    }
  }

  const rounded = (row: LossRow): LossRow => ({
    ...row,
    byReason: Object.fromEntries(Object.entries(row.byReason).map(([code, cell]) => [code, { count: cell.count, amount: round2(cell.amount) }])),
    total: { count: row.total.count, amount: round2(row.total.amount) },
  });
  const sorted = [...rows.values()].map(rounded).sort((a, b) => b.total.amount - a.total.amount || a.label.localeCompare(b.label, "fr"));
  return { reasons, rows: sorted, total: rounded(total) };
}
