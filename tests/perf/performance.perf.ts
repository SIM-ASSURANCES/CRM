import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { SECTORS } from "@/features/leads/config";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests de performance sur un jeu de données réaliste (plan 4.7 : « tests de performance sur jeu de données
// réaliste »). Lancement : `npm run test:perf`, sur la base de test uniquement (jamais sur la base de développement).
//
// Jeu de données : 5 000 comptes, 15 000 contacts, 10 000 opportunités (dont 6 000 ouvertes), 40 000 activités et
// 10 000 tâches, réparties entre 30 commerciaux, 3 managers, une direction et un administrateur. Chaque écran clé est
// mesuré plusieurs fois ; la MÉDIANE doit tenir dans le budget. Les budgets sont larges (machine de développement) :
// ils détectent une régression d'ordre de grandeur (index manquant, requête N+1), pas une variation de quelques ms.

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

const SIZE = { accounts: 5_000, contacts: 15_000, opportunities: 10_000, activities: 40_000, tasks: 10_000 };
const RUNS = 5;
const DAY = 86_400_000;

/** Générateur pseudo-aléatoire déterministe : le même jeu de données à chaque exécution, donc des mesures comparables. */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Measure = { label: string; median: number; max: number; budget: number };

describe.skipIf(!hasDb)("performance sur jeu de données réaliste (PostgreSQL)", () => {
  let db: Db;
  const rand = mulberry32(20261014);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const results: Measure[] = [];

  const svc = {
    acc: undefined as unknown as typeof import("@/features/accounts/service"),
    con: undefined as unknown as typeof import("@/features/contacts/service"),
    opp: undefined as unknown as typeof import("@/features/opportunities/service"),
    act: undefined as unknown as typeof import("@/features/activities/service"),
    tsk: undefined as unknown as typeof import("@/features/tasks/service"),
    auto: undefined as unknown as typeof import("@/features/automations/engine"),
    imp: undefined as unknown as typeof import("@/features/imports/service"),
    audit: undefined as unknown as typeof import("@/features/audit/service"),
  };

  let admin: CurrentUser;
  let direction: CurrentUser;
  let manager: CurrentUser;
  let commercial: CurrentUser;
  let accountIds: string[] = [];
  let busiestAccountId = "";

  async function user(role: Role, label: string, teamId: string | null = null): Promise<CurrentUser> {
    const email = `perf-${label}@test.local`;
    const existing = await db.user.findUnique({ where: { email } });
    const row =
      existing ?? (await db.user.create({ data: { name: `Perf ${label}`, email, role, teamId, emailVerified: true } }));
    if (existing && existing.teamId !== teamId) await db.user.update({ where: { id: existing.id }, data: { teamId } });
    return { id: row.id, name: row.name, email: row.email, role, teamId, mustChangePassword: false };
  }

  async function wipe() {
    await db.notification.deleteMany();
    await db.automationRun.deleteMany();
    await db.importRow.deleteMany();
    await db.importBatch.deleteMany();
    await db.activity.deleteMany();
    await db.task.deleteMany();
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
    await db.opportunityContact.deleteMany();
    await db.opportunityEvent.deleteMany();
    await db.opportunity.deleteMany();
    await db.contactRole.deleteMany();
    await db.accountContact.deleteMany();
    await db.contact.deleteMany();
    await db.crmAccount.updateMany({ data: { parentAccountId: null, mergedIntoId: null } });
    await db.crmAccount.deleteMany();
  }

  async function chunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 2_500) {
    for (let start = 0; start < rows.length; start += size) await insert(rows.slice(start, start + size));
  }

  /** Chronomètre `fn` plusieurs fois et vérifie que la médiane tient dans le budget. */
  async function measure(label: string, budget: number, fn: () => Promise<unknown>, runs = RUNS) {
    const times: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      await fn();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    results.push({ label, median: Math.round(median), max: Math.round(times[times.length - 1]), budget });
    expect(median, `${label} : médiane ${Math.round(median)} ms, budget ${budget} ms`).toBeLessThan(budget);
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    svc.acc = await import("@/features/accounts/service");
    svc.con = await import("@/features/contacts/service");
    svc.opp = await import("@/features/opportunities/service");
    svc.act = await import("@/features/activities/service");
    svc.tsk = await import("@/features/tasks/service");
    svc.auto = await import("@/features/automations/engine");
    svc.imp = await import("@/features/imports/service");
    svc.audit = await import("@/features/audit/service");

    admin = await user("admin", "admin");
    direction = await user("direction", "direction");
    const team = await db.team.upsert({ where: { name: "Équipe performance" }, update: {}, create: { name: "Équipe performance" } });
    manager = await user("manager", "manager", team.id);
    await db.team.update({ where: { id: team.id }, data: { managerUserId: manager.id } });
    const sellers: CurrentUser[] = [];
    for (let i = 0; i < 30; i += 1) sellers.push(await user("commercial", `vendeur-${i}`, i < 10 ? team.id : null));
    commercial = sellers[0];

    await wipe();
    const now = Date.now();

    // Comptes : un propriétaire par compte, des identifiants légaux pour 60 % d'entre eux.
    const owners = sellers.map((seller) => seller.id);
    const accountRows: Prisma.CrmAccountCreateManyInput[] = Array.from({ length: SIZE.accounts }, (_, i) => ({
      id: randomUUID(),
      legalName: `Entreprise ${i} ${pick(["Alpha", "Béta", "Gamma", "Delta", "Omega", "Sigma"])} ${pick(["SARL", "SA", "Group", "Services"])}`,
      legalIdentifier: rand() < 0.6 ? `PERF-${i}` : null,
      sector: pick(SECTORS),
      employeeCount: Math.floor(rand() * 900),
      status: pick(["prospect", "client", "client", "inactive", "partner"]),
      city: pick(["Abidjan", "Bouaké", "Yamoussoukro", "San-Pédro", "Korhogo"]),
      country: "CI",
      ownerUserId: pick(owners),
      createdAt: new Date(now - Math.floor(rand() * 400) * DAY),
    }));
    await chunked(accountRows, (chunk) => db.crmAccount.createMany({ data: chunk }));
    accountIds = accountRows.map((row) => row.id as string);
    const ownerOf = new Map(accountRows.map((row) => [row.id as string, row.ownerUserId]));

    // Contacts : 3 par compte en moyenne, le premier de chaque compte est le contact principal.
    const contactRows: Prisma.ContactCreateManyInput[] = [];
    const linkRows: Prisma.AccountContactCreateManyInput[] = [];
    for (let i = 0; i < SIZE.contacts; i += 1) {
      const accountId = accountIds[i % SIZE.accounts];
      const id = randomUUID();
      contactRows.push({
        id,
        firstName: pick(["Awa", "Yao", "Fatou", "Koffi", "Aïcha", "Moussa", "Adjoua"]),
        lastName: `Nom${i}`,
        email: `contact${i}@perf.ci`,
        jobTitle: pick(["Directeur général", "DAF", "DRH", "Responsable achats"]),
        ownerUserId: ownerOf.get(accountId) as string,
      });
      linkRows.push({ accountId, contactId: id, isPrimary: i < SIZE.accounts });
    }
    await chunked(contactRows, (chunk) => db.contact.createMany({ data: chunk }));
    await chunked(linkRows, (chunk) => db.accountContact.createMany({ data: chunk }));

    // Opportunités : 60 % ouvertes (à toutes les étapes), 25 % gagnées cette année, 15 % perdues.
    const stages = [10, 20, 40, 60, 80, 90];
    const opportunityRows: Prisma.OpportunityCreateManyInput[] = Array.from({ length: SIZE.opportunities }, (_, i) => {
      const accountId = pick(accountIds);
      const draw = rand();
      const base = {
        id: randomUUID(),
        name: `Opportunité ${i}`,
        accountId,
        ownerUserId: ownerOf.get(accountId) as string,
        amount: Math.round(rand() * 50_000_000),
        createdAt: new Date(now - Math.floor(rand() * 300) * DAY),
      };
      if (draw < 0.6) {
        return {
          ...base,
          stage: pick(stages),
          expectedCloseDate: new Date(now + Math.floor(rand() * 120 - 30) * DAY),
          nextAction: "Relancer",
          nextActionDate: new Date(now + Math.floor(rand() * 40 - 10) * DAY),
        };
      }
      if (draw < 0.85) return { ...base, stage: 100, status: "won", closedAt: new Date(now - Math.floor(rand() * 200) * DAY) };
      return { ...base, stage: pick(stages), status: "lost", lossReason: "price", closedAt: new Date(now - Math.floor(rand() * 200) * DAY) };
    });
    await chunked(opportunityRows, (chunk) => db.opportunity.createMany({ data: chunk }));

    // Activités : historique d'un an, avec des comptes très suivis et d'autres jamais contactés.
    const types = ["call_out", "call_in", "email", "meeting", "video", "note", "proposal_sent", "contract_step"];
    const activityRows: Prisma.ActivityCreateManyInput[] = Array.from({ length: SIZE.activities }, (_, i) => {
      // Les 20 % de comptes les plus suivis reçoivent la moitié des activités.
      const accountId = rand() < 0.5 ? accountIds[Math.floor(rand() * (SIZE.accounts / 5))] : pick(accountIds);
      return {
        id: randomUUID(),
        type: pick(types),
        subject: `Échange ${i}`,
        occurredAt: new Date(now - Math.floor(rand() * 365 * 24 * 60) * 60_000),
        authorUserId: ownerOf.get(accountId) as string,
        accountId,
      };
    });
    await chunked(activityRows, (chunk) => db.activity.createMany({ data: chunk }), 5_000);
    busiestAccountId = accountIds[0];

    const taskRows: Prisma.TaskCreateManyInput[] = Array.from({ length: SIZE.tasks }, (_, i) => {
      const accountId = pick(accountIds);
      const assignee = ownerOf.get(accountId) as string;
      const open = rand() < 0.7;
      return {
        id: randomUUID(),
        title: `Tâche ${i}`,
        dueDate: new Date(now + Math.floor(rand() * 120 - 60) * DAY),
        status: open ? "open" : "done",
        completedAt: open ? null : new Date(now - Math.floor(rand() * 60) * DAY),
        assigneeUserId: assignee,
        createdByUserId: assignee,
        accountId,
      };
    });
    await chunked(taskRows, (chunk) => db.task.createMany({ data: chunk }));
  });

  afterAll(async () => {
    console.table(results.map((r) => ({ Écran: r.label, "Médiane (ms)": r.median, "Max (ms)": r.max, "Budget (ms)": r.budget })));
    await wipe();
    await db?.$disconnect();
  });

  it("charge le jeu de données prévu", async () => {
    expect(await db.crmAccount.count()).toBe(SIZE.accounts);
    expect(await db.contact.count()).toBe(SIZE.contacts);
    expect(await db.opportunity.count()).toBe(SIZE.opportunities);
    expect(await db.activity.count()).toBe(SIZE.activities);
    expect(await db.task.count()).toBe(SIZE.tasks);
  });

  describe("listes", () => {
    it("liste des comptes (direction, tous les comptes)", async () => {
      await measure("Comptes : page 1 (direction)", 1_000, () => svc.acc.listAccounts(direction, { page: 1 }));
      await measure("Comptes : page 100 (direction)", 1_000, () => svc.acc.listAccounts(direction, { page: 100 }));
    });

    it("liste des comptes (commercial, périmètre restreint)", async () => {
      await measure("Comptes : page 1 (commercial)", 1_000, () => svc.acc.listAccounts(commercial, { page: 1 }));
    });

    it("recherche d'un compte par nom", async () => {
      await measure("Comptes : recherche « Omega » (direction)", 1_500, () => svc.acc.listAccounts(direction, { q: "Omega", page: 1 }));
    });

    it("liste et recherche des contacts", async () => {
      await measure("Contacts : page 1 (direction)", 1_000, () => svc.con.listContacts(direction, { page: 1 }));
      await measure("Contacts : recherche « Nom1234 » (direction)", 1_500, () => svc.con.listContacts(direction, { q: "Nom1234", page: 1 }));
      await measure("Contacts : page 1 (manager)", 1_500, () => svc.con.listContacts(manager, { page: 1 }));
    });
  });

  describe("fiches", () => {
    it("fiche compte (contacts, filiales, complétude)", async () => {
      await measure("Fiche compte (direction)", 1_000, () => svc.acc.getAccount(direction, busiestAccountId));
    });
  });

  describe("pipeline", () => {
    it("Kanban des opportunités", async () => {
      await measure("Kanban : 6 000 opportunités ouvertes (direction)", 2_000, () => svc.opp.listBoard(direction, {}));
      await measure("Kanban : périmètre du manager", 2_000, () => svc.opp.listBoard(manager, {}));
      await measure("Kanban : un commercial", 1_000, () => svc.opp.listBoard(commercial, {}));
      await measure("Kanban : recherche « Opportunité 12 »", 2_000, () => svc.opp.listBoard(direction, { q: "Opportunité 12" }));
    });

    it("liste des opportunités", async () => {
      await measure("Opportunités : liste paginée (direction)", 1_000, () => svc.opp.listOpportunities(direction, { status: "open", page: 1 }));
    });
  });

  describe("suivi", () => {
    it("fil d'activité", async () => {
      await measure("Fil : global (direction)", 2_000, () => svc.act.listFeed(direction, {}));
      await measure("Fil : un compte très suivi", 1_000, () => svc.act.listFeed(direction, { accountId: busiestAccountId }));
      await measure("Fil : filtré par type et période", 2_000, () =>
        svc.act.listFeed(direction, { type: "meeting", from: new Date(Date.now() - 90 * DAY) }),
      );
      await measure("Fil : un commercial", 1_500, () => svc.act.listFeed(commercial, {}));
    });

    it("tâches", async () => {
      await measure("Tâches : à faire (commercial)", 1_000, () => svc.tsk.listTasks(commercial, { view: "open", assigneeId: commercial.id }));
      await measure("Tâches : en retard, toutes visibles (direction)", 1_500, () => svc.tsk.listTasks(direction, { view: "late", assigneeId: null }));
    });

    it("journal d'audit", async () => {
      await measure("Audit : première page", 1_000, () => svc.audit.listAuditLogs(admin, {}));
    });
  });

  describe("traitements", () => {
    it("exécute toutes les règles d'automatisation sur le jeu de données", async () => {
      await measure("Automatisations : les 5 règles", 15_000, () => svc.auto.runAutomations({ trigger: "manual" }), 2);
    });

    it("analyse puis importe 2 000 comptes contre 5 000 existants", async () => {
      const header = "Raison sociale;RCCM;Secteur;Statut;Ville";
      const lines = Array.from({ length: 2_000 }, (_, i) =>
        // Une ligne sur vingt reprend un compte existant (doublon), les autres sont nouvelles.
        i % 20 === 0
          ? `Entreprise ${i} Alpha SARL;PERF-${i};Santé;Client;Abidjan`
          : `Importée ${i} Zêta;IMP-${i};Santé;Prospect;Abidjan`,
      );
      const { id } = await svc.imp.createBatch(admin, { entity: "accounts", filename: "perf.csv", buffer: Buffer.from([header, ...lines].join("\n")) });

      const defaults = { ownerUserId: commercial.id };
      const mapping = { legalName: "Raison sociale", legalIdentifier: "RCCM", sector: "Secteur", status: "Statut", city: "Ville" };

      const analyzeStart = performance.now();
      const summary = await svc.imp.analyzeBatch(admin, { id, mapping, defaults });
      const analyzeMs = Math.round(performance.now() - analyzeStart);
      results.push({ label: "Import : analyse de 2 000 lignes", median: analyzeMs, max: analyzeMs, budget: 10_000 });
      expect(analyzeMs, `analyse : ${analyzeMs} ms`).toBeLessThan(10_000);
      expect(summary.validRows).toBeGreaterThan(1_800);

      const importStart = performance.now();
      const outcome = await svc.imp.importBatch(admin, id);
      const importMs = Math.round(performance.now() - importStart);
      results.push({ label: `Import : création de ${outcome.imported} comptes`, median: importMs, max: importMs, budget: 60_000 });
      expect(importMs, `import : ${importMs} ms`).toBeLessThan(60_000);
      expect(outcome).toMatchObject({ failed: 0, remaining: 0 });
    });
  });
});
