import { describe, expect, it } from "vitest";
import { createActivitySchema, feedFiltersSchema } from "@/features/activities/schemas";
import { createTaskSchema, setTaskStatusSchema, taskListSchema } from "@/features/tasks/schemas";

const uuid = "01a135a1-c999-71ec-9668-8eb72743fada";

describe("schéma d'une activité", () => {
  const valid = { type: "call_out", subject: "Appel de suivi", occurredAt: "2026-10-13T14:30", accountId: uuid };

  it("accepte une activité minimale et lit l'heure saisie comme UTC", () => {
    const parsed = createActivitySchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.occurredAt.toISOString()).toBe("2026-10-13T14:30:00.000Z");
  });

  it("refuse un type inconnu et un objet vide", () => {
    expect(createActivitySchema.safeParse({ ...valid, type: "fax" }).success).toBe(false);
    expect(createActivitySchema.safeParse({ ...valid, subject: " " }).success).toBe(false);
  });

  it("refuse une date absente ou mal formée", () => {
    expect(createActivitySchema.safeParse({ ...valid, occurredAt: "" }).success).toBe(false);
    expect(createActivitySchema.safeParse({ ...valid, occurredAt: "2026-13-45T99:99" }).success).toBe(false);
  });

  it("exige la prochaine action ET sa date ensemble", () => {
    const onlyDate = createActivitySchema.safeParse({ ...valid, nextActionDate: "2026-10-20" });
    expect(onlyDate.success).toBe(false);
    expect(onlyDate.error?.issues[0].path).toEqual(["nextAction"]);

    const onlyAction = createActivitySchema.safeParse({ ...valid, nextAction: "Relancer" });
    expect(onlyAction.success).toBe(false);
    expect(onlyAction.error?.issues[0].path).toEqual(["nextActionDate"]);

    expect(createActivitySchema.safeParse({ ...valid, nextAction: "Relancer", nextActionDate: "2026-10-20" }).success).toBe(true);
  });

  it("traite les champs vides des formulaires comme absents", () => {
    const parsed = createActivitySchema.safeParse({ ...valid, contactId: "", opportunityId: "", outcome: "", nextAction: "", nextActionDate: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.contactId).toBeUndefined();
  });
});

describe("filtres du fil", () => {
  it("accepte les types d'activité, « task » et « stage »", () => {
    for (const type of ["email", "task", "stage"]) expect(feedFiltersSchema.safeParse({ type }).success).toBe(true);
    expect(feedFiltersSchema.safeParse({ type: "inconnu" }).success).toBe(false);
  });

  it("lit les bornes de période comme des jours UTC", () => {
    const parsed = feedFiltersSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" });
    expect(parsed.data?.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("schéma d'une tâche", () => {
  it("applique la priorité normale par défaut", () => {
    const parsed = createTaskSchema.safeParse({ title: "Relancer", dueDate: "2026-10-20" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.priority).toBe("normal");
  });

  it("refuse un titre vide, une échéance absente et une priorité inconnue", () => {
    expect(createTaskSchema.safeParse({ title: "", dueDate: "2026-10-20" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Relancer", dueDate: "" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Relancer", dueDate: "2026-10-20", priority: "urgente" }).success).toBe(false);
  });

  it("valide le changement de statut", () => {
    expect(setTaskStatusSchema.safeParse({ id: uuid, version: "2", status: "done" }).success).toBe(true);
    expect(setTaskStatusSchema.safeParse({ id: uuid, version: "2", status: "archived" }).success).toBe(false);
  });

  it("ignore une vue ou une page invalide plutôt que d'échouer", () => {
    const parsed = taskListSchema.parse({ view: "n'importe quoi", page: "-4", assigneeId: "pas-un-uuid" });
    expect(parsed).toEqual({ view: "open", page: 1, assigneeId: undefined });
  });
});
