import { describe, expect, it } from "vitest";
import { compareValues, isoWeek, weekWindow } from "@/features/leads/kpi-math";

describe("compareValues", () => {
  it("calcule la variation par rapport à la période PRÉCÉDENTE", () => {
    // Exemple de l'Excel : 25 prospects contre 20 la semaine d'avant = +25 % (et non +20 %).
    const result = compareValues(25, 20);
    expect(result.diff).toBe(5);
    expect(result.pct).toBe(25);
  });

  it("gère une baisse", () => {
    expect(compareValues(1, 3).pct).toBeCloseTo(-66.67, 1);
  });

  it("renvoie « non calculable » (null) quand la période précédente vaut zéro (CDC 8.1)", () => {
    expect(compareValues(5, 0).pct).toBeNull();
    expect(compareValues(0, 0).pct).toBeNull();
  });

  it("renvoie 0 % quand rien ne change", () => {
    expect(compareValues(7, 7).pct).toBe(0);
  });
});

describe("isoWeek", () => {
  it.each([
    ["2026-10-13", 42],
    ["2026-01-01", 1],
    ["2025-12-29", 1],
    ["2021-01-03", 53],
    ["2026-12-31", 53],
  ])("%s → semaine %i", (date, week) => {
    expect(isoWeek(new Date(`${date}T12:00:00Z`))).toBe(week);
  });
});

describe("weekWindow", () => {
  it("renvoie la semaine du lundi 00:00 UTC au lundi suivant", () => {
    const { start, end } = weekWindow(new Date("2026-10-14T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("traite le dimanche comme le dernier jour de la semaine", () => {
    expect(weekWindow(new Date("2026-10-18T23:59:00Z")).start.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("démarre une nouvelle semaine le lundi à minuit", () => {
    expect(weekWindow(new Date("2026-10-19T00:00:00Z")).start.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("décale de `weeksAgo` semaines", () => {
    const { start, end } = weekWindow(new Date("2026-10-14T10:00:00Z"), 1);
    expect(start.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
