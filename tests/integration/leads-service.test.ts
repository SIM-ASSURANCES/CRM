import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateLeadInput } from "@/features/leads/schemas";
import type { LeadView } from "@/features/leads/views";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests du service des prospects sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
// Les modules sont importés dynamiquement : sans base de test, rien n'est chargé et le fichier est ignoré.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];
type Service = typeof import("@/features/leads/service");
type Kpi = typeof import("@/features/leads/kpi");

describe.skipIf(!hasDb)("service des prospects (PostgreSQL)", () => {
  let db: Db;
  let svc: Service;
  let kpi: Kpi;
  let productId: string;
  let a: CurrentUser;
  let b: CurrentUser;
  let direction: CurrentUser;
  let audit: CurrentUser;

  async function makeUser(role: Role, label: string, suffix: string): Promise<CurrentUser> {
    const user = await db.user.create({
      data: {
        name: label,
        email: `${label.toLowerCase().replace(/\W+/g, "-")}-${suffix}@test.local`,
        role,
        emailVerified: true,
      },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: null, mustChangePassword: false };
  }

  /** Date du jour à minuit UTC : la date d'insertion d'un prospect saisi dans le CRM. */
  const todayUtc = (offsetDays = 0) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  };

  // Un prospect aux coordonnées uniques (sinon la détection de doublons se déclenche entre les tests).
  function leadInput(over: Partial<CreateLeadInput> = {}): CreateLeadInput {
    const id = randomUUID().slice(0, 8);
    return {
      companyName: `Société ${id}`,
      sector: "Santé",
      contactLastName: "Kouassi",
      contactFirstName: "Yao",
      phone: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      email: `yao-${id}@client.ci`,
      jobTitle: "Directeur général",
      insertedOn: todayUtc(),
      progress: 10,
      wonConfirmed: false,
      forceDuplicate: false,
      ...over,
    };
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    svc = await import("@/features/leads/service");
    kpi = await import("@/features/leads/kpi");

    const suffix = randomUUID().slice(0, 8);
    a = await makeUser("commercial", "Commercial A", suffix);
    b = await makeUser("commercial", "Commercial B", suffix);
    direction = await makeUser("direction", "Direction", suffix);
    audit = await makeUser("audit", "Audit", suffix);
    productId = (
      await db.product.upsert({ where: { code: "test-produit" }, update: {}, create: { code: "test-produit", label: "Produit test" } })
    ).id;
  });

  beforeEach(async () => {
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("création", () => {
    it("rattache le prospect à son créateur et écrit l'historique et l'audit", async () => {
      const result = await svc.createLead(a, leadInput());
      expect(result.destinations).toEqual(["prospects"]);

      const lead = await db.lead.findUniqueOrThrow({ where: { id: result.id }, include: { events: true } });
      expect(lead.ownerUserId).toBe(a.id);
      expect(lead.status).toBe("open");
      expect(lead.version).toBe(1);
      expect(lead.events).toHaveLength(1);
      expect(lead.events[0]).toMatchObject({ type: "created", fromProgress: null, toProgress: 10 });

      const trace = await db.auditLog.findFirst({ where: { entityId: result.id, action: "lead.created" } });
      expect(trace?.actorUserId).toBe(a.id);
    });

    it("détecte un doublon (REC-02) puis l'accepte si l'utilisateur le confirme", async () => {
      const first = leadInput();
      await svc.createLead(a, first);

      const duplicate = leadInput({ email: first.email });
      await expect(svc.createLead(b, duplicate)).rejects.toMatchObject({
        code: "CONFLICT",
        details: { duplicates: [expect.objectContaining({ matchedOn: ["e-mail"] })] },
      });
      await expect(svc.createLead(b, { ...duplicate, forceDuplicate: true })).resolves.toBeDefined();
    });

    it("exige produit et chiffre d'affaires au-delà du seuil de qualification", async () => {
      await expect(svc.createLead(a, leadInput({ progress: 60 }))).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { productId: expect.any(Array), expectedRevenue: expect.any(Array) } },
      });

      const ok = await svc.createLead(a, leadInput({ progress: 60, productId, expectedRevenue: 6245790 }));
      expect(ok.destinations).toEqual(["qualifies"]);
    });

    it("refuse un produit inexistant", async () => {
      await expect(
        svc.createLead(a, leadInput({ progress: 60, productId: randomUUID(), expectedRevenue: 1 })),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("date d'insertion saisie dans le CRM", () => {
    it("n'accepte que la date du jour : ni passée ni future", async () => {
      await expect(svc.createLead(a, leadInput({ insertedOn: todayUtc() }))).resolves.toMatchObject({ status: "open" });

      for (const offset of [-1, -30, 1, 30]) {
        await expect(svc.createLead(a, leadInput({ insertedOn: todayUtc(offset) })), `décalage ${offset} j`).rejects.toMatchObject({
          code: "VALIDATION",
          details: { fieldErrors: { insertedOn: [expect.stringContaining("celle du jour")] } },
        });
      }
      // Rien n'a été écrit pour les refus : un seul prospect existe.
      expect(await db.lead.count()).toBe(1);
    });

    it("compare à la date fournie par l'horloge de l'appelant (UTC), pas à celle de la machine", async () => {
      const clock = new Date("2026-03-05T23:30:00.000Z");
      await expect(svc.createLead(a, leadInput({ insertedOn: new Date("2026-03-05T00:00:00.000Z") }), clock)).resolves.toMatchObject({ status: "open" });
      await expect(svc.createLead(a, leadInput({ insertedOn: new Date("2026-03-06T00:00:00.000Z") }), clock)).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("refuse de modifier la date d'insertion d'un prospect, mais laisse modifier le reste", async () => {
      const base = leadInput();
      const { id } = await svc.createLead(a, base);

      await expect(svc.updateLead(a, { ...base, id, version: 1, insertedOn: todayUtc(-3) })).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { insertedOn: ["La date d'insertion ne peut pas être modifiée."] } },
      });
      await expect(svc.updateLead(a, { ...base, id, version: 1, jobTitle: "Directrice" })).resolves.toMatchObject({ status: "open" });
    });

    it("laisse modifier un prospect ancien (importé, date historique) tant que sa date ne change pas", async () => {
      const oldDate = new Date(Date.UTC(2026, 8, 1));
      const base = leadInput({ insertedOn: oldDate });
      const old = await db.lead.create({
        data: {
          companyName: base.companyName,
          sector: base.sector,
          contactLastName: base.contactLastName,
          contactFirstName: base.contactFirstName,
          phone: base.phone,
          email: base.email,
          jobTitle: base.jobTitle,
          insertedOn: oldDate,
          progress: 10,
          status: "open",
          ownerUserId: a.id,
        },
      });

      await expect(svc.updateLead(a, { ...base, id: old.id, version: 1, jobTitle: "Directeur adjoint" })).resolves.toMatchObject({ status: "open" });
      await expect(svc.updateLead(a, { ...base, id: old.id, version: 2, insertedOn: todayUtc() })).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("modification", () => {
    it("fait avancer le prospect, incrémente la version et historise le changement d'étape (REC-04)", async () => {
      const base = leadInput();
      const { id } = await svc.createLead(a, base);

      const result = await svc.updateLead(a, { ...base, id, version: 1, progress: 80, productId, expectedRevenue: 1_000_000 });
      expect(result.destinations).toEqual(["propositions", "pipeline"]);

      const lead = await db.lead.findUniqueOrThrow({ where: { id }, include: { events: { orderBy: { occurredAt: "asc" } } } });
      expect(lead.version).toBe(2);
      expect(lead.events.at(-1)).toMatchObject({ type: "progress_changed", fromProgress: 10, toProgress: 80 });
      expect(Number(lead.events.at(-1)?.expectedRevenue)).toBe(1_000_000);
    });

    it("refuse une modification faite sur une version périmée (verrou optimiste)", async () => {
      const base = leadInput();
      const { id } = await svc.createLead(a, base);
      await svc.updateLead(a, { ...base, id, version: 1, jobTitle: "Directeur" });

      await expect(svc.updateLead(a, { ...base, id, version: 1, jobTitle: "Autre" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("n'écrit dans l'audit que des noms de champs, jamais leurs valeurs", async () => {
      const base = leadInput();
      const { id } = await svc.createLead(a, base);
      await svc.updateLead(a, { ...base, id, version: 1, email: "nouveau@client.ci" });

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "lead.updated" } });
      expect(trace.metadata).toMatchObject({ changedFields: ["email"] });
      expect(JSON.stringify(trace.metadata)).not.toContain("nouveau@client.ci");
    });
  });

  describe("clôture", () => {
    it("exige la confirmation du contrat signé et du premier paiement, puis verrouille la fiche", async () => {
      const base = leadInput({ progress: 90, productId, expectedRevenue: 500_000 });
      const { id } = await svc.createLead(a, base);
      const toWon = { ...base, id, version: 1, progress: 100 as const };

      await expect(svc.updateLead(a, toWon)).rejects.toMatchObject({
        details: { fieldErrors: { wonConfirmed: expect.any(Array) } },
      });

      const result = await svc.updateLead(a, { ...toWon, wonConfirmed: true });
      expect(result).toMatchObject({ status: "won", destinations: ["gagnes"] });
      const lead = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(lead.closedAt).not.toBeNull();

      await expect(svc.updateLead(a, { ...toWon, wonConfirmed: true, version: 2, jobTitle: "x" })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    });

    it("marque un prospect perdu avec son motif et le retire des écrans (REC-05)", async () => {
      const { id } = await svc.createLead(a, leadInput());
      const result = await svc.markLost(a, { id, version: 1, reason: "price" });
      expect(result).toMatchObject({ status: "lost", destinations: [] });

      const lead = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(lead).toMatchObject({ status: "lost", lossReason: "price" });
      expect((await svc.listLeads(a, { view: "prospects" })).total).toBe(0);
      expect((await svc.listLeads(a, { lost: true })).total).toBe(1);
    });

    it("interdit à la base elle-même un prospect perdu sans motif ou gagné hors de 100 %", async () => {
      const { id } = await svc.createLead(a, leadInput());
      await expect(db.lead.update({ where: { id }, data: { status: "lost" } })).rejects.toThrow();
      await expect(db.lead.update({ where: { id }, data: { status: "won" } })).rejects.toThrow();
      await expect(db.lead.update({ where: { id }, data: { progress: 30 } })).rejects.toThrow();
    });
  });

  describe("périmètre et permissions (REC-09)", () => {
    it("présente le prospect d'un autre commercial comme introuvable, en lecture comme en écriture", async () => {
      const base = leadInput();
      const { id } = await svc.createLead(a, base);

      await expect(svc.getLead(b, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(svc.updateLead(b, { ...base, id, version: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(svc.markLost(b, { id, version: 1, reason: "price" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("limite la liste de chaque commercial à son portefeuille, et laisse la direction tout voir", async () => {
      await svc.createLead(a, leadInput());
      await svc.createLead(b, leadInput());

      expect((await svc.listLeads(a)).total).toBe(1);
      expect((await svc.listLeads(b)).total).toBe(1);
      expect((await svc.listLeads(direction)).total).toBe(2);
    });

    it("laisse un manager voir les prospects de son équipe, et seulement ceux-là", async () => {
      const team = await db.team.create({ data: { name: `Équipe périmètre ${randomUUID().slice(0, 8)}` } });
      const manager = await makeUser("manager", "Manager Équipe", randomUUID().slice(0, 8));
      await db.user.update({ where: { id: manager.id }, data: { teamId: team.id } });
      await db.user.update({ where: { id: a.id }, data: { teamId: team.id } });

      try {
        const teamLead = await svc.createLead(a, leadInput());
        await svc.createLead(b, leadInput()); // b n'est pas dans l'équipe
        const own = await svc.createLead({ ...manager, teamId: team.id }, leadInput());

        const visible = await svc.listLeads({ ...manager, teamId: team.id });
        expect(visible.rows.map((r) => r.id).sort()).toEqual([teamLead.id, own.id].sort());
        await expect(svc.getLead({ ...manager, teamId: team.id }, teamLead.id)).resolves.toMatchObject({ id: teamLead.id });
      } finally {
        await db.user.update({ where: { id: a.id }, data: { teamId: null } });
      }
    });

    it("autorise l'audit à lire mais pas à écrire", async () => {
      const base = leadInput();
      const { id } = await svc.createLead(a, base);

      await expect(svc.getLead(audit, id)).resolves.toMatchObject({ id });
      await expect(svc.createLead(audit, leadInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(svc.updateLead(audit, { ...base, id, version: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("écrans de reporting", () => {
    it("répartit chaque prospect dans l'écran qui correspond à son étape", async () => {
      await svc.createLead(a, leadInput({ progress: 10 }));
      await svc.createLead(a, leadInput({ progress: 60, productId, expectedRevenue: 1 }));
      await svc.createLead(a, leadInput({ progress: 80, productId, expectedRevenue: 1 }));
      await svc.createLead(a, leadInput({ progress: 100, productId, expectedRevenue: 1, wonConfirmed: true }));

      const total = async (view: LeadView) => (await svc.listLeads(a, { view })).total;
      expect(await total("prospects")).toBe(1);
      expect(await total("qualifies")).toBe(1);
      expect(await total("propositions")).toBe(1);
      expect(await total("pipeline")).toBe(1);
      expect(await total("gagnes")).toBe(1);
    });

    it("recherche par entreprise ou contact et pagine", async () => {
      await svc.createLead(a, leadInput({ companyName: "Alpha Santé" }));
      await svc.createLead(a, leadInput({ companyName: "Beta Transport" }));

      expect((await svc.listLeads(a, { q: "alpha" })).rows.map((r) => r.companyName)).toEqual(["Alpha Santé"]);
      const page = await svc.listLeads(a, { pageSize: 1, page: 2 });
      expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(page.rows).toHaveLength(1);
    });
  });

  describe("KPI du tableau de bord", () => {
    // Semaine courante : lundi 12 → dimanche 18 octobre 2026. Semaine précédente : 5 → 11 octobre.
    const now = new Date("2026-10-14T10:00:00Z");

    async function insert(data: {
      company: string;
      insertedOn: string;
      progress: number;
      status: string;
      revenue?: number;
      lossReason?: string;
      events: { at: string; type: string; from: number | null; to: number; status: string; revenue?: number }[];
    }) {
      await db.lead.create({
        data: {
          companyName: data.company,
          sector: "Santé",
          contactLastName: "Test",
          contactFirstName: "Kpi",
          phone: "0700000000",
          email: `${randomUUID()}@kpi.ci`,
          jobTitle: "DG",
          insertedOn: new Date(`${data.insertedOn}T00:00:00Z`),
          progress: data.progress,
          status: data.status,
          expectedRevenue: data.revenue ?? null,
          lossReason: data.lossReason ?? null,
          ownerUserId: a.id,
          events: {
            create: data.events.map((e) => ({
              occurredAt: new Date(e.at),
              type: e.type,
              fromProgress: e.from,
              toProgress: e.to,
              status: e.status,
              expectedRevenue: e.revenue ?? null,
            })),
          },
        },
      });
    }

    beforeEach(async () => {
      // A : ouvert à 80 % depuis la semaine précédente (pipeline 1 000 000 FCFA).
      await insert({
        company: "A", insertedOn: "2026-10-01", progress: 80, status: "open", revenue: 1_000_000,
        events: [
          { at: "2026-10-01T09:00:00Z", type: "created", from: null, to: 10, status: "open" },
          { at: "2026-10-08T09:00:00Z", type: "progress_changed", from: 10, to: 80, status: "open", revenue: 1_000_000 },
        ],
      });
      // B : nouveau prospect de la semaine courante.
      await insert({
        company: "B", insertedOn: "2026-10-13", progress: 10, status: "open",
        events: [{ at: "2026-10-13T09:00:00Z", type: "created", from: null, to: 10, status: "open" }],
      });
      // C : gagné cette semaine.
      await insert({
        company: "C", insertedOn: "2026-09-20", progress: 100, status: "won", revenue: 500_000,
        events: [
          { at: "2026-09-20T09:00:00Z", type: "created", from: null, to: 10, status: "open" },
          { at: "2026-10-13T08:00:00Z", type: "won", from: 80, to: 100, status: "won", revenue: 500_000 },
        ],
      });
      // D : perdu cette semaine.
      await insert({
        company: "D", insertedOn: "2026-09-25", progress: 40, status: "lost", lossReason: "price",
        events: [
          { at: "2026-09-25T09:00:00Z", type: "created", from: null, to: 10, status: "open" },
          { at: "2026-10-12T08:00:00Z", type: "lost", from: 40, to: 40, status: "lost" },
        ],
      });
    });

    it("compte les nouveaux prospects et signale « non calculable » quand la semaine précédente est vide", async () => {
      const kpis = await kpi.getDashboardKpis(direction, now);
      expect(kpis.weekLabel).toBe("S42");
      expect(kpis.newProspects).toMatchObject({ current: 1, previous: 0, pct: null });
    });

    it("compte les propositions envoyées de chaque semaine", async () => {
      const kpis = await kpi.getDashboardKpis(direction, now);
      // A a dépassé 60 % le 8 octobre (semaine précédente) ; C était déjà au-dessus de 60 % avant de gagner.
      expect(kpis.proposals).toMatchObject({ current: 0, previous: 1 });
      expect(kpis.proposals.pct).toBe(-100);
    });

    it("calcule le taux de transformation (gagnées / clôturées) de la semaine", async () => {
      const { conversion } = await kpi.getDashboardKpis(direction, now);
      expect(conversion).toMatchObject({ won: 1, lost: 1, rate: 50, previousRate: null, pointsDiff: null });
    });

    it("reconstitue la valeur du pipeline à la fin de la semaine précédente et à l'instant présent", async () => {
      const { pipeline, pipelineHistory } = await kpi.getDashboardKpis(direction, now);
      expect(pipeline.current).toEqual({ gross: 1_000_000, weighted: 800_000 });
      expect(pipeline.previous).toEqual({ gross: 1_000_000, weighted: 800_000 });
      expect(pipeline.comparison.pct).toBe(0);

      expect(pipelineHistory.map((p) => p.label)).toEqual(["S39", "S40", "S41", "S42"]);
      expect(pipelineHistory.map((p) => p.gross)).toEqual([0, 0, 1_000_000, 1_000_000]);
    });

    it("limite les KPI au périmètre de l'utilisateur", async () => {
      const kpis = await kpi.getDashboardKpis(b, now);
      expect(kpis.newProspects.current).toBe(0);
      expect(kpis.pipeline.current.gross).toBe(0);
      expect(kpis.conversion.rate).toBeNull();
    });
  });
});
