import { describe, expect, it } from "vitest";
import { RULES, RULE_CODES, defaultParams, paramsSchema, resolveParams } from "@/features/automations/config";
import {
  daysBetween,
  groupBy,
  inactiveDays,
  inactivityThresholdDays,
  periodKey,
  plural,
  shouldEscalate,
  summarizeNames,
} from "@/features/automations/rules";

const day = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h));

describe("période et idempotence", () => {
  it("donne la même clé tout au long d'une même période", () => {
    expect(periodKey(day(13, 0), 1)).toBe(periodKey(day(13, 23), 1));
    expect(periodKey(day(13), 1)).not.toBe(periodKey(day(14), 1));
  });

  it("regroupe plusieurs jours dans une même période hebdomadaire", () => {
    const keys = [8, 9, 10, 11, 12, 13, 14].map((d) => periodKey(day(d), 7));
    expect(new Set(keys).size).toBeLessThanOrEqual(2);
    expect(periodKey(day(1), 7)).not.toBe(periodKey(day(29), 7));
  });

  it("traite une fréquence nulle comme un jour", () => {
    expect(periodKey(day(13), 0)).toBe(periodKey(day(13), 1));
  });
});

describe("inactivité par segment (CDC 6.2)", () => {
  const segments = { largeAccountMinEmployees: 250, largeDays: 15, standardDays: 30 };

  it("applique le seuil court aux grands comptes et le seuil long aux autres", () => {
    expect(inactivityThresholdDays(850, segments)).toBe(15);
    expect(inactivityThresholdDays(250, segments)).toBe(15);
    expect(inactivityThresholdDays(249, segments)).toBe(30);
    expect(inactivityThresholdDays(null, segments)).toBe(30);
  });

  it("détecte l'inactivité à partir de la dernière activité", () => {
    expect(inactiveDays(day(1), day(1), day(16), 15)).toBe(15);
    expect(inactiveDays(day(2), day(1), day(16), 15)).toBeNull();
  });

  it("prend la création du compte comme référence en l'absence d'activité", () => {
    expect(inactiveDays(null, day(1), day(20), 15)).toBe(19);
    expect(inactiveDays(null, day(10), day(20), 15)).toBeNull();
  });

  it("compte des jours calendaires, pas des durées de 24 heures", () => {
    expect(daysBetween(day(1, 23), day(2, 1))).toBe(1);
    expect(daysBetween(day(1, 1), day(1, 23))).toBe(0);
  });
});

describe("escalade et regroupement", () => {
  it("escalade dès que le retard atteint le délai", () => {
    expect(shouldEscalate(2, 3)).toBe(false);
    expect(shouldEscalate(3, 3)).toBe(true);
  });

  it("résume une liste en gardant les premiers noms", () => {
    expect(summarizeNames([])).toBe("");
    expect(summarizeNames(["A"])).toBe("A");
    expect(summarizeNames(["A", "B"])).toBe("A et B");
    expect(summarizeNames(["A", "B", "C"])).toBe("A, B et C");
    expect(summarizeNames(["A", "B", "C", "D"])).toBe("A, B, C et 1 autre");
    expect(summarizeNames(["A", "B", "C", "D", "E"])).toBe("A, B, C et 2 autres");
  });

  it("accorde les libellés", () => {
    expect(plural(1, "tâche")).toBe("1 tâche");
    expect(plural(3, "tâche")).toBe("3 tâches");
    expect(plural(2, "compte")).toBe("2 comptes");
  });

  it("regroupe par destinataire", () => {
    const groups = groupBy([{ o: "a" }, { o: "b" }, { o: "a" }], (item) => item.o);
    expect(groups.get("a")).toHaveLength(2);
    expect(groups.get("b")).toHaveLength(1);
  });
});

describe("paramètres des règles", () => {
  it("reprend les valeurs du cahier des charges par défaut", () => {
    expect(defaultParams("inactivity")).toMatchObject({ largeDays: 15, standardDays: 30, largeAccountMinEmployees: 250 });
    expect(defaultParams("meeting_soon")).toEqual({ hoursBefore: 24 });
  });

  it("définit des paramètres pour chaque règle connue", () => {
    for (const code of RULE_CODES) expect(RULES[code].params.length).toBeGreaterThan(0);
  });

  it("valide les bornes et refuse les valeurs non entières", () => {
    const schema = paramsSchema("meeting_soon");
    expect(schema.safeParse({ hoursBefore: "48" }).success).toBe(true);
    expect(schema.safeParse({ hoursBefore: 0 }).success).toBe(false);
    expect(schema.safeParse({ hoursBefore: 500 }).success).toBe(false);
    expect(schema.safeParse({ hoursBefore: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ hoursBefore: "" }).success).toBe(false);
  });

  it("retombe sur les valeurs par défaut quand le stockage est absent ou invalide", () => {
    expect(resolveParams("task_overdue", null)).toEqual(defaultParams("task_overdue"));
    expect(resolveParams("task_overdue", { frequencyDays: -4 })).toEqual(defaultParams("task_overdue"));
    expect(resolveParams("task_overdue", { frequencyDays: 2 })).toEqual({ ...defaultParams("task_overdue"), frequencyDays: 2 });
  });
});
