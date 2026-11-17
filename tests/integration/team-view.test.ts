import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateLeadInput } from "@/features/leads/schemas";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tableau de bord individuel d'un membre pour son manager (sur la base dédiée, voir tests/setup.ts) : liste des membres,
// refus hors équipe, et indicateurs réellement limités au membre choisi.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("vue individuelle d'un membre d'équipe (PostgreSQL)", () => {
  let db: Db;
  let leads: typeof import("@/features/leads/service");
  let kpi: typeof import("@/features/leads/kpi");
  let view: typeof import("@/features/leads/team-view");
  let manager: CurrentUser;
  let teamlessManager: CurrentUser;
  let alice: CurrentUser; // membre de l'équipe
  let bruno: CurrentUser; // membre de l'équipe
  let banned: CurrentUser; // ancien membre, désactivé
  let outsider: CurrentUser; // commercial d'une autre équipe
  let direction: CurrentUser;

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

  function leadInput(): CreateLeadInput {
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
    };
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    leads = await import("@/features/leads/service");
    kpi = await import("@/features/leads/kpi");
    view = await import("@/features/leads/team-view");

    manager = await makeUser("manager", "Manager Vue");
    const team = await db.team.create({ data: { name: `Équipe vue ${uniq()}`, managerUserId: manager.id } });
    await db.user.update({ where: { id: manager.id }, data: { teamId: team.id } });
    manager = { ...manager, teamId: team.id };
    // Noms choisis pour vérifier l'ordre alphabétique (Bruno créé avant Alice).
    bruno = await makeUser("commercial", "Bruno Vue", team.id);
    alice = await makeUser("commercial", "Alice Vue", team.id);
    banned = await makeUser("commercial", "Désactivé Vue", team.id);
    await db.user.update({ where: { id: banned.id }, data: { banned: true } });

    const otherManager = await makeUser("manager", "Manager Autre Vue");
    const otherTeam = await db.team.create({ data: { name: `Autre équipe vue ${uniq()}`, managerUserId: otherManager.id } });
    await db.user.update({ where: { id: otherManager.id }, data: { teamId: otherTeam.id } });
    outsider = await makeUser("commercial", "Hors équipe Vue", otherTeam.id);

    teamlessManager = await makeUser("manager", "Manager sans équipe");
    direction = await makeUser("direction", "Direction Vue");
  });

  beforeEach(async () => {
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("liste les membres actifs de l'équipe du manager, par ordre alphabétique, sans lui ni l'autre équipe", async () => {
    const members = await view.listTeamMembers(manager);
    expect(members.map((member) => member.name)).toEqual(["Alice Vue", "Bruno Vue"]);
  });

  it("ne liste rien pour un autre rôle ou pour un manager sans équipe", async () => {
    expect(await view.listTeamMembers(alice)).toEqual([]);
    expect(await view.listTeamMembers(direction)).toEqual([]);
    expect(await view.listTeamMembers(teamlessManager)).toEqual([]);
  });

  it("donne à chaque membre ses propres indicateurs ; l'équipe, elle, voit la somme (sans l'autre équipe)", async () => {
    await leads.createLead(alice, leadInput());
    await leads.createLead(alice, leadInput());
    await leads.createLead(bruno, leadInput());
    await leads.createLead(outsider, leadInput());

    const forAlice = await view.getMemberView(manager, alice.id);
    const forBruno = await view.getMemberView(manager, bruno.id);
    expect(forAlice?.member).toEqual({ id: alice.id, name: "Alice Vue" });
    expect((await kpi.getDashboardKpis(forAlice!.scope)).newProspects.current).toBe(2);
    expect((await kpi.getDashboardKpis(forBruno!.scope)).newProspects.current).toBe(1);

    expect((await kpi.getDashboardKpis(manager)).newProspects.current).toBe(3);
  });

  it("refuse tout ce qui n'est pas un membre actif de l'équipe du manager", async () => {
    for (const memberId of [outsider.id, banned.id, manager.id, randomUUID()]) {
      expect(await view.getMemberView(manager, memberId), memberId).toBeNull();
    }
  });

  it("refuse à un autre rôle de se placer dans le tableau de bord d'un membre", async () => {
    expect(await view.getMemberView(direction, alice.id)).toBeNull();
    expect(await view.getMemberView(bruno, alice.id)).toBeNull();
    expect(await view.getMemberView(teamlessManager, alice.id)).toBeNull();
  });
});
