import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultParams, RULE_CODES } from "@/features/automations/config";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests des automatisations, du journal d'exécution et du centre de notifications sur la base dédiée
// (TEST_DATABASE_URL, voir tests/setup.ts). Le temps est figé : « maintenant » = 13/10/2026 à 10h00 UTC.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("automatisations et notifications (PostgreSQL)", () => {
  let db: Db;
  let engine: typeof import("@/features/automations/engine");
  let admin: typeof import("@/features/automations/service");
  let notif: typeof import("@/features/notifications/service");
  let owner: CurrentUser; // commercial de l'équipe
  let other: CurrentUser; // autre commercial, sans équipe
  let manager: CurrentUser;
  let sysAdmin: CurrentUser;
  let teamId: string;

  const uniq = () => randomUUID().slice(0, 8);
  const now = new Date(Date.UTC(2026, 9, 13, 10, 0));
  const day = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h));
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  async function makeUser(role: Role, label: string, team: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, teamId: team, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: team, mustChangePassword: false };
  }

  const account = (over: Record<string, unknown> = {}) =>
    db.crmAccount.create({
      data: { legalName: `Compte ${uniq()}`, sector: "Santé", status: "client", country: "CI", ownerUserId: owner.id, createdAt: daysAgo(200), ...over },
    });

  const opportunity = (accountId: string, over: Record<string, unknown> = {}) =>
    db.opportunity.create({
      data: {
        name: `Opportunité ${uniq()}`,
        accountId,
        ownerUserId: owner.id,
        amount: 1_000_000,
        stage: 20,
        expectedCloseDate: day(30),
        nextAction: "Appeler",
        nextActionDate: day(20),
        ...over,
      },
    });

  const task = (over: Record<string, unknown> = {}) =>
    db.task.create({
      data: { title: `Tâche ${uniq()}`, dueDate: day(20), assigneeUserId: owner.id, createdByUserId: owner.id, ...over },
    });

  const run = (only?: Parameters<typeof engine.runAutomations>[0]["only"], at = now) =>
    engine.runAutomations({ trigger: "manual", now: at, only });

  const inbox = (userId: string, source?: string) =>
    db.notification.findMany({ where: { userId, ...(source ? { source } : {}) }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    engine = await import("@/features/automations/engine");
    admin = await import("@/features/automations/service");
    notif = await import("@/features/notifications/service");

    sysAdmin = await makeUser("admin", "Admin Automatisations");
    manager = await makeUser("manager", "Manager Équipe");
    teamId = (await db.team.create({ data: { name: `Équipe auto ${uniq()}`, managerUserId: manager.id } })).id;
    await db.user.update({ where: { id: manager.id }, data: { teamId } });
    manager = { ...manager, teamId };
    owner = await makeUser("commercial", "Commercial Alpha", teamId);
    other = await makeUser("commercial", "Commercial Beta");
  });

  beforeEach(async () => {
    await db.notification.deleteMany();
    await db.automationRun.deleteMany();
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
    // Les règles sont créées par la migration : on les remet à leur état d'origine avant chaque test.
    for (const code of RULE_CODES) {
      await db.automationRule.update({ where: { code }, data: { enabled: true, params: defaultParams(code) } });
    }
    await db.user.update({ where: { id: owner.id }, data: { banned: false } });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("compte sans activité (CDC 6.2)", () => {
    it("applique un seuil par segment : 15 jours pour un grand compte, 30 pour les autres", async () => {
      const large = await account({ legalName: "Grand compte", employeeCount: 300 });
      const standard = await account({ legalName: "Petit compte", employeeCount: 20 });
      const recent = await account({ legalName: "Compte actif", employeeCount: 300 });
      for (const [acc, ago] of [[large, 16], [standard, 16], [recent, 3]] as const) {
        await db.activity.create({ data: { type: "call_out", subject: "x", occurredAt: daysAgo(ago), authorUserId: owner.id, accountId: acc.id } });
      }

      const [summary] = await run(["inactivity"]);
      expect(summary).toMatchObject({ status: "success", evaluated: 1, tasksCreated: 1 });

      const tasks = await db.task.findMany({ where: { origin: "automation" } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ accountId: large.id, assigneeUserId: owner.id, status: "open", title: "Relancer Grand compte" });
      expect(tasks[0].dueDate.toISOString()).toBe(day(15).toISOString());

      const [notification] = await inbox(owner.id, "inactivity");
      expect(notification).toMatchObject({ itemCount: 1, href: "/taches" });
    });

    it("signale aussi un compte de taille standard après 30 jours, et un compte jamais contacté", async () => {
      const stale = await account({ legalName: "Standard ancien", employeeCount: 20 });
      await db.activity.create({ data: { type: "note", subject: "x", occurredAt: daysAgo(31), authorUserId: owner.id, accountId: stale.id } });
      await account({ legalName: "Jamais contacté", createdAt: daysAgo(90) });
      await account({ legalName: "Tout neuf", createdAt: daysAgo(2) });

      const [summary] = await run(["inactivity"]);
      expect(summary.evaluated).toBe(2);
      expect((await db.task.findMany({ where: { origin: "automation" } })).map((t) => t.title).sort()).toEqual([
        "Relancer Jamais contacté",
        "Relancer Standard ancien",
      ]);
      // Une seule notification regroupée pour deux comptes.
      const notifications = await inbox(owner.id, "inactivity");
      expect(notifications).toHaveLength(1);
      expect(notifications[0].itemCount).toBe(2);
    });

    it("ignore un rendez-vous planifié dans le futur et les comptes archivés ou partenaires", async () => {
      const planned = await account({ legalName: "Rendez-vous prévu", employeeCount: 300, createdAt: daysAgo(100) });
      await db.activity.create({ data: { type: "meeting", subject: "x", occurredAt: day(20), authorUserId: owner.id, accountId: planned.id } });
      await account({ legalName: "Archivé", archivedAt: daysAgo(1) });
      await account({ legalName: "Partenaire", status: "partner" });

      const [summary] = await run(["inactivity"]);
      // Le rendez-vous futur ne compte pas comme un échange : le compte reste inactif.
      expect(summary.evaluated).toBe(1);
      expect((await db.task.findFirstOrThrow({ where: { origin: "automation" } })).title).toBe("Relancer Rendez-vous prévu");
    });

    it("est idempotent : une tâche par compte et par période, une nouvelle à la période suivante", async () => {
      await account({ legalName: "Inactif", employeeCount: 300 });

      const first = (await run(["inactivity"]))[0];
      const second = (await run(["inactivity"]))[0];
      expect(first).toMatchObject({ tasksCreated: 1, notificationsCreated: 1, skipped: 0 });
      expect(second).toMatchObject({ tasksCreated: 0, notificationsCreated: 0, skipped: 2 });
      expect(await db.task.count({ where: { origin: "automation" } })).toBe(1);
      expect(await db.notification.count()).toBe(1);

      // La fréquence par défaut est de 7 jours : 8 jours plus tard, c'est une nouvelle période.
      const later = (await run(["inactivity"], new Date(now.getTime() + 8 * 86_400_000)))[0];
      expect(later.tasksCreated).toBe(1);
      expect(await db.task.count({ where: { origin: "automation" } })).toBe(2);
    });

    it("ne crée rien pour un propriétaire désactivé", async () => {
      await account({ employeeCount: 300 });
      await db.user.update({ where: { id: owner.id }, data: { banned: true } });

      const [summary] = await run(["inactivity"]);
      expect(summary.evaluated).toBe(0);
      expect(await db.task.count()).toBe(0);
    });
  });

  describe("opportunités", () => {
    it("alerte le propriétaire dont la prochaine action est dépassée, en un seul message", async () => {
      const acc = await account();
      const late = await opportunity(acc.id, { name: "En retard A", nextActionDate: day(10) });
      await opportunity(acc.id, { name: "En retard B", nextActionDate: day(11) });
      await opportunity(acc.id, { name: "À jour", nextActionDate: day(20) });
      await opportunity(acc.id, { name: "Clôturée", status: "lost", stage: 20, lossReason: "price", closedAt: daysAgo(3), nextActionDate: null, nextAction: null, expectedCloseDate: null });

      const [summary] = await run(["no_next_action"]);
      expect(summary).toMatchObject({ evaluated: 2, notificationsCreated: 1 });

      const [notification] = await inbox(owner.id, "no_next_action");
      expect(notification.itemCount).toBe(2);
      expect(notification.href).toBe("/opportunites");
      expect(late.id).toBeTruthy();

      expect((await run(["no_next_action"]))[0].notificationsCreated).toBe(0);
    });

    it("renvoie vers la fiche quand une seule opportunité est concernée", async () => {
      const acc = await account();
      const only = await opportunity(acc.id, { nextActionDate: day(1) });

      await run(["no_next_action"]);
      expect((await inbox(owner.id, "no_next_action"))[0].href).toBe(`/opportunites/${only.id}`);
    });

    it("demande la mise à jour d'une clôture dépassée, puis escalade au manager après le délai", async () => {
      const acc = await account();
      await opportunity(acc.id, { name: "Dépassée de 10 jours", expectedCloseDate: day(3) });
      await opportunity(acc.id, { name: "Dépassée de 2 jours", expectedCloseDate: day(11) });
      await opportunity(acc.id, { name: "Dans les temps", expectedCloseDate: day(25) });

      const [summary] = await run(["close_date_overdue"]);
      expect(summary.evaluated).toBe(2);

      const [toOwner] = await inbox(owner.id, "close_date_overdue");
      expect(toOwner.itemCount).toBe(2);

      const [toManager] = await inbox(manager.id, "close_date_overdue");
      expect(toManager.itemCount).toBe(1);
      expect(toManager.body).toContain("Dépassée de 10 jours");
      expect(toManager.title).toContain("de votre équipe");
    });

    it("n'escalade pas un retard inférieur au délai, ni pour un propriétaire sans équipe", async () => {
      const acc = await account({ ownerUserId: other.id });
      await opportunity(acc.id, { ownerUserId: other.id, expectedCloseDate: day(1) });

      await run(["close_date_overdue"]);
      expect(await inbox(other.id)).toHaveLength(1);
      expect(await inbox(manager.id)).toHaveLength(0);
    });
  });

  describe("rendez-vous imminent", () => {
    it("rappelle un rendez-vous dans le délai, une seule fois", async () => {
      const acc = await account();
      await db.activity.create({ data: { type: "meeting", subject: "Rendez-vous client", occurredAt: day(13, 15), authorUserId: owner.id, accountId: acc.id } });
      await db.activity.create({ data: { type: "video", subject: "Visio lointaine", occurredAt: day(16, 10), authorUserId: owner.id, accountId: acc.id } });
      await db.activity.create({ data: { type: "meeting", subject: "Déjà passé", occurredAt: day(12, 10), authorUserId: owner.id, accountId: acc.id } });
      await db.activity.create({ data: { type: "call_out", subject: "Appel prévu", occurredAt: day(13, 12), authorUserId: owner.id, accountId: acc.id } });

      const [summary] = await run(["meeting_soon"]);
      expect(summary).toMatchObject({ evaluated: 1, notificationsCreated: 1 });
      const [reminder] = await inbox(owner.id, "meeting_soon");
      expect(reminder.title).toBe("Rendez-vous imminent : Rendez-vous client");
      expect(reminder.body).toContain("13/10/2026 à 15:00");

      expect((await run(["meeting_soon"]))[0]).toMatchObject({ notificationsCreated: 0, skipped: 1 });
    });

    it("respecte le délai paramétré", async () => {
      const acc = await account();
      await db.activity.create({ data: { type: "meeting", subject: "Dans 30 heures", occurredAt: new Date(now.getTime() + 30 * 3_600_000), authorUserId: owner.id, accountId: acc.id } });

      expect((await run(["meeting_soon"]))[0].evaluated).toBe(0);
      await admin.updateRule(sysAdmin, { code: "meeting_soon", enabled: true, params: { hoursBefore: 48 } });
      expect((await run(["meeting_soon"]))[0].evaluated).toBe(1);
    });
  });

  describe("tâche en retard", () => {
    it("regroupe les retards d'un responsable et escalade ceux qui atteignent le délai", async () => {
      await task({ title: "Retard de 4 jours", dueDate: day(9) });
      await task({ title: "Retard de 1 jour", dueDate: day(12) });
      await task({ title: "Pour aujourd'hui", dueDate: day(13) });
      await task({ title: "Faite", dueDate: day(1), status: "done", completedAt: day(2) });

      const [summary] = await run(["task_overdue"]);
      expect(summary.evaluated).toBe(2);

      const [toOwner] = await inbox(owner.id, "task_overdue");
      expect(toOwner).toMatchObject({ itemCount: 2, href: "/taches?vue=late" });
      const [toManager] = await inbox(manager.id, "task_overdue");
      expect(toManager).toMatchObject({ itemCount: 1, href: "/taches?vue=late&responsable=tous" });
    });

    it("ne notifie pas deux fois le même jour, mais le lendemain oui", async () => {
      await task({ dueDate: day(9) });

      await run(["task_overdue"]);
      await run(["task_overdue"]);
      expect(await inbox(owner.id, "task_overdue")).toHaveLength(1);

      await run(["task_overdue"], new Date(now.getTime() + 86_400_000));
      expect(await inbox(owner.id, "task_overdue")).toHaveLength(2);
    });

    it("ne prévient pas le manager de ses propres retards", async () => {
      await task({ assigneeUserId: manager.id, createdByUserId: manager.id, dueDate: day(1) });

      await run(["task_overdue"]);
      expect(await inbox(manager.id, "task_overdue")).toHaveLength(1);
    });
  });

  describe("journal d'exécution et activation (CDC 6.2)", () => {
    it("journalise chaque règle exécutée avec ses compteurs", async () => {
      await task({ dueDate: day(9) });
      // Le journal d'audit est en ajout seul : on compare avant et après plutôt que de supposer une table vide.
      const auditBefore = await db.auditLog.count({ where: { action: "automation.run" } });

      const summaries = await run();
      expect(summaries).toHaveLength(RULE_CODES.length);

      const runs = await db.automationRun.findMany();
      expect(runs).toHaveLength(RULE_CODES.length);
      const overdue = runs.find((r) => r.ruleCode === "task_overdue");
      expect(overdue).toMatchObject({ status: "success", trigger: "manual", evaluated: 1, notificationsCreated: 2 });
      expect(overdue?.finishedAt).not.toBeNull();
      expect(await db.auditLog.count({ where: { action: "automation.run" } })).toBe(auditBefore + 1);
    });

    it("n'exécute pas une règle désactivée et ne la journalise pas", async () => {
      await task({ dueDate: day(9) });
      await admin.updateRule(sysAdmin, { code: "task_overdue", enabled: false, params: defaultParams("task_overdue") });

      const summaries = await run();
      expect(summaries.find((s) => s.ruleCode === "task_overdue")).toMatchObject({ status: "disabled", evaluated: 0 });
      expect(await db.notification.count()).toBe(0);
      expect(await db.automationRun.count({ where: { ruleCode: "task_overdue" } })).toBe(0);
    });

    it("limite l'exécution aux règles demandées", async () => {
      expect((await run(["meeting_soon"])).map((s) => s.ruleCode)).toEqual(["meeting_soon"]);
    });
  });

  describe("administration des règles", () => {
    it("réserve la lecture, le réglage et l'exécution manuelle à l'administrateur", async () => {
      await expect(admin.listRules(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(admin.listRules(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(admin.updateRule(manager, { code: "inactivity", enabled: false, params: defaultParams("inactivity") })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(admin.runNow(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(admin.listRuns(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });

      const rules = await admin.listRules(sysAdmin);
      expect(rules.map((r) => r.code)).toEqual([...RULE_CODES]);
      expect(rules.every((r) => r.enabled)).toBe(true);
    });

    it("enregistre les paramètres et trace le changement sans en recopier les valeurs", async () => {
      await admin.updateRule(sysAdmin, { code: "inactivity", enabled: true, params: { ...defaultParams("inactivity"), largeDays: 10 } });

      const rule = (await admin.listRules(sysAdmin)).find((r) => r.code === "inactivity");
      expect(rule?.params.largeDays).toBe(10);
      const audit = await db.auditLog.findFirstOrThrow({
        where: { action: "automation.rule_updated" },
        orderBy: { occurredAt: "desc" },
      });
      expect(audit.metadata).toMatchObject({ code: "inactivity", changedParams: ["largeDays"], enabledChanged: false });
    });

    it("refuse des paramètres hors bornes avec le détail par champ", async () => {
      await expect(
        admin.updateRule(sysAdmin, { code: "inactivity", enabled: true, params: { ...defaultParams("inactivity"), largeDays: 0, standardDays: "abc" } }),
      ).rejects.toMatchObject({ details: { fieldErrors: { p_largeDays: expect.any(Array), p_standardDays: expect.any(Array) } } });
    });

    it("liste le journal des exécutions, la plus récente d'abord", async () => {
      await admin.runNow(sysAdmin);
      const runs = await admin.listRuns(sysAdmin);
      expect(runs).toHaveLength(RULE_CODES.length);
      expect(runs[0].startedAt.getTime()).toBeGreaterThanOrEqual(runs[runs.length - 1].startedAt.getTime());
    });

    it("refuse en base un code de règle inconnu et un statut d'exécution invalide", async () => {
      await expect(db.automationRule.create({ data: { code: "inconnue", params: {} } })).rejects.toThrow();
      await expect(db.automationRun.create({ data: { ruleCode: "inactivity", trigger: "manual", status: "bizarre" } })).rejects.toThrow();
    });
  });

  describe("centre de notifications (CDC 6.3)", () => {
    const make = (userId: string, key: string, over: Record<string, unknown> = {}) => ({
      userId,
      source: "task_overdue",
      title: `Notification ${key}`,
      href: "/taches",
      dedupeKey: key,
      ...over,
    });

    it("ignore une notification dont la clé existe déjà pour le destinataire (anti-spam)", async () => {
      expect(await notif.createNotifications([make(owner.id, "k1"), make(other.id, "k1")])).toBe(2);
      expect(await notif.createNotifications([make(owner.id, "k1"), make(owner.id, "k2")])).toBe(1);
      expect(await db.notification.count({ where: { userId: owner.id } })).toBe(2);
    });

    it("liste les siennes, de la plus récente à la plus ancienne, avec le compteur de non lues", async () => {
      await notif.createNotifications([make(owner.id, "a")]);
      await notif.createNotifications([make(owner.id, "b")]);
      await notif.createNotifications([make(other.id, "c")]);

      const list = await notif.listNotifications(owner);
      expect(list.rows.map((r) => r.title)).toEqual(["Notification b", "Notification a"]);
      expect(list).toMatchObject({ total: 2, unread: 2 });
      expect(await notif.countUnread(owner.id)).toBe(2);
    });

    it("marque comme lue, filtre les non lues et ne touche jamais celles d'un autre", async () => {
      await notif.createNotifications([make(owner.id, "a"), make(owner.id, "b"), make(other.id, "c")]);
      const [first] = (await notif.listNotifications(owner)).rows;
      const foreign = await db.notification.findFirstOrThrow({ where: { userId: other.id } });

      expect(await notif.markRead(owner, first.id)).toBe(true);
      expect(await notif.markRead(owner, first.id)).toBe(false);
      expect(await notif.markRead(owner, foreign.id)).toBe(false);
      expect((await db.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();

      const unread = await notif.listNotifications(owner, { unreadOnly: true });
      expect(unread).toMatchObject({ total: 1, unread: 1 });
    });

    it("marque toutes les siennes comme lues sans toucher aux autres", async () => {
      await notif.createNotifications([make(owner.id, "a"), make(owner.id, "b"), make(other.id, "c")]);

      expect(await notif.markAllRead(owner)).toBe(2);
      expect(await notif.countUnread(owner.id)).toBe(0);
      expect(await notif.countUnread(other.id)).toBe(1);
    });

    it("n'accepte que des liens internes", () => {
      expect(notif.safeNotificationHref("/taches?vue=late")).toBe("/taches?vue=late");
      expect(notif.safeNotificationHref("https://evil.example")).toBe("/notifications");
      expect(notif.safeNotificationHref("//evil.example")).toBe("/notifications");
      expect(notif.safeNotificationHref("/a\\b")).toBe("/notifications");
    });

    it("prévient la personne à qui une tâche est confiée, mais pas celle qui se l'attribue", async () => {
      const tasks = await import("@/features/tasks/service");
      const { id } = await tasks.createTask(manager, { title: "À confier", dueDate: day(25), priority: "normal" }, now);
      const edit = { id, version: 1, title: "À confier", dueDate: day(25), priority: "normal" as const, assigneeUserId: owner.id };

      await tasks.updateTask(manager, edit, now);
      const received = await inbox(owner.id, "owner_changed");
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ title: "Une tâche vous a été confiée", body: "À confier", href: "/taches" });

      await tasks.updateTask(manager, { ...edit, version: 2, assigneeUserId: manager.id }, now);
      expect(await inbox(manager.id, "owner_changed")).toHaveLength(0);
    });

    it("supprime les notifications d'un utilisateur supprimé", async () => {
      const temp = await makeUser("commercial", "Temporaire");
      await notif.createNotifications([make(temp.id, "x")]);
      await db.user.delete({ where: { id: temp.id } });
      expect(await db.notification.count({ where: { userId: temp.id } })).toBe(0);
    });
  });
});
