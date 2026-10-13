// Règles pures des tâches : dates calendaires en UTC (une échéance est un JOUR, pas un instant).

/** Minuit UTC du jour de `now` : la référence « aujourd'hui » pour comparer à une échéance (colonne `date`). */
export function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Une tâche est en retard si elle est ouverte et que son échéance est strictement avant aujourd'hui. */
export function isTaskOverdue(dueDate: Date, status: string, now: Date): boolean {
  return status === "open" && dueDate.getTime() < todayUtc(now).getTime();
}

/** Nombre de jours de retard (0 si la tâche n'est pas en retard). */
export function daysLate(dueDate: Date, status: string, now: Date): number {
  if (!isTaskOverdue(dueDate, status, now)) return 0;
  return Math.round((todayUtc(now).getTime() - dueDate.getTime()) / 86_400_000);
}

/** Une échéance ne peut pas être fixée dans le passé à la création : une tâche déjà en retard n'a pas de sens. */
export function isDueDateAllowed(dueDate: Date, now: Date): boolean {
  return dueDate.getTime() >= todayUtc(now).getTime();
}
