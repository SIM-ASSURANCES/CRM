import { todayUtc } from "@/features/tasks/rules";

// Règles pures des automatisations : aucune lecture de base, entièrement testables.

const DAY_MS = 86_400_000;

/**
 * Clé de période : le calendrier est découpé en tranches de `frequencyDays` jours depuis le 1er janvier 1970 (UTC).
 * Tant qu'on reste dans la même tranche, la clé est identique : c'est ce qui rend les relances idempotentes
 * (« une tâche par règle et par période ») et plafonne la fréquence des alertes (CDC 6.2 : éviter la répétition).
 */
export function periodKey(now: Date, frequencyDays: number): string {
  const day = Math.floor(todayUtc(now).getTime() / DAY_MS);
  return `p${Math.floor(day / Math.max(1, frequencyDays))}`;
}

/** Nombre de jours entiers écoulés entre deux dates (jours calendaires UTC). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((todayUtc(to).getTime() - todayUtc(from).getTime()) / DAY_MS);
}

/** Segment du compte (CDC 6.2 : « seuil configurable par segment ») : grand compte selon l'effectif. */
export function inactivityThresholdDays(
  employeeCount: number | null,
  params: { largeAccountMinEmployees: number; largeDays: number; standardDays: number },
): number {
  const isLarge = employeeCount !== null && employeeCount >= params.largeAccountMinEmployees;
  return isLarge ? params.largeDays : params.standardDays;
}

/**
 * Jours d'inactivité d'un compte, ou `null` s'il n'est pas inactif. La référence est la dernière activité passée ;
 * à défaut, la création du compte (un compte neuf n'est pas « inactif » tout de suite).
 */
export function inactiveDays(lastActivityAt: Date | null, createdAt: Date, now: Date, thresholdDays: number): number | null {
  const days = daysBetween(lastActivityAt ?? createdAt, now);
  return days >= thresholdDays ? days : null;
}

/** Une alerte monte au manager quand le retard atteint le délai d'escalade. */
export function shouldEscalate(overdueDays: number, escalationDays: number): boolean {
  return overdueDays >= escalationDays;
}

/** « A, B, C et 2 autres » : résumé lisible d'une liste regroupée dans une seule notification. */
export function summarizeNames(names: string[], max = 3): string {
  if (names.length <= max) {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")} et ${rest} autre${rest > 1 ? "s" : ""}`;
}

/** Accord simple : 1 → « 1 tâche », 3 → « 3 tâches ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Regroupe des éléments par destinataire : une notification par personne, jamais une par élément. */
export function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
