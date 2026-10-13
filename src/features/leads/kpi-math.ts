// Calculs purs des KPI (sans accès base) : comparaison de périodes et semaines ISO.

export type Comparison = {
  current: number;
  previous: number;
  diff: number;
  /** null = non calculable (période précédente nulle), conformément au CDC 8.1. */
  pct: number | null;
};

/** Variation = (période − période précédente) / période précédente ; non calculable si la précédente vaut 0. */
export function compareValues(current: number, previous: number): Comparison {
  return {
    current,
    previous,
    diff: current - previous,
    pct: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

/** Numéro de semaine ISO 8601 (la semaine commence le lundi). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export type WeekWindow = { start: Date; end: Date };

/** Semaine [lundi 00:00 UTC, lundi suivant 00:00 UTC[ contenant `now`, décalée de `weeksAgo` semaines. */
export function weekWindow(now: Date, weeksAgo = 0): WeekWindow {
  const day = now.getUTCDay() || 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1) - weeksAgo * 7));
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start, end };
}
