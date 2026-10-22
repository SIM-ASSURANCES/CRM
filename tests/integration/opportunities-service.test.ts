import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateAccountInput } from "@/features/accounts/schemas";
import type { CreateContactInput } from "@/features/contacts/schemas";
import type { CreateLeadInput } from "@/features/leads/schemas";
import type { CreateOpportunityInput } from "@/features/opportunities/schemas";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests des opportunités et de la conversion de prospects sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("opportunités et conversion (PostgreSQL)", () => {
  let db: Db;
  let opp: typeof import("@/features/opportunities/service");
  let conv: typeof import("@/features/opportunities/conversion");
  let leadsSvc: typeof import("@/features/leads/service");
  let acc: typeof import("@/features/accounts/service");
  let con: typeof import("@/features/contacts/service");
  let productId: string;
  let a: CurrentUser; // commercial A (équipe)
  let b: CurrentUser; // commercial B (hors équipe)
  let manager: CurrentUser;
  let direction: CurrentUser;
  let audit: CurrentUser;
  let accountId: string;

  const uniq = () => randomUUID().slice(0, 8);
  const closeDate = new Date(Date.UTC(2026, 11, 15));
  const actionDate = new Date(Date.UTC(2026, 9, 20));

  async function makeUser(role: Role, label: string, team: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, teamId: team, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: team, mustChangePassword: false };
  }

  function accountInput(over: Partial<CreateAccountInput> = {}): CreateAccountInput {
    return { legalName: `Entreprise ${uniq()}`, sector: "Santé", status: "client", country: "CI", forceDuplicate: false, ...over };
  }

  function oppInput(over: Partial<CreateOpportunityInput> = {}): CreateOpportunityInput {
    return {
      accountId,
      amount: 5_000_000,
      revenuePeriod: "annual",
      stage: 20,
      expectedCloseDate: closeDate,
      nextAction: "Appeler le client",
      nextActionDate: actionDate,
      ...over,
    };
  }

  function leadInput(over: Partial<CreateLeadInput> = {}): CreateLeadInput {
    const id = uniq();
    return {
      companyName: `Prospect ${id}`,
      sector: "Santé",
      contactLastName: "Kouassi",
      contactFirstName: "Yao",
      phone: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      email: `yao-${id}@prospect.ci`,
      jobTitle: "Directeur général",
      // Un prospect saisi dans le CRM porte la date du jour (UTC).
      insertedOn: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
      progress: 40,
      wonConfirmed: false,
      forceDuplicate: false,
      ...over,
    };
  }

  const convertInput = (leadId: string, over: Record<string, unknown> = {}) => ({
    leadId,
    forceDuplicate: false,
    expectedCloseDate: closeDate,
    nextAction: "Envoyer la proposition",
    nextActionDate: actionDate,
    ...over,
  });

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    opp = await import("@/features/opportunities/service");
    conv = await import("@/features/opportunities/conversion");
    leadsSvc = await import("@/features/leads/service");
    acc = await import("@/features/accounts/service");
    con = await import("@/features/contacts/service");

    const team = await db.team.create({ data: { name: `Équipe opportunités ${uniq()}` } });
    a = await makeUser("commercial", "Commercial Alpha", team.id);
    b = await makeUser("commercial", "Commercial Beta");
    manager = await makeUser("manager", "Manager Équipe", team.id);
    direction = await makeUser("direction", "Direction Opportunités");
    audit = await makeUser("audit", "Audit Opportunités");
    productId = (
      await db.product.upsert({ where: { code: "test-produit" }, update: {}, create: { code: "test-produit", label: "Produit test" } })
    ).id;
  });

  beforeEach(async () => {
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
    await db.activity.deleteMany();
    await db.task.deleteMany();
    await db.opportunityContact.deleteMany();
    await db.opportunityEvent.deleteMany();
    await db.opportunity.deleteMany();
    await db.contactRole.deleteMany();
    await db.accountContact.deleteMany();
    await db.contact.deleteMany();
    await db.crmAccount.updateMany({ data: { parentAccountId: null, mergedIntoId: null } });
    await db.crmAccount.deleteMany();
    accountId = (await acc.createAccount(a, accountInput({ legalName: "Compte des opportunités" }))).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("création (CDC 5.1)", () => {
    it("nomme l'opportunité automatiquement, la rattache à son créateur et écrit l'historique et l'audit", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ productId, stage: 20 }));

      const detail = await opp.getOpportunity(a, id);
      expect(detail).toMatchObject({
        name: "Compte des opportunités – Produit test – 12/2026",
        ownerName: "Commercial Alpha",
        stage: 20,
        status: "open",
        amount: 5_000_000,
        weighted: 1_000_000,
        accountName: "Compte des opportunités",
      });
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]).toMatchObject({ type: "created", toStage: 20 });
      expect((await db.auditLog.findFirst({ where: { entityId: id, action: "opportunity.created" } }))?.actorUserId).toBe(a.id);
    });

    it("exige produit et montant au-delà du seuil de qualification", async () => {
      await expect(opp.createOpportunity(a, oppInput({ stage: 60 }))).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { productId: expect.any(Array) } },
      });
      await expect(opp.createOpportunity(a, oppInput({ stage: 60, productId, amount: 0 }))).rejects.toMatchObject({
        details: { fieldErrors: { amount: expect.any(Array) } },
      });
      await expect(opp.createOpportunity(a, oppInput({ stage: 60, productId }))).resolves.toBeDefined();
    });

    it("refuse un compte hors périmètre et un utilisateur en lecture seule", async () => {
      const others = await acc.createAccount(b, accountInput());
      await expect(opp.createOpportunity(a, oppInput({ accountId: others.id }))).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { accountId: expect.any(Array) } },
      });
      await expect(opp.createOpportunity(audit, oppInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("réserve le choix du propriétaire à ceux qui peuvent réaffecter", async () => {
      const byCommercial = await opp.createOpportunity(a, oppInput({ ownerUserId: b.id }));
      expect((await opp.getOpportunity(direction, byCommercial.id)).ownerUserId).toBe(a.id);

      const byDirection = await opp.createOpportunity(direction, oppInput({ ownerUserId: b.id }));
      expect((await opp.getOpportunity(direction, byDirection.id)).ownerUserId).toBe(b.id);
    });
  });

  describe("changement d'étape (CDC A.8)", () => {
    it("exige la confirmation du critère pour avancer, historise et incrémente la version", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 20 }));
      const base = { id, version: 1, targetStage: 40 as const, criteriaConfirmed: false, wonConfirmed: false };

      await expect(opp.moveStage(a, base)).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { criteriaConfirmed: expect.any(Array) } },
      });

      await expect(opp.moveStage(a, { ...base, criteriaConfirmed: true })).resolves.toMatchObject({ stage: 40, status: "open" });
      const detail = await opp.getOpportunity(a, id);
      expect(detail.version).toBe(2);
      expect(detail.events[0]).toMatchObject({ type: "stage_changed", fromStage: 20, toStage: 40 });
      expect((await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "opportunity.stage_changed" } })).metadata).toMatchObject({
        fromStage: 20,
        toStage: 40,
      });
    });

    it("bloque l'avancée au-delà du seuil tant que produit et montant manquent", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 40, amount: 0 }));
      await expect(
        opp.moveStage(a, { id, version: 1, targetStage: 60 as const, criteriaConfirmed: true, wonConfirmed: false }),
      ).rejects.toMatchObject({ details: { fieldErrors: { productId: expect.any(Array), amount: expect.any(Array) } } });
    });

    it("permet de reculer sans confirmation", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 60, productId }));
      await expect(
        opp.moveStage(a, { id, version: 1, targetStage: 20 as const, criteriaConfirmed: false, wonConfirmed: false }),
      ).resolves.toMatchObject({ stage: 20 });
    });

    it("gagne à 100 % avec la confirmation du contrat signé et du premier paiement, puis verrouille la fiche", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 90, productId }));
      const toWon = { id, version: 1, targetStage: 100 as const, criteriaConfirmed: false, wonConfirmed: false };

      await expect(opp.moveStage(a, toWon)).rejects.toMatchObject({ details: { fieldErrors: { wonConfirmed: expect.any(Array) } } });

      await expect(opp.moveStage(a, { ...toWon, wonConfirmed: true })).resolves.toMatchObject({ stage: 100, status: "won" });
      const row = await db.opportunity.findUniqueOrThrow({ where: { id } });
      expect(row.closedAt).not.toBeNull();
      expect((await opp.getOpportunity(a, id)).events[0].type).toBe("won");

      await expect(opp.moveStage(a, { ...toWon, version: 2, targetStage: 60 as const, wonConfirmed: true })).rejects.toMatchObject({ code: "VALIDATION" });
      const detail = await opp.getOpportunity(a, id);
      await expect(
        opp.updateOpportunity(a, { ...oppInput({ productId }), id, version: detail.version }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("refuse un changement sur une version périmée", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 20 }));
      const move = { id, targetStage: 40 as const, criteriaConfirmed: true, wonConfirmed: false };
      await opp.moveStage(a, { ...move, version: 1 });
      // Recul (aucune règle de qualification) : seule la version périmée peut refuser.
      await expect(opp.moveStage(a, { ...move, version: 1, targetStage: 20 as const })).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("modification", () => {
    it("met à jour la fiche, historise le montant et la date de clôture, et audite des noms de champs", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ productId }));
      await opp.updateOpportunity(a, { ...oppInput({ productId, amount: 8_000_000 }), id, version: 1 });

      const detail = await opp.getOpportunity(a, id);
      expect(detail).toMatchObject({ amount: 8_000_000, version: 2 });
      expect(detail.events[0]).toMatchObject({ type: "updated", amount: 8_000_000 });

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "opportunity.updated" } });
      expect(trace.metadata).toMatchObject({ changedFields: ["amount"] });
      expect(JSON.stringify(trace.metadata)).not.toContain("8000000");
    });

    it("refuse une version périmée et protège les champs exigés par l'étape en cours", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 60, productId }));
      await opp.updateOpportunity(a, { ...oppInput({ productId }), id, version: 1 });
      await expect(opp.updateOpportunity(a, { ...oppInput({ productId }), id, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
      // À 60 %, le produit ne peut pas être retiré.
      await expect(opp.updateOpportunity(a, { ...oppInput(), id, version: 2 })).rejects.toMatchObject({
        details: { fieldErrors: { productId: expect.any(Array) } },
      });
    });

    it("trace le changement de propriétaire, réservé au manager et à la direction", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      await opp.updateOpportunity(a, { ...oppInput({ ownerUserId: b.id }), id, version: 1 });
      expect((await opp.getOpportunity(direction, id)).ownerUserId).toBe(a.id);

      await opp.updateOpportunity(manager, { ...oppInput({ ownerUserId: manager.id }), id, version: 2 });
      expect((await opp.getOpportunity(direction, id)).ownerUserId).toBe(manager.id);
      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "opportunity.owner_changed" } });
      expect(trace.metadata).toMatchObject({ fromOwnerId: a.id, toOwnerId: manager.id });
    });
  });

  describe("perte (CDC 5.4) et contraintes de la base", () => {
    it("clôture en perte avec un motif et retire l'opportunité du Kanban", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      await opp.markLost(a, { id, version: 1, reason: "competition", comment: "Offre moins chère" });

      const detail = await opp.getOpportunity(a, id);
      expect(detail).toMatchObject({ status: "lost", lossReason: "competition", lossComment: "Offre moins chère" });
      expect((await opp.listBoard(a)).open.count).toBe(0);
      expect((await opp.listBoard(a)).lostThisYear).toBe(1);
      await expect(opp.markLost(a, { id, version: 2, reason: "price" })).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("interdit à la base elle-même les états incohérents", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      await expect(db.opportunity.update({ where: { id }, data: { status: "lost", closedAt: new Date() } })).rejects.toThrow();
      await expect(db.opportunity.update({ where: { id }, data: { status: "won", closedAt: new Date() } })).rejects.toThrow();
      await expect(db.opportunity.update({ where: { id }, data: { stage: 35 } })).rejects.toThrow();
      await expect(db.opportunity.update({ where: { id }, data: { nextAction: null } })).rejects.toThrow();
      await expect(db.opportunity.update({ where: { id }, data: { amount: -1 } })).rejects.toThrow();
    });
  });

  describe("périmètre et permissions (REC-09)", () => {
    it("présente l'opportunité d'un autre commercial comme introuvable, en lecture comme en écriture", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      await expect(opp.getOpportunity(b, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        opp.moveStage(b, { id, version: 1, targetStage: 40 as const, criteriaConfirmed: true, wonConfirmed: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(opp.markLost(b, { id, version: 1, reason: "price" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("laisse un manager voir l'équipe, la direction tout, et l'audit lire sans écrire", async () => {
      const mine = await opp.createOpportunity(a, oppInput());
      // Opportunité de la direction, hors de l'équipe du manager.
      const directionAccount = (await acc.createAccount(direction, accountInput())).id;
      await opp.createOpportunity(direction, oppInput({ accountId: directionAccount }));

      expect((await opp.listBoard(manager)).open.count).toBe(1);
      expect((await opp.listBoard(direction)).open.count).toBe(2);
      await expect(opp.getOpportunity(audit, mine.id)).resolves.toMatchObject({ id: mine.id });
      await expect(
        opp.moveStage(audit, { id: mine.id, version: 1, targetStage: 40 as const, criteriaConfirmed: true, wonConfirmed: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("contacts impliqués", () => {
    async function contactOf(user: CurrentUser, forAccount = accountId) {
      const input: CreateContactInput = { firstName: "Awa", lastName: `Nom${uniq()}`, status: "active", forceDuplicate: false, accountId: forAccount };
      return (await con.createContact(user, input)).id;
    }

    it("n'accepte que les contacts du compte, sans doublon, avec un seul contact principal", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      const first = await contactOf(a);
      const second = await contactOf(a);
      const stranger = await con.createContact(a, { firstName: "Hors", lastName: `Compte${uniq()}`, status: "active", forceDuplicate: false });

      await opp.addContact(a, { opportunityId: id, contactId: first, roleType: "decision_maker", isMain: true });
      await opp.addContact(a, { opportunityId: id, contactId: second, isMain: true });
      await expect(opp.addContact(a, { opportunityId: id, contactId: first, isMain: false })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(opp.addContact(a, { opportunityId: id, contactId: stranger.id, isMain: false })).rejects.toMatchObject({
        details: { fieldErrors: { contactId: expect.any(Array) } },
      });

      const contacts = (await opp.getOpportunity(a, id)).contacts;
      expect(contacts).toHaveLength(2);
      expect(contacts.filter((c) => c.isMain).map((c) => c.contactId)).toEqual([second]);
    });

    it("propose les contacts du compte non encore impliqués, et permet de les retirer", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      const first = await contactOf(a);
      await contactOf(a);

      expect(await opp.listContactCandidates(a, id)).toHaveLength(2);
      await opp.addContact(a, { opportunityId: id, contactId: first, isMain: false });
      expect(await opp.listContactCandidates(a, id)).toHaveLength(1);

      await opp.removeContact(a, { opportunityId: id, contactId: first });
      expect((await opp.getOpportunity(a, id)).contacts).toHaveLength(0);
      await expect(opp.removeContact(a, { opportunityId: id, contactId: first })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("tableau Kanban et totaux (CDC 5.3)", () => {
    it("répartit les opportunités par colonne et calcule brut, pondéré et revenu signé", async () => {
      await opp.createOpportunity(a, oppInput({ stage: 20, amount: 1_000_000 }));
      await opp.createOpportunity(a, oppInput({ stage: 60, productId, amount: 10_000_000 }));
      await opp.createOpportunity(a, oppInput({ stage: 60, productId, amount: 2_000_000 }));
      const won = await opp.createOpportunity(a, oppInput({ stage: 90, productId, amount: 3_000_000 }));
      await opp.moveStage(a, { id: won.id, version: 1, targetStage: 100 as const, criteriaConfirmed: false, wonConfirmed: true });
      const lost = await opp.createOpportunity(a, oppInput({ stage: 10, amount: 500_000 }));
      await opp.markLost(a, { id: lost.id, version: 1, reason: "no_budget" });

      const board = await opp.listBoard(a);
      expect(board.columns.map((c) => [c.stage, c.cards.length])).toEqual([[10, 0], [20, 1], [40, 0], [60, 2], [80, 0], [90, 0]]);
      expect(board.columns.find((c) => c.stage === 60)!.totals).toEqual({ count: 2, gross: 12_000_000, weighted: 7_200_000 });
      expect(board.open).toEqual({ count: 3, gross: 13_000_000, weighted: 7_400_000 });
      expect(board.signedThisYear).toEqual({ count: 1, amount: 3_000_000 });
      expect(board.lostThisYear).toBe(1);
    });

    it("filtre par texte et par produit, et limite le tableau au périmètre", async () => {
      await opp.createOpportunity(a, oppInput({ stage: 60, productId, name: "Flotte Alpha" }));
      await opp.createOpportunity(a, oppInput({ name: "Santé Beta" }));

      expect((await opp.listBoard(a, { q: "flotte" })).open.count).toBe(1);
      expect((await opp.listBoard(a, { productId })).open.count).toBe(1);
      expect((await opp.listBoard(b)).open.count).toBe(0);
    });

    it("signale les prochaines actions en retard", async () => {
      await opp.createOpportunity(a, oppInput({ nextActionDate: new Date(Date.UTC(2026, 0, 5)) }));
      const board = await opp.listBoard(a, {}, new Date("2026-10-14T10:00:00Z"));
      expect(board.columns.find((c) => c.stage === 20)!.cards[0].overdue).toBe(true);
    });

    it("calcule l'ancienneté dans l'étape depuis le dernier changement d'étape", async () => {
      const { id } = await opp.createOpportunity(a, oppInput({ stage: 20 }));
      const moved = await opp.moveStage(a, { id, version: 1, targetStage: 40 as const, criteriaConfirmed: true, wonConfirmed: false });
      expect(moved).toMatchObject({ stage: 40, version: 2 });

      const inTenDays = new Date(Date.now() + 10 * 86_400_000 + 3_600_000);
      const card = (await opp.listBoard(a, {}, inTenDays)).columns.find((c) => c.stage === 40)!.cards[0];
      expect(card.daysInStage).toBe(10);
      expect((await opp.listBoard(a)).columns.find((c) => c.stage === 40)!.cards[0].daysInStage).toBe(0);
    });

    it("affiche le contact principal du dossier avec ses coordonnées, le principal avant les autres", async () => {
      const { id } = await opp.createOpportunity(a, oppInput());
      const base = { status: "active" as const, forceDuplicate: false, accountId };
      const other = await con.createContact(a, { ...base, firstName: "Autre", lastName: `Contact${uniq()}` });
      const main = await con.createContact(a, {
        ...base,
        firstName: "Awa",
        lastName: `Principal${uniq()}`,
        email: "awa.principal@exemple.ci",
        phone: "+2250707353673",
      });
      await opp.addContact(a, { opportunityId: id, contactId: other.id, isMain: false });
      await opp.addContact(a, { opportunityId: id, contactId: main.id, isMain: true });

      const card = (await opp.listBoard(a)).columns.find((c) => c.stage === 20)!.cards[0];
      expect(card.contact).toEqual({ name: expect.stringMatching(/^Awa Principal/), phone: "+2250707353673", email: "awa.principal@exemple.ci" });
    });

    it("renvoie un contact nul quand aucun contact n'est rattaché", async () => {
      await opp.createOpportunity(a, oppInput());
      expect((await opp.listBoard(a)).columns.find((c) => c.stage === 20)!.cards[0].contact).toBeNull();
    });

    it("liste les opportunités clôturées avec la pagination", async () => {
      const x = await opp.createOpportunity(a, oppInput());
      await opp.createOpportunity(a, oppInput());
      await opp.markLost(a, { id: x.id, version: 1, reason: "timing" });

      expect((await opp.listOpportunities(a, { status: "lost" })).total).toBe(1);
      expect((await opp.listOpportunities(a, { status: "open" })).total).toBe(1);
      expect(await opp.listOpportunities(a, { pageSize: 1, page: 2 })).toMatchObject({ total: 2, page: 2 });
    });
  });

  describe("conversion d'un prospect (CDC A.8)", () => {
    it("crée compte, contact et opportunité en conservant le prospect et son historique", async () => {
      const lead = await leadsSvc.createLead(a, leadInput({ companyName: "Prospect Converti SA", progress: 60, productId, expectedRevenue: 6_245_790 }));
      const result = await conv.convertLead(a, convertInput(lead.id));

      expect(result.createdAccount).toBe(true);
      const detail = await opp.getOpportunity(a, result.opportunityId);
      expect(detail).toMatchObject({ stage: 60, amount: 6_245_790, accountName: "Prospect Converti SA", ownerName: "Commercial Alpha" });
      expect(detail.name).toContain("Prospect Converti SA – Produit test");
      expect(detail.contacts).toEqual([expect.objectContaining({ name: "Yao Kouassi", isMain: true })]);

      const account = await acc.getAccount(a, result.accountId);
      expect(account).toMatchObject({ legalName: "Prospect Converti SA", sector: "Santé", status: "prospect" });
      expect(account.contacts[0]).toMatchObject({ contactId: result.contactId, isPrimary: true });

      const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { events: true } });
      expect(stored).toMatchObject({ convertedAccountId: result.accountId, convertedOpportunityId: result.opportunityId, status: "open", progress: 60 });
      expect(stored.convertedAt).not.toBeNull();
      expect(stored.events.length).toBeGreaterThan(0);
      expect(await db.auditLog.count({ where: { entityId: lead.id, action: "lead.converted" } })).toBe(1);
    });

    it("refuse une seconde conversion du même prospect", async () => {
      const lead = await leadsSvc.createLead(a, leadInput());
      const first = await conv.convertLead(a, convertInput(lead.id));
      await expect(conv.convertLead(a, convertInput(lead.id))).rejects.toMatchObject({
        code: "CONFLICT",
        details: { opportunityId: first.opportunityId },
      });
      expect(await db.opportunity.count()).toBe(1);
    });

    it("signale un compte similaire, puis rattache à un compte existant ou crée malgré tout", async () => {
      await acc.createAccount(a, accountInput({ legalName: "Entreprise Existante", status: "client" }));
      const existing = (await db.crmAccount.findFirstOrThrow({ where: { legalName: "Entreprise Existante" } })).id;

      const lead1 = await leadsSvc.createLead(a, leadInput({ companyName: "ENTREPRISE EXISTANTE" }));
      await expect(conv.convertLead(a, convertInput(lead1.id))).rejects.toMatchObject({
        code: "CONFLICT",
        details: { duplicates: [expect.objectContaining({ matchedOn: ["raison sociale"] })] },
      });
      const accountsBefore = await db.crmAccount.count();

      const attached = await conv.convertLead(a, convertInput(lead1.id, { existingAccountId: existing }));
      expect(attached).toMatchObject({ accountId: existing, createdAccount: false });
      expect(await db.crmAccount.count()).toBe(accountsBefore);

      // Même raison sociale que le premier prospect : on confirme ici que ce n'est pas un doublon de prospect.
      const lead2 = await leadsSvc.createLead(a, leadInput({ companyName: "Entreprise Existante", forceDuplicate: true }));
      const forced = await conv.convertLead(a, convertInput(lead2.id, { forceDuplicate: true }));
      expect(forced.createdAccount).toBe(true);
      expect(await db.crmAccount.count()).toBe(accountsBefore + 1);
    });

    it("réutilise un contact existant de même e-mail", async () => {
      const lead = await leadsSvc.createLead(a, leadInput());
      const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
      const existing = await con.createContact(a, {
        firstName: "Déjà",
        lastName: "Connu",
        email: stored.email,
        status: "active",
        forceDuplicate: false,
      });

      const result = await conv.convertLead(a, convertInput(lead.id));
      expect(result.contactId).toBe(existing.id);
      expect(await db.contact.count()).toBe(1);
    });

    it("est atomique : un compte existant invalide n'a aucun effet de bord", async () => {
      const lead = await leadsSvc.createLead(a, leadInput());
      const foreign = await acc.createAccount(b, accountInput());

      await expect(conv.convertLead(a, convertInput(lead.id, { existingAccountId: foreign.id }))).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await db.opportunity.count()).toBe(0);
      expect(await db.contact.count()).toBe(0);
      expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedAt).toBeNull();
    });

    it("respecte le périmètre et les permissions, et refuse un prospect clôturé", async () => {
      const lead = await leadsSvc.createLead(a, leadInput());
      await expect(conv.convertLead(b, convertInput(lead.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(conv.convertLead(audit, convertInput(lead.id))).rejects.toMatchObject({ code: "FORBIDDEN" });

      const won = await leadsSvc.createLead(a, leadInput({ progress: 100, productId, expectedRevenue: 1_000_000, wonConfirmed: true }));
      await expect(conv.convertLead(a, convertInput(won.id))).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});
