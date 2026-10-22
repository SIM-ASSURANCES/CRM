import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Historique des prospects (nouveaux par jour / semaine, et nombre à chaque étape) sur la base dédiée. Les prospects et leurs
// événements sont créés directement, à des dates connues : l'historique est reconstitué à partir de ces événements.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];
type History = typeof import("@/features/leads/history");

// Mercredi 21 octobre 2026, midi (UTC) : la semaine ISO 43 va du lundi 19 au dimanche 25.
const NOW = new Date("2026-10-21T12:00:00.000Z");
const at = (iso: string) => new Date(iso);
const PARAMS = { weeks: 4, days: 14 };

describe.skipIf(!hasDb)("historique des prospects (PostgreSQL)", () => {
  let db: Db;
  let history: History;
  let a: CurrentUser;
  let b: CurrentUser;
  let manager: CurrentUser;
  let direction: CurrentUser;

  async function makeUser(role: Role, label: string, teamId: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}@test.local`, role, emailVerified: true, teamId },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId, mustChangePassword: false };
  }

  type Step = { when: string; type: string; from: number | null; to: number; status: string };

  /** Crée un prospect (état final) et son historique daté. */
  async function lead(owner: CurrentUser, insertedOn: string, final: { progress: number; status: string }, steps: Step[]) {
    const id = randomUUID().slice(0, 8);
    const created = await db.lead.create({
      data: {
        companyName: `Société ${id}`,
        sector: "Santé",
        contactLastName: "Kouassi",
        contactFirstName: "Yao",
        phone: `+22507${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        email: `yao-${id}@client.ci`,
        jobTitle: "Directeur",
        insertedOn: at(`${insertedOn}T00:00:00.000Z`),
        progress: final.progress,
        status: final.status,
        lossReason: final.status === "lost" ? "price" : null,
        closedAt: final.status === "open" ? null : at("2026-10-20T09:00:00.000Z"),
        ownerUserId: owner.id,
      },
    });
    for (const step of steps) {
      await db.leadEvent.create({
        data: { leadId: created.id, occurredAt: at(step.when), type: step.type, fromProgress: step.from, toProgress: step.to, status: step.status },
      });
    }
    return created.id;
  }

  /** Nombre de prospects qui existent à une date : L5 dès le 13, L2 et L3 dès le 14, L1 dès le 19, L4 dès le 20. */
  const existing = (date: string) => ["2026-10-13", "2026-10-14", "2026-10-14", "2026-10-19", "2026-10-20"].filter((since) => since <= date).length;

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    history = await import("@/features/leads/history");
    const team = await db.team.create({ data: { name: `Équipe historique ${randomUUID().slice(0, 6)}` } });
    a = await makeUser("commercial", "Historique A", team.id);
    b = await makeUser("commercial", "Historique B");
    manager = await makeUser("manager", "Historique Manager", team.id);
    direction = await makeUser("direction", "Historique Direction");
  });

  beforeEach(async () => {
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();

    // A : L1 (cette semaine, passe à 40 % mardi), L2 (semaine passée, 60 % vendredi puis gagné mercredi), L3 (semaine passée, perdu mardi).
    await lead(a, "2026-10-19", { progress: 40, status: "open" }, [
      { when: "2026-10-19T08:00:00.000Z", type: "created", from: null, to: 10, status: "open" },
      { when: "2026-10-20T10:00:00.000Z", type: "progress_changed", from: 10, to: 40, status: "open" },
    ]);
    await lead(a, "2026-10-14", { progress: 100, status: "won" }, [
      { when: "2026-10-14T08:00:00.000Z", type: "created", from: null, to: 10, status: "open" },
      { when: "2026-10-16T08:00:00.000Z", type: "progress_changed", from: 10, to: 60, status: "open" },
      { when: "2026-10-21T08:00:00.000Z", type: "won", from: 60, to: 100, status: "won" },
    ]);
    await lead(a, "2026-10-14", { progress: 10, status: "lost" }, [
      { when: "2026-10-14T09:00:00.000Z", type: "created", from: null, to: 10, status: "open" },
      { when: "2026-10-20T09:00:00.000Z", type: "lost", from: 10, to: 10, status: "lost" },
    ]);
    // B : L4 (mardi, 10 %) et L5 (insertion le 13, mais SAISI seulement le 21 : il compte à partir du 13).
    await lead(b, "2026-10-20", { progress: 10, status: "open" }, [
      { when: "2026-10-20T09:00:00.000Z", type: "created", from: null, to: 10, status: "open" },
    ]);
    await lead(b, "2026-10-13", { progress: 20, status: "open" }, [
      { when: "2026-10-21T08:00:00.000Z", type: "created", from: null, to: 20, status: "open" },
    ]);
  });

  afterAll(async () => {
    await db?.leadEvent.deleteMany();
    await db?.lead.deleteMany();
    await db?.$disconnect();
  });

  it("compte les nouveaux prospects par semaine et les compare à la semaine précédente", async () => {
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    const week = (label: string) => result.weeks.find((point) => point.label === label)!;

    expect(result.weeks.map((point) => point.label)).toEqual(["S40", "S41", "S42", "S43"]);
    expect(week("S43")).toMatchObject({ newProspects: 2, current: true }); // L1 (19), L4 (20)
    expect(week("S42")).toMatchObject({ newProspects: 3, current: false }); // L2, L3 (14), L5 (13)
    expect(week("S43").comparison).toMatchObject({ current: 2, previous: 3, diff: -1 });
    expect(week("S41").newProspects).toBe(0);
    expect(result.summary.thisWeek).toMatchObject({ current: 2, previous: 3 });
    // Moyenne des 3 semaines complètes (S40 = 0, S41 = 0, S42 = 3).
    expect(result.summary.averagePrevious).toBeCloseTo(1, 5);
    expect(result.summary.vsAverage).toMatchObject({ current: 2, previous: 1, diff: 1 });
  });

  it("compte les nouveaux prospects par jour et les compare au même jour de la semaine précédente", async () => {
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    const day = (date: string) => result.days.find((point) => point.date === date)!;

    expect(result.days).toHaveLength(14);
    expect(day("2026-10-20")).toMatchObject({ newProspects: 1, sameDayLastWeek: 1 }); // L4 ; le mardi 13 : L5
    expect(day("2026-10-14")).toMatchObject({ newProspects: 2, sameDayLastWeek: 0 }); // L2, L3
    expect(day("2026-10-15").newProspects).toBe(0);
    expect(result.summary.today).toBe(0);
  });

  it("reconstitue le nombre de prospects à chaque étape à la fin de la semaine précédente", async () => {
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    const endOfS42 = result.weeks.find((point) => point.label === "S42")!.stages;

    // Au dimanche 18 : L2 à 60 %, L3 à 10 %, L5 à 20 % (compté dès le 13, bien que saisi le 21) ; L1 et L4 n'existent pas encore.
    expect(endOfS42.stages).toEqual({ 10: 1, 20: 1, 40: 0, 60: 1, 80: 0, 90: 0 });
    expect(endOfS42).toMatchObject({ open: 3, won: 0, lost: 0 });
  });

  it("reconstitue la situation actuelle : étapes ouvertes, gagnés et perdus", async () => {
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    const current = result.weeks.find((point) => point.current)!.stages;

    // L1 à 40 %, L4 à 10 %, L5 à 20 % ; L2 gagné ; L3 perdu.
    expect(current.stages).toEqual({ 10: 1, 20: 1, 40: 1, 60: 0, 80: 0, 90: 0 });
    expect(current).toMatchObject({ open: 3, won: 1, lost: 1 });
    expect(result.summary.current).toEqual(current);
  });

  it("reconstitue aussi la situation jour par jour", async () => {
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    const day = (date: string) => result.days.find((point) => point.date === date)!.stages;

    expect(day("2026-10-13")).toMatchObject({ open: 1, stages: { 20: 1 } }); // seulement L5
    expect(day("2026-10-14")).toMatchObject({ open: 3, stages: { 10: 2, 20: 1 } }); // + L2 et L3
    expect(day("2026-10-17")).toMatchObject({ open: 3, stages: { 10: 1, 20: 1, 60: 1 } }); // L2 passé à 60 % le 16
    // Le 20 : L1 (40 %), L2 (60 %), L4 (10 %), L5 (20 %) ouverts ; L3 perdu.
    expect(day("2026-10-20").stages).toEqual({ 10: 1, 20: 1, 40: 1, 60: 1, 80: 0, 90: 0 });
    expect(day("2026-10-20")).toMatchObject({ open: 4, lost: 1, won: 0 });
  });

  it("garde la somme des états égale au nombre de prospects existants à chaque date", async () => {
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    for (const point of result.days) {
      expect(point.stages.open + point.stages.won + point.stages.lost, point.date).toBe(existing(point.date));
    }
  });

  it("donne les mêmes chiffres que le tableau de bord pour la même semaine", async () => {
    const kpi = await import("@/features/leads/kpi");
    const dashboard = await kpi.getDashboardKpis(direction, NOW);
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    const current = result.weeks.find((point) => point.current)!;

    expect(current.newProspects).toBe(dashboard.newProspects.current);
    expect(current.comparison.previous).toBe(dashboard.newProspects.previous);
    expect(current.label).toBe(dashboard.weekLabel);
  });

  it("limite l'historique au périmètre : un commercial ne voit que ses prospects", async () => {
    const result = await history.getProspectHistory(a, PARAMS, NOW);
    const week = (label: string) => result.weeks.find((point) => point.label === label)!;

    expect(week("S43").newProspects).toBe(1); // L1 seulement (L4 est à B)
    expect(week("S42").newProspects).toBe(2); // L2, L3
    expect(result.summary.current).toMatchObject({ open: 1, won: 1, lost: 1 });

    const other = await history.getProspectHistory(b, PARAMS, NOW);
    expect(other.weeks.find((point) => point.label === "S43")!.newProspects).toBe(1); // L4
  });

  it("filtre par commercial pour la direction, mais pas pour un commercial", async () => {
    const filtered = await history.getProspectHistory(direction, { ...PARAMS, ownerId: b.id }, NOW);
    expect(filtered.weeks.find((point) => point.current)!.newProspects).toBe(1);
    expect(filtered.summary.current).toMatchObject({ open: 2, won: 0, lost: 0 });

    // Le commercial A demande les prospects de B : le filtre est ignoré, il garde son propre périmètre.
    const own = await history.getProspectHistory(a, { ...PARAMS, ownerId: b.id }, NOW);
    expect(own.weeks.find((point) => point.current)!.newProspects).toBe(1);
    expect(own.summary.current).toMatchObject({ open: 1, won: 1, lost: 1 });
  });

  it("limite le manager à son équipe", async () => {
    const result = await history.getProspectHistory(manager, PARAMS, NOW);
    // A est dans l'équipe du manager, B non.
    expect(result.weeks.find((point) => point.current)!.newProspects).toBe(1);
    expect(result.summary.current).toMatchObject({ open: 1, won: 1, lost: 1 });
  });

  it("renvoie des zéros, sans erreur, quand il n'y a aucun prospect", async () => {
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
    const result = await history.getProspectHistory(direction, PARAMS, NOW);
    expect(result.weeks.every((point) => point.newProspects === 0)).toBe(true);
    expect(result.days.every((point) => point.stages.open === 0)).toBe(true);
    expect(result.summary).toMatchObject({ today: 0, averagePrevious: 0 });
    expect(result.summary.thisWeek.pct).toBeNull();
  });
});
