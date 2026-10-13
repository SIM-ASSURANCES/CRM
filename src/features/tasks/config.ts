// Statuts et priorités des tâches (CDC 6). Les codes sont ceux des contraintes CHECK de la table `tasks`.

export const TASK_STATUSES = [
  { code: "open", label: "À faire" },
  { code: "done", label: "Terminée" },
  { code: "cancelled", label: "Annulée" },
] as const;
export const TASK_STATUS_CODES = ["open", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUS_CODES)[number];

export const TASK_PRIORITIES = [
  { code: "high", label: "Haute" },
  { code: "normal", label: "Normale" },
  { code: "low", label: "Basse" },
] as const;
export const TASK_PRIORITY_CODES = ["high", "normal", "low"] as const;

/** Vues de la liste des tâches. « late » = ouvertes dont l'échéance est passée. */
export const TASK_VIEWS = [
  { code: "open", label: "À faire" },
  { code: "late", label: "En retard" },
  { code: "today", label: "Aujourd'hui" },
  { code: "done", label: "Terminées" },
] as const;
export const TASK_VIEW_CODES = ["open", "late", "today", "done"] as const;
export type TaskView = (typeof TASK_VIEW_CODES)[number];

export function taskStatusLabel(code: string): string {
  return TASK_STATUSES.find((status) => status.code === code)?.label ?? code;
}

export function taskPriorityLabel(code: string): string {
  return TASK_PRIORITIES.find((priority) => priority.code === code)?.label ?? code;
}
