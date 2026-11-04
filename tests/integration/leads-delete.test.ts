import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateLeadInput } from "@/features/leads/schemas";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Suppression définitive d'un prospect (sur la base dédiée, voir tests/setup.ts) : permission, périmètre d'équipe,
// historique supprimé avec lui, éléments de conversion conservés, trace d'audit sans donnée personnelle.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];
type Service = typeof import("@/features/leads/service");

describe.skipIf(!hasDb)("suppression d'un prospect (PostgreSQL)", () => {
  let db: Db;
  let svc: Service;
  let manager: CurrentUser; // manager de l'équipe
  let teamSales: CurrentUser; // commercial de l'équipe de `manager`
  let outsider: CurrentUser; // commercial d'une autre équipe
  let direction: CurrentUser;
  let sysAdmin: CurrentUser;
  let audit: CurrentUser;

  const uniq = () => randomUUID().slice(0, 8);

  async function makeUser(role: Role, label: string, teamId: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, teamId, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId, mustChangePassword: false };
  }

  const todayUtc = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  };

  function leadInput(over: Partial<CreateLeadInput> = {}): CreateLeadInput {
    const id = uniq();
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

    manager = await makeUser("manager", "Manager Suppression");
    const team = await db.team.create({ data: { name: `Équipe suppression ${uniq()}`, managerUserId: manager.id } });
    await db.user.update({ where: { id: manager.id }, data: { teamId: team.id } });
    manager = { ...manager, teamId: team.id };
    teamSales = await makeUser("commercial", "Commercial Équipe", team.id);

    const otherManager = await makeUser("manager", "Manager Autre");
    const otherTeam = await db.team.create({ data: { name: `Autre équipe ${uniq()}`, managerUserId: otherManager.id } });
    await db.user.update({ where: { id: otherManager.id }, data: { teamId: otherTeam.id } });
    outsider = await makeUser("commercial", "Commercial Hors équipe", otherTeam.id);

    direction = await makeUser("direction", "Direction Suppression");
    sysAdmin = await makeUser("admin", "Admin Suppression");
    audit = await makeUser("audit", "Audit Suppression");
  });

  beforeEach(async () => {
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("le manager supprime un prospect de son équipe : le prospect et son historique disparaissent", async () => {
    const created = await svc.createLead(teamSales, leadInput());
    expect(await db.leadEvent.count({ where: { leadId: created.id } })).toBeGreaterThan(0);

    const result = await svc.deleteLead(manager, created.id);
    expect(result.id).toBe(created.id);
    expect(await db.lead.count({ where: { id: created.id } })).toBe(0);
    expect(await db.leadEvent.count({ where: { leadId: created.id } })).toBe(0);
    await expect(svc.getLead(manager, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("le manager supprime aussi son propre prospect et un prospect déjà clôturé", async () => {
    const own = await svc.createLead(manager, leadInput());
    const lost = await svc.createLead(teamSales, leadInput());
    await svc.markLost(teamSales, { id: lost.id, version: 1, reason: "price" });

    await svc.deleteLead(manager, own.id);
    await svc.deleteLead(manager, lost.id);
    expect(await db.lead.count()).toBe(0);
  });

  it("un prospect hors de l'équipe du manager est présenté comme introuvable et reste intact", async () => {
    const foreign = await svc.createLead(outsider, leadInput());
    await expect(svc.deleteLead(manager, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.lead.count({ where: { id: foreign.id } })).toBe(1);
    expect(await db.leadEvent.count({ where: { leadId: foreign.id } })).toBeGreaterThan(0);
  });

  it("l'administrateur supprime n'importe quel prospect", async () => {
    const lead = await svc.createLead(outsider, leadInput());
    await svc.deleteLead(sysAdmin, lead.id);
    expect(await db.lead.count({ where: { id: lead.id } })).toBe(0);
  });

  it("le commercial, la direction et l'audit n'ont pas le droit de supprimer", async () => {
    const lead = await svc.createLead(teamSales, leadInput());
    for (const user of [teamSales, direction, audit]) {
      await expect(svc.deleteLead(user, lead.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.lead.count({ where: { id: lead.id } })).toBe(1);
  });

  it("un identifiant inconnu est introuvable", async () => {
    await expect(svc.deleteLead(manager, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("conserve le compte et l'opportunité créés par la conversion", async () => {
    const lead = await svc.createLead(teamSales, leadInput());
    const account = await db.crmAccount.create({
      data: { legalName: `Compte ${uniq()}`, sector: "Santé", status: "client", country: "CI", ownerUserId: teamSales.id },
    });
    const opportunity = await db.opportunity.create({
      data: {
        name: `Opportunité ${uniq()}`,
        accountId: account.id,
        ownerUserId: teamSales.id,
        amount: 1_000_000,
        stage: 20,
        expectedCloseDate: new Date(Date.UTC(2027, 0, 15)),
        nextAction: "Appeler",
        nextActionDate: new Date(Date.UTC(2027, 0, 5)),
      },
    });
    await db.lead.update({
      where: { id: lead.id },
      data: { convertedAt: new Date(), convertedAccountId: account.id, convertedOpportunityId: opportunity.id },
    });

    await svc.deleteLead(manager, lead.id);
    expect(await db.lead.count({ where: { id: lead.id } })).toBe(0);
    expect(await db.opportunity.count({ where: { id: opportunity.id } })).toBe(1);
    expect(await db.crmAccount.count({ where: { id: account.id } })).toBe(1);
  });

  it("trace la suppression dans l'audit, sans nom, téléphone ni e-mail du contact", async () => {
    const input = leadInput({ progress: 20 });
    const lead = await svc.createLead(teamSales, input);
    await svc.deleteLead(manager, lead.id);

    const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: lead.id, action: "lead.deleted" } });
    expect(trace.actorUserId).toBe(manager.id);
    expect(trace.entityType).toBe("lead");
    expect(trace.metadata).toMatchObject({
      companyName: input.companyName,
      ownerUserId: teamSales.id,
      progress: 20,
      status: "open",
      converted: false,
      eventsRemoved: 1,
    });
    const serialized = JSON.stringify(trace.metadata);
    expect(serialized).not.toContain(input.email);
    expect(serialized).not.toContain(input.phone);
    expect(serialized).not.toContain(input.contactLastName);
  });

  it("n'écrit aucune trace quand la suppression est refusée", async () => {
    const lead = await svc.createLead(outsider, leadInput());
    await svc.deleteLead(manager, lead.id).catch(() => undefined);
    await svc.deleteLead(teamSales, lead.id).catch(() => undefined);
    expect(await db.auditLog.count({ where: { entityId: lead.id, action: "lead.deleted" } })).toBe(0);
  });
});
