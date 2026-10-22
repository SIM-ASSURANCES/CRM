import { compareValues, isoWeek, weekWindow, type Comparison, type WeekWindow } from "@/features/leads/kpi-math";

// Calculs purs (sans accès base) de l'historique des prospects : nouveaux prospects par jour et par semaine, comparés aux
// semaines passées, et nombre de prospects à chaque étape à la fin de chaque jour / semaine. Tous les jours et semaines
// sont en UTC (la Côte d'Ivoire est à UTC+0), comme les KPI du tableau de bord ; les semaines vont du lundi au dimanche.

const DAY_MS = 86_400_000;

/** Étapes OUVERTES, dans l'ordre du process de vente (100 % = gagné, compté à part). */
export const HISTORY_STAGES = [10, 20, 40, 60, 80, 90] as const;
export type HistoryStage = (typeof HISTORY_STAGES)[number];

export type StageCounts = {
  /** Prospects ouverts à chaque étape. */
  stages: Record<HistoryStage, number>;
  /** Total des prospects ouverts (somme des étapes). */
  open: number;
  won: number;
  lost: number;
};

export function emptyStageCounts(): StageCounts {
  return { stages: { 10: 0, 20: 0, 40: 0, 60: 0, 80: 0, 90: 0 }, open: 0, won: 0, lost: 0 };
}

function isHistoryStage(value: number): value is HistoryStage {
  return (HISTORY_STAGES as readonly number[]).includes(value);
}

/** Ajoute `count` prospects à l'état voulu : gagné, perdu ou ouvert à l'étape donnée (étape inconnue : ignorée). */
export function addToStageCounts(counts: StageCounts, status: string, progress: number, count: number): void {
  if (status === "won") counts.won += count;
  else if (status === "lost") counts.lost += count;
  else if (status === "open" && isHistoryStage(progress)) {
    counts.stages[progress] += count;
    counts.open += count;
  }
}

// --- Paramètres de l'écran -----------------------------------------------------------------------------------------------

export const WEEK_CHOICES = [4, 8, 12, 26, 52] as const;
export const DAY_CHOICES = [14, 30, 60, 90] as const;
export const DEFAULT_WEEKS = 12;
export const DEFAULT_DAYS = 30;

export type HistoryParams = { weeks: number; days: number; ownerId?: string };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lecture tolérante de l'adresse : une valeur absente ou hors des choix proposés retombe sur la valeur par défaut. */
export function parseHistoryParams(raw: Record<string, string | string[] | undefined>): HistoryParams {
  const weeks = Number(first(raw.semaines));
  const days = Number(first(raw.jours));
  const owner = first(raw.commercial);
  return {
    weeks: (WEEK_CHOICES as readonly number[]).includes(weeks) ? weeks : DEFAULT_WEEKS,
    days: (DAY_CHOICES as readonly number[]).includes(days) ? days : DEFAULT_DAYS,
    ownerId: owner && UUID.test(owner) ? owner : undefined,
  };
}

// --- Fenêtres de temps ---------------------------------------------------------------------------------------------------

export type DayWindow = { start: Date; end: Date };

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Les `days` derniers jours, du plus ancien à aujourd'hui (inclus). */
export function dayWindows(now: Date, days: number): DayWindow[] {
  const today = startOfDay(now).getTime();
  return Array.from({ length: days }, (_, index) => {
    const start = new Date(today - (days - 1 - index) * DAY_MS);
    return { start, end: new Date(start.getTime() + DAY_MS) };
  });
}

/** Les `weeks` dernières semaines (lundi → dimanche), de la plus ancienne à la semaine en cours. */
export function weekWindows(now: Date, weeks: number): WeekWindow[] {
  return Array.from({ length: weeks }, (_, index) => weekWindow(now, weeks - 1 - index));
}

/** Instant auquel on « photographie » les étapes pour une fenêtre : sa fin, ou maintenant si elle n'est pas terminée. */
export function snapshotInstant(windowEnd: Date, now: Date): Date {
  const end = windowEnd.getTime() - 1;
  return new Date(Math.min(end, now.getTime()));
}

/** Tous les instants à photographier (jours + semaines), sans doublon : une seule requête les traite ensemble. */
export function snapshotInstants(days: DayWindow[], weeks: WeekWindow[], now: Date): Date[] {
  const unique = new Map<number, Date>();
  for (const window of [...days, ...weeks]) {
    const instant = snapshotInstant(window.end, now);
    unique.set(instant.getTime(), instant);
  }
  return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** Premier jour à lire pour les nouveaux prospects : la plus ancienne fenêtre, reculée d'une semaine pour la comparaison. */
export function earliestNeededDay(days: DayWindow[], weeks: WeekWindow[]): Date {
  const starts = [days[0]?.start, weeks[0]?.start].filter((value): value is Date => Boolean(value));
  return new Date(Math.min(...starts.map((date) => date.getTime())) - 7 * DAY_MS);
}

// --- Séries --------------------------------------------------------------------------------------------------------------

export type DayPoint = {
  /** AAAA-MM-JJ (UTC). */
  date: string;
  newProspects: number;
  /** Nouveaux prospects le même jour de la semaine précédente. */
  sameDayLastWeek: number;
  comparison: Comparison;
  /** Situation à la fin du jour (maintenant pour aujourd'hui). */
  stages: StageCounts;
};

export type WeekPoint = {
  /** « S42 » (semaine ISO). */
  label: string;
  /** Lundi et dimanche de la semaine, AAAA-MM-JJ (UTC). */
  start: string;
  end: string;
  /** Semaine en cours : encore incomplète. */
  current: boolean;
  newProspects: number;
  /** Comparaison avec la semaine précédente. */
  comparison: Comparison;
  /** Situation à la fin de la semaine (maintenant pour la semaine en cours). */
  stages: StageCounts;
};

function sumDays(newByDay: ReadonlyMap<string, number>, start: Date, end: Date): number {
  let total = 0;
  for (let time = start.getTime(); time < end.getTime(); time += DAY_MS) total += newByDay.get(dayKey(new Date(time))) ?? 0;
  return total;
}

export function buildDailySeries(
  windows: DayWindow[],
  newByDay: ReadonlyMap<string, number>,
  snapshots: ReadonlyMap<number, StageCounts>,
  now: Date,
): DayPoint[] {
  return windows.map((window) => {
    const newProspects = newByDay.get(dayKey(window.start)) ?? 0;
    const sameDayLastWeek = newByDay.get(dayKey(new Date(window.start.getTime() - 7 * DAY_MS))) ?? 0;
    return {
      date: dayKey(window.start),
      newProspects,
      sameDayLastWeek,
      comparison: compareValues(newProspects, sameDayLastWeek),
      stages: snapshots.get(snapshotInstant(window.end, now).getTime()) ?? emptyStageCounts(),
    };
  });
}

export function buildWeeklySeries(
  windows: WeekWindow[],
  newByDay: ReadonlyMap<string, number>,
  snapshots: ReadonlyMap<number, StageCounts>,
  now: Date,
): WeekPoint[] {
  return windows.map((window) => {
    const newProspects = sumDays(newByDay, window.start, window.end);
    const previous = sumDays(newByDay, new Date(window.start.getTime() - 7 * DAY_MS), window.start);
    return {
      label: `S${isoWeek(window.start)}`,
      start: dayKey(window.start),
      end: dayKey(new Date(window.end.getTime() - DAY_MS)),
      current: now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime(),
      newProspects,
      comparison: compareValues(newProspects, previous),
      stages: snapshots.get(snapshotInstant(window.end, now).getTime()) ?? emptyStageCounts(),
    };
  });
}

/** Moyenne des semaines COMPLÈTES précédant la semaine en cours (au plus `count`) ; null s'il n'y en a aucune. */
export function averagePreviousWeeks(weeks: WeekPoint[], count = 4): number | null {
  const completed = weeks.filter((week) => !week.current).slice(-count);
  if (completed.length === 0) return null;
  return completed.reduce((sum, week) => sum + week.newProspects, 0) / completed.length;
}
