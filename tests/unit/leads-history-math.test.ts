import { describe, expect, it } from "vitest";
import {
  addToStageCounts,
  averagePreviousWeeks,
  buildDailySeries,
  buildWeeklySeries,
  dayKey,
  dayWindows,
  earliestNeededDay,
  emptyStageCounts,
  parseHistoryParams,
  snapshotInstant,
  snapshotInstants,
  weekWindows,
  type StageCounts,
} from "@/features/leads/history-math";

// Mercredi 21 octobre 2026, midi (UTC) : la semaine ISO 43 va du lundi 19 au dimanche 25.
const NOW = new Date("2026-10-21T12:00:00.000Z");

describe("parseHistoryParams", () => {
  it("retombe sur les valeurs par défaut quand l'adresse est absente ou invalide", () => {
    expect(parseHistoryParams({})).toEqual({ weeks: 12, days: 30, ownerId: undefined });
    expect(parseHistoryParams({ semaines: "7", jours: "abc", commercial: "pas-un-uuid" })).toEqual({ weeks: 12, days: 30, ownerId: undefined });
  });

  it("accepte les choix proposés et un commercial valide", () => {
    const id = "01a13f97-14c6-73bb-becc-cfccd53ba4d4";
    expect(parseHistoryParams({ semaines: "26", jours: "60", commercial: id })).toEqual({ weeks: 26, days: 60, ownerId: id });
  });
});

describe("fenêtres de temps", () => {
  it("les jours vont du plus ancien à aujourd'hui, sans trou", () => {
    const days = dayWindows(NOW, 14);
    expect(days).toHaveLength(14);
    expect(dayKey(days[0].start)).toBe("2026-10-08");
    expect(dayKey(days.at(-1)!.start)).toBe("2026-10-21");
    expect(days.every((day, index) => index === 0 || day.start.getTime() === days[index - 1].end.getTime())).toBe(true);
  });

  it("les semaines vont du lundi au dimanche, la dernière est la semaine en cours", () => {
    const weeks = weekWindows(NOW, 4);
    expect(weeks.map((week) => dayKey(week.start))).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(weeks.at(-1)!.end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("photographie la fin d'une période terminée, et l'instant présent pour une période en cours", () => {
    expect(snapshotInstant(new Date("2026-10-19T00:00:00.000Z"), NOW).toISOString()).toBe("2026-10-18T23:59:59.999Z");
    expect(snapshotInstant(new Date("2026-10-26T00:00:00.000Z"), NOW).toISOString()).toBe(NOW.toISOString());
  });

  it("ne photographie qu'une fois un instant commun aux jours et aux semaines", () => {
    const instants = snapshotInstants(dayWindows(NOW, 14), weekWindows(NOW, 4), NOW);
    const times = instants.map((instant) => instant.getTime());
    expect(new Set(times).size).toBe(times.length);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // La fin du dimanche 18 est à la fois la fin d'un jour et la fin d'une semaine.
    expect(times.filter((time) => time === new Date("2026-10-18T23:59:59.999Z").getTime())).toHaveLength(1);
    expect(times).toContain(NOW.getTime());
  });

  it("lit une semaine de plus que la plus ancienne fenêtre, pour la comparaison", () => {
    expect(dayKey(earliestNeededDay(dayWindows(NOW, 14), weekWindows(NOW, 4)))).toBe("2026-09-21");
  });
});

describe("addToStageCounts", () => {
  it("range les prospects par étape ouverte, gagnés et perdus", () => {
    const counts = emptyStageCounts();
    addToStageCounts(counts, "open", 40, 3);
    addToStageCounts(counts, "open", 10, 1);
    addToStageCounts(counts, "won", 100, 2);
    addToStageCounts(counts, "lost", 20, 4);
    addToStageCounts(counts, "open", 55, 9); // étape inconnue : ignorée
    expect(counts).toEqual({ stages: { 10: 1, 20: 0, 40: 3, 60: 0, 80: 0, 90: 0 }, open: 4, won: 2, lost: 4 });
  });
});

describe("séries", () => {
  const newByDay = new Map<string, number>([
    ["2026-10-13", 2],
    ["2026-10-14", 1],
    ["2026-10-19", 3],
    ["2026-10-20", 1],
  ]);

  it("compte les nouveaux prospects par semaine et les compare à la semaine précédente", () => {
    const weeks = buildWeeklySeries(weekWindows(NOW, 2), newByDay, new Map(), NOW);
    expect(weeks.map((week) => [week.label, week.start, week.end, week.newProspects, week.current])).toEqual([
      ["S42", "2026-10-12", "2026-10-18", 3, false],
      ["S43", "2026-10-19", "2026-10-25", 4, true],
    ]);
    expect(weeks[1].comparison).toMatchObject({ current: 4, previous: 3, diff: 1 });
    expect(weeks[1].comparison.pct).toBeCloseTo(33.33, 1);
  });

  it("ne calcule aucun pourcentage quand la semaine précédente est vide", () => {
    const weeks = buildWeeklySeries(weekWindows(NOW, 1), new Map([["2026-10-19", 2]]), new Map(), NOW);
    expect(weeks[0].comparison).toMatchObject({ current: 2, previous: 0, pct: null });
  });

  it("compare chaque jour au même jour de la semaine précédente", () => {
    const days = buildDailySeries(dayWindows(new Date("2026-10-21T12:00:00Z"), 8), newByDay, new Map(), NOW);
    const byDate = Object.fromEntries(days.map((day) => [day.date, [day.newProspects, day.sameDayLastWeek]]));
    // Lundi 19 (3 nouveaux) comparé au lundi 12 ; mardi 20 (1) au mardi 13 (2) ; mercredi 14 au mercredi 7.
    expect(byDate["2026-10-19"]).toEqual([3, 0]);
    expect(byDate["2026-10-20"]).toEqual([1, 2]);
    expect(byDate["2026-10-14"]).toEqual([1, 0]);
    expect(days.find((day) => day.date === "2026-10-20")!.comparison).toMatchObject({ diff: -1, pct: -50 });
  });

  it("associe à chaque période la situation photographiée à sa fin", () => {
    const endOfWeek42 = new Date("2026-10-18T23:59:59.999Z");
    const counts: StageCounts = { ...emptyStageCounts(), open: 5 };
    const weeks = buildWeeklySeries(weekWindows(NOW, 2), newByDay, new Map([[endOfWeek42.getTime(), counts]]), NOW);
    expect(weeks[0].stages.open).toBe(5);
    expect(weeks[1].stages.open).toBe(0);
  });

  it("calcule la moyenne des semaines complètes précédentes, sans la semaine en cours", () => {
    const weeks = buildWeeklySeries(weekWindows(NOW, 3), newByDay, new Map(), NOW);
    expect(averagePreviousWeeks(weeks)).toBe(1.5); // S41 = 0, S42 = 3
    expect(averagePreviousWeeks(weeks.slice(-1))).toBeNull();
  });
});
