// Types d'activités (CDC 6.1) et origines des événements du fil (CDC 3.4).

export const ACTIVITY_TYPES = [
  { code: "call_out", label: "Appel sortant" },
  { code: "call_in", label: "Appel entrant" },
  { code: "email", label: "E-mail" },
  { code: "meeting", label: "Rendez-vous" },
  { code: "video", label: "Visioconférence" },
  { code: "note", label: "Note interne" },
  { code: "proposal_sent", label: "Envoi de proposition" },
  { code: "contract_step", label: "Étape contractuelle" },
] as const;

export const ACTIVITY_TYPE_CODES = [
  "call_out",
  "call_in",
  "email",
  "meeting",
  "video",
  "note",
  "proposal_sent",
  "contract_step",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPE_CODES)[number];

/** Types ajoutés au fil par d'autres objets : tâches et changements d'étape des opportunités. */
export const FEED_EXTRA_TYPES = [
  { code: "task", label: "Tâche" },
  { code: "stage", label: "Changement d'étape" },
] as const;

export const FEED_TYPE_CODES = [...ACTIVITY_TYPE_CODES, "task", "stage"] as const;
export type FeedType = (typeof FEED_TYPE_CODES)[number];

export const ORIGINS = [
  { code: "user", label: "Saisie utilisateur" },
  { code: "sync", label: "Synchronisation" },
  { code: "automation", label: "Automatisation" },
] as const;
export type Origin = (typeof ORIGINS)[number]["code"];

export function activityTypeLabel(code: string): string {
  return [...ACTIVITY_TYPES, ...FEED_EXTRA_TYPES].find((type) => type.code === code)?.label ?? code;
}

export function originLabel(code: string): string {
  return ORIGINS.find((origin) => origin.code === code)?.label ?? code;
}

/** Nombre maximal d'événements affichés dans un fil (par source, puis après fusion). */
export const FEED_LIMIT = 100;
