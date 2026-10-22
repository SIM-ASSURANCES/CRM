import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateAccountInput } from "@/features/accounts/schemas";
import type { CreateActivityInput } from "@/features/activities/schemas";
import type { CreateContactInput } from "@/features/contacts/schemas";
import type { CreateOpportunityInput } from "@/features/opportunities/schemas";
import type { CreateTaskInput } from "@/features/tasks/schemas";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests des activités, du fil unifié et des tâches sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("activités, fil et tâches (PostgreSQL)", () => {
  let db: Db;
  let act: typeof import("@/features/activities/service");
  let tsk: typeof import("@/features/tasks/service");
  let opp: typeof import("@/features/opportunities/service");
  let acc: typeof import("@/features/accounts/service");
  let con: typeof import("@/features/contacts/service");
  let a: CurrentUser; // commercial A (équipe)
  let b: CurrentUser; // commercial B (hors équipe)
  let manager: CurrentUser;
  let direction: CurrentUser;
  let audit: CurrentUser;
  let accountId: string;

  const uniq = () => randomUUID().slice(0, 8);
  // « Maintenant » figé : 13/10/2026 à 10h00 UTC.
  const now = new Date(Date.UTC(2026, 9, 13, 10, 0));
  const day = (d: number) => new Date(Date.UTC(2026, 9, d));

  async function makeUser(role: Role, label: string, team: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, teamId: team, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: team, mustChangePassword: false };
  }

  const accountInput = (over: Partial<CreateAccountInput> = {}): CreateAccountInput => ({
    legalName: `Entreprise ${uniq()}`,
    sector: "Santé",
    status: "client",
    country: "CI",
    forceDuplicate: false,
    ...over,
  });

  const activityInput = (over: Partial<CreateActivityInput> = {}): CreateActivityInput => ({
    type: "call_out",
    subject: "Appel de suivi",
    occurredAt: new Date(Date.UTC(2026, 9, 12, 9, 30)),
    accountId,
    ...over,
  });

  const taskInput = (over: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    title: "Relancer le client",
    dueDate: day(20),
    priority: "normal",
    ...over,
  });

  const oppInput = (over: Partial<CreateOpportunityInput> = {}): CreateOpportunityInput => ({
    accountId,
    amount: 5_000_000,
    revenuePeriod: "annual",
    stage: 20,
    expectedCloseDate: day(30),
    nextAction: "Appeler le client",
    nextActionDate: day(15),
    ...over,
  });

  const contactOf = async (user: CurrentUser, forAccount = accountId) => {
    const input: CreateContactInput = { firstName: "Awa", lastName: `Nom${uniq()}`, status: "active", forceDuplicate: false, accountId: forAccount };
    return (await con.createContact(user, input)).id;
  };

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    act = await import("@/features/activities/service");
    tsk = await import("@/features/tasks/service");
    opp = await import("@/features/opportunities/service");
    acc = await import("@/features/accounts/service");
    con = await import("@/features/contacts/service");

    const team = await db.team.create({ data: { name: `Équipe activités ${uniq()}` } });
    a = await makeUser("commercial", "Commercial Alpha", team.id);
    b = await makeUser("commercial", "Commercial Beta");
    manager = await makeUser("manager", "Manager Équipe", team.id);
    direction = await makeUser("direction", "Direction Activités");
    audit = await makeUser("audit", "Audit Activités");
  });

  beforeEach(async () => {
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
    accountId = (await acc.createAccount(a, accountInput({ legalName: "Compte des activités" }))).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("activités (CDC 6.1)", () => {
    it("journalise une activité avec son auteur, son origine « saisie utilisateur » et une trace d'audit", async () => {
      const contactId = await contactOf(a);
      const { id } = await act.createActivity(a, activityInput({ contactId, outcome: "Intéressé par l'offre" }));

      const detail = await act.getActivity(a, id);
      expect(detail).toMatchObject({ type: "call_out", authorName: "Commercial Alpha", origin: "user", contactId, outcome: "Intéressé par l'offre" });
      expect(await db.auditLog.count({ where: { action: "activity.created", entityId: id } })).toBe(1);
    });

    it("refuse un contact étranger au compte et une opportunité d'un autre compte", async () => {
      const stranger = await con.createContact(a, { firstName: "Hors", lastName: `Compte${uniq()}`, status: "active", forceDuplicate: false });
      await expect(act.createActivity(a, activityInput({ contactId: stranger.id }))).rejects.toMatchObject({
        details: { fieldErrors: { contactId: expect.any(Array) } },
      });

      const otherAccount = (await acc.createAccount(a, accountInput())).id;
      const { id: otherOpp } = await opp.createOpportunity(a, oppInput({ accountId: otherAccount }));
      await expect(act.createActivity(a, activityInput({ opportunityId: otherOpp }))).rejects.toMatchObject({
        details: { fieldErrors: { opportunityId: expect.any(Array) } },
      });
    });

    it("reporte la prochaine action sur l'opportunité ouverte et incrémente sa version", async () => {
      const { id: oppId } = await opp.createOpportunity(a, oppInput());
      const before = await db.opportunity.findUniqueOrThrow({ where: { id: oppId } });

      await act.createActivity(a, activityInput({ opportunityId: oppId, nextAction: "Envoyer le devis", nextActionDate: day(18) }));

      const after = await db.opportunity.findUniqueOrThrow({ where: { id: oppId } });
      expect(after.nextAction).toBe("Envoyer le devis");
      expect(after.nextActionDate?.toISOString()).toBe(day(18).toISOString());
      expect(after.version).toBe(before.version + 1);
    });

    it("ne touche pas à l'opportunité sans prochaine action, ni à une opportunité clôturée", async () => {
      const { id: oppId } = await opp.createOpportunity(a, oppInput());
      await act.createActivity(a, activityInput({ opportunityId: oppId }));
      expect((await db.opportunity.findUniqueOrThrow({ where: { id: oppId } })).nextAction).toBe("Appeler le client");

      await opp.markLost(a, { id: oppId, version: (await db.opportunity.findUniqueOrThrow({ where: { id: oppId } })).version, reason: "price" });
      const closed = await db.opportunity.findUniqueOrThrow({ where: { id: oppId } });
      await act.createActivity(a, activityInput({ opportunityId: oppId, nextAction: "Rien", nextActionDate: day(18) }));
      expect((await db.opportunity.findUniqueOrThrow({ where: { id: oppId } })).version).toBe(closed.version);
    });

    it("n'est visible que par ceux qui voient le compte", async () => {
      const { id } = await act.createActivity(a, activityInput());

      await expect(act.getActivity(manager, id)).resolves.toMatchObject({ id });
      await expect(act.getActivity(direction, id)).resolves.toMatchObject({ id });
      await expect(act.getActivity(audit, id)).resolves.toMatchObject({ id });
      await expect(act.getActivity(b, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(act.createActivity(b, activityInput())).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("laisse l'audit lire sans écrire", async () => {
      await expect(act.createActivity(audit, activityInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("n'autorise la correction que de l'auteur ou d'un profil qui peut réaffecter, avec verrou optimiste", async () => {
      const { id } = await act.createActivity(a, activityInput());
      const detail = await act.getActivity(a, id);
      const edit = { ...activityInput({ subject: "Appel corrigé" }), id, version: detail.version };

      await expect(act.updateActivity(a, edit)).resolves.toEqual({ id });
      expect((await act.getActivity(a, id)).subject).toBe("Appel corrigé");

      // Version périmée : conflit.
      await expect(act.updateActivity(a, edit)).rejects.toMatchObject({ code: "CONFLICT" });

      // Le manager de l'équipe peut corriger ; un autre commercial ne voit même pas l'activité.
      const fresh = await act.getActivity(a, id);
      await expect(act.updateActivity(manager, { ...edit, subject: "Vu par le manager", version: fresh.version })).resolves.toEqual({ id });
      await expect(act.updateActivity(b, { ...edit, version: fresh.version + 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("ne modifie pas une activité synchronisée ni son compte", async () => {
      const { id } = await act.createActivity(a, activityInput());
      const detail = await act.getActivity(a, id);

      const otherAccount = (await acc.createAccount(a, accountInput())).id;
      await expect(act.updateActivity(a, { ...activityInput({ accountId: otherAccount }), id, version: detail.version })).rejects.toMatchObject({
        details: { fieldErrors: { accountId: expect.any(Array) } },
      });

      await db.activity.update({ where: { id }, data: { origin: "sync" } });
      await expect(act.updateActivity(a, { ...activityInput(), id, version: detail.version })).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("refuse en base un type inconnu ou une date de prochaine action sans action", async () => {
      const base = { subject: "x", occurredAt: now, authorUserId: a.id, accountId };
      await expect(db.activity.create({ data: { ...base, type: "fax" } })).rejects.toThrow();
      await expect(db.activity.create({ data: { ...base, type: "note", nextActionDate: day(20) } })).rejects.toThrow();
    });
  });

  describe("tâches (CDC 6)", () => {
    it("crée une tâche pour son créateur par défaut, avec audit", async () => {
      const { id } = await tsk.createTask(a, taskInput(), now);
      const task = await tsk.getTask(a, id, now);

      expect(task).toMatchObject({ assigneeUserId: a.id, status: "open", priority: "normal", origin: "user", overdue: false });
      expect(await db.auditLog.count({ where: { action: "task.created", entityId: id } })).toBe(1);
    });

    it("refuse une échéance passée mais accepte celle d'aujourd'hui", async () => {
      await expect(tsk.createTask(a, taskInput({ dueDate: day(12) }), now)).rejects.toMatchObject({
        details: { fieldErrors: { dueDate: expect.any(Array) } },
      });
      await expect(tsk.createTask(a, taskInput({ dueDate: day(13) }), now)).resolves.toHaveProperty("id");
    });

    it("rattache la tâche à son opportunité et déduit le compte", async () => {
      const { id: oppId } = await opp.createOpportunity(a, oppInput());
      const { id } = await tsk.createTask(a, taskInput({ opportunityId: oppId }), now);
      expect(await tsk.getTask(a, id, now)).toMatchObject({ opportunityId: oppId, accountId });
    });

    it("refuse un contact sans compte et un contact étranger au compte", async () => {
      const contactId = await contactOf(a);
      await expect(tsk.createTask(a, taskInput({ contactId }), now)).rejects.toMatchObject({
        details: { fieldErrors: { contactId: expect.any(Array) } },
      });
      const stranger = await con.createContact(a, { firstName: "Hors", lastName: `Compte${uniq()}`, status: "active", forceDuplicate: false });
      await expect(tsk.createTask(a, taskInput({ accountId, contactId: stranger.id }), now)).rejects.toMatchObject({
        details: { fieldErrors: { contactId: expect.any(Array) } },
      });
    });

    it("réserve la réaffectation aux profils autorisés et refuse l'audit comme responsable", async () => {
      await expect(tsk.createTask(a, taskInput({ assigneeUserId: manager.id }), now)).rejects.toMatchObject({
        details: { fieldErrors: { assigneeUserId: expect.any(Array) } },
      });
      await expect(tsk.createTask(manager, taskInput({ assigneeUserId: a.id }), now)).resolves.toHaveProperty("id");
      await expect(tsk.createTask(manager, taskInput({ assigneeUserId: audit.id }), now)).rejects.toMatchObject({
        details: { fieldErrors: { assigneeUserId: expect.any(Array) } },
      });
    });

    it("calcule les retards et les compteurs, et sépare les vues", async () => {
      // Tâches insérées directement : la création refuse volontairement une échéance passée.
      const make = (title: string, dueDate: Date, over: Record<string, unknown> = {}) =>
        db.task.create({ data: { title, dueDate, assigneeUserId: a.id, createdByUserId: a.id, ...over } });
      await make("En retard", day(10));
      await make("Aujourd'hui", day(13));
      await make("Plus tard", day(25));
      await make("Faite", day(5), { status: "done", completedAt: day(6) });

      const open = await tsk.listTasks(a, { view: "open", assigneeId: a.id }, now);
      expect(open.rows.map((r) => r.title)).toEqual(["En retard", "Aujourd'hui", "Plus tard"]);
      expect(open.rows[0]).toMatchObject({ overdue: true, daysLate: 3 });
      expect(open.counts).toEqual({ open: 3, late: 1, today: 1 });

      expect((await tsk.listTasks(a, { view: "late", assigneeId: a.id }, now)).rows.map((r) => r.title)).toEqual(["En retard"]);
      expect((await tsk.listTasks(a, { view: "today", assigneeId: a.id }, now)).rows.map((r) => r.title)).toEqual(["Aujourd'hui"]);
      expect((await tsk.listTasks(a, { view: "done", assigneeId: a.id }, now)).rows.map((r) => r.title)).toEqual(["Faite"]);
    });

    it("termine, annule et rouvre une tâche avec date de réalisation posée par le serveur", async () => {
      const { id } = await tsk.createTask(a, taskInput(), now);
      let version = (await tsk.getTask(a, id, now)).version;

      await tsk.setTaskStatus(a, { id, version, status: "done" }, now);
      let task = await tsk.getTask(a, id, now);
      expect(task).toMatchObject({ status: "done", overdue: false });
      expect(task.completedAt?.toISOString()).toBe(now.toISOString());

      version = task.version;
      await expect(tsk.setTaskStatus(a, { id, version, status: "done" }, now)).rejects.toMatchObject({ code: "VALIDATION" });
      await tsk.setTaskStatus(a, { id, version, status: "open" }, now);
      task = await tsk.getTask(a, id, now);
      expect(task).toMatchObject({ status: "open", completedAt: null });

      await tsk.setTaskStatus(a, { id, version: task.version, status: "cancelled" }, now);
      expect((await tsk.getTask(a, id, now)).status).toBe("cancelled");
      expect(await db.auditLog.count({ where: { action: { in: ["task.completed", "task.reopened", "task.cancelled"] }, entityId: id } })).toBe(3);
    });

    it("ne modifie qu'une tâche ouverte, avec verrou optimiste, et trace la réaffectation", async () => {
      const { id } = await tsk.createTask(manager, taskInput({ assigneeUserId: a.id }), now);
      const task = await tsk.getTask(manager, id, now);
      const edit = { ...taskInput({ title: "Titre corrigé", assigneeUserId: manager.id }), id, version: task.version };

      await expect(tsk.updateTask(manager, edit, now)).resolves.toEqual({ id });
      expect((await tsk.getTask(manager, id, now)).assigneeUserId).toBe(manager.id);
      expect(await db.auditLog.count({ where: { action: "task.reassigned", entityId: id } })).toBe(1);

      // Version périmée : conflit.
      await expect(tsk.updateTask(manager, edit, now)).rejects.toMatchObject({ code: "CONFLICT" });

      // Une tâche terminée ne se modifie plus.
      const fresh = await tsk.getTask(manager, id, now);
      await tsk.setTaskStatus(manager, { id, version: fresh.version, status: "done" }, now);
      await expect(tsk.updateTask(manager, { ...edit, version: fresh.version + 1 }, now)).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("applique le périmètre : un commercial ne voit pas la tâche d'un autre sans lien avec ses comptes", async () => {
      const { id } = await tsk.createTask(a, taskInput(), now);

      await expect(tsk.getTask(b, id, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(tsk.getTask(manager, id, now)).resolves.toMatchObject({ id });
      await expect(tsk.getTask(direction, id, now)).resolves.toMatchObject({ id });
      await expect(tsk.getTask(audit, id, now)).resolves.toMatchObject({ id });

      const version = (await tsk.getTask(a, id, now)).version;
      await expect(tsk.setTaskStatus(b, { id, version, status: "done" }, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(tsk.setTaskStatus(audit, { id, version, status: "done" }, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuse en base un statut inconnu et une tâche terminée sans date de réalisation", async () => {
      const base = { title: "x", dueDate: day(20), assigneeUserId: a.id, createdByUserId: a.id };
      await expect(db.task.create({ data: { ...base, status: "archived" } })).rejects.toThrow();
      await expect(db.task.create({ data: { ...base, status: "done" } })).rejects.toThrow();
      await expect(db.task.create({ data: { ...base, status: "open", completedAt: now } })).rejects.toThrow();
    });
  });

  describe("fil unifié (CDC 3.4)", () => {
    it("fusionne activités, tâches et changements d'étape du plus récent au plus ancien, avec leur origine", async () => {
      const { id: oppId } = await opp.createOpportunity(a, oppInput({ stage: 20 }));
      await act.createActivity(a, activityInput({ opportunityId: oppId, occurredAt: new Date(Date.UTC(2026, 9, 10, 9)), subject: "Premier appel" }));
      await opp.moveStage(a, {
        id: oppId,
        version: (await db.opportunity.findUniqueOrThrow({ where: { id: oppId } })).version,
        targetStage: 40,
        criteriaConfirmed: true,
        wonConfirmed: false,
      });
      // Échéance lointaine : la tâche doit rester l'élément le plus récent du fil quelle que soit la date réelle d'exécution du
      // test (le changement d'étape ci-dessus est horodaté à l'instant réel ; avec day(20) le test échouait après le 20 octobre).
      await tsk.createTask(a, taskInput({ opportunityId: oppId, title: "Préparer le devis", dueDate: new Date(Date.UTC(2035, 0, 15)) }), now);
      await db.activity.create({
        data: { type: "email", subject: "E-mail reçu", occurredAt: new Date(Date.UTC(2026, 9, 1)), authorUserId: a.id, accountId, origin: "sync" },
      });

      const { items, truncated } = await act.listFeed(a, { accountId }, now);
      expect(truncated).toBe(false);
      const titles = items.map((i) => i.title);
      expect(titles[0]).toBe("Préparer le devis");
      expect(titles).toContain("Premier appel");
      expect(titles).toContain("Étape : 20 % → 40 %");
      expect(titles[titles.length - 1]).toBe("E-mail reçu");
      expect(items.find((i) => i.title === "E-mail reçu")?.origin).toBe("sync");
      expect([...items].sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime()).map((i) => i.key)).toEqual(items.map((i) => i.key));
    });

    it("filtre par type, contact, opportunité, auteur et période", async () => {
      const contactId = await contactOf(a);
      const { id: oppId } = await opp.createOpportunity(a, oppInput());
      await act.createActivity(a, activityInput({ type: "meeting", subject: "Réunion", contactId, opportunityId: oppId, occurredAt: new Date(Date.UTC(2026, 9, 5, 9)) }));
      await act.createActivity(manager, activityInput({ type: "note", subject: "Note du manager", occurredAt: new Date(Date.UTC(2026, 9, 12, 9)) }));
      await tsk.createTask(a, taskInput({ title: "Une tâche", accountId }), now);

      const titles = async (filters: Parameters<typeof act.listFeed>[1]) => (await act.listFeed(a, filters, now)).items.map((i) => i.title);

      expect(await titles({ accountId, type: "meeting" })).toEqual(["Réunion"]);
      expect(await titles({ accountId, type: "task" })).toEqual(["Une tâche"]);
      expect(await titles({ accountId, contactId })).toEqual(["Réunion"]);
      expect(await titles({ accountId, opportunityId: oppId })).toEqual(["Réunion"]);
      expect(await titles({ accountId, authorId: manager.id })).toEqual(["Note du manager"]);
      expect(await titles({ accountId, type: "note", from: day(10), to: day(12) })).toEqual(["Note du manager"]);
      expect(await titles({ accountId, type: "meeting", from: day(10) })).toEqual([]);
    });

    it("ne révèle rien hors du périmètre", async () => {
      await act.createActivity(a, activityInput({ subject: "Confidentiel" }));
      await tsk.createTask(a, taskInput({ accountId, title: "Tâche du compte" }), now);

      expect((await act.listFeed(b, {}, now)).items).toHaveLength(0);
      expect((await act.listFeed(b, { accountId }, now)).items).toHaveLength(0);
      expect((await act.listFeed(manager, { accountId }, now)).items.map((i) => i.title).sort()).toEqual(["Confidentiel", "Tâche du compte"]);
      expect((await act.listFeed(audit, { accountId }, now)).items).toHaveLength(2);
    });

    it("signale la troncature au-delà de la limite", async () => {
      await db.activity.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({
          type: "note",
          subject: `Note ${i}`,
          occurredAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
          authorUserId: a.id,
          accountId,
        })),
      });
      const feed = await act.listFeed(a, { accountId }, now);
      expect(feed.items).toHaveLength(100);
      expect(feed.truncated).toBe(true);
    });
  });

  describe("liens des formulaires", () => {
    it("liste les contacts et opportunités d'un compte visible, et refuse un compte hors périmètre", async () => {
      const contactId = await contactOf(a);
      const { id: oppId } = await opp.createOpportunity(a, oppInput());

      const options = await act.getLinkOptions(a, accountId);
      expect(options.account.name).toBe("Compte des activités");
      expect(options.contacts.map((c) => c.id)).toEqual([contactId]);
      expect(options.opportunities.map((o) => o.id)).toEqual([oppId]);

      await expect(act.getLinkOptions(b, accountId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
