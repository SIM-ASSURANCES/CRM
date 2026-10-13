import { describe, expect, it } from "vitest";
import { daysLate, isDueDateAllowed, isTaskOverdue, todayUtc } from "@/features/tasks/rules";

// « Maintenant » : 13/10/2026 à 15h30 UTC. Une échéance est un JOUR : seule la date compte, jamais l'heure.
const now = new Date(Date.UTC(2026, 9, 13, 15, 30));
const day = (d: number) => new Date(Date.UTC(2026, 9, d));

describe("règles des tâches", () => {
  it("ramène « aujourd'hui » à minuit UTC", () => {
    expect(todayUtc(now).toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("n'est pas en retard le jour de l'échéance, même en fin de journée", () => {
    expect(isTaskOverdue(day(13), "open", now)).toBe(false);
    expect(isTaskOverdue(day(13), "open", new Date(Date.UTC(2026, 9, 13, 23, 59)))).toBe(false);
  });

  it("est en retard dès le lendemain de l'échéance", () => {
    expect(isTaskOverdue(day(12), "open", now)).toBe(true);
    expect(daysLate(day(10), "open", now)).toBe(3);
  });

  it("ne signale jamais de retard pour une tâche terminée ou annulée", () => {
    expect(isTaskOverdue(day(1), "done", now)).toBe(false);
    expect(isTaskOverdue(day(1), "cancelled", now)).toBe(false);
    expect(daysLate(day(1), "done", now)).toBe(0);
  });

  it("refuse une échéance passée mais accepte aujourd'hui et le futur", () => {
    expect(isDueDateAllowed(day(12), now)).toBe(false);
    expect(isDueDateAllowed(day(13), now)).toBe(true);
    expect(isDueDateAllowed(day(30), now)).toBe(true);
  });
});
