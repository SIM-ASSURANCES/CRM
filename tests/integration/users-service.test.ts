import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests de l'administration des utilisateurs sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
// Les connexions sont de vraies connexions Better Auth : on vérifie que le mot de passe temporaire fonctionne,
// que l'ancien cesse de fonctionner et qu'un compte désactivé est refusé.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];
type Users = typeof import("@/features/users/service");
type Teams = typeof import("@/features/users/teams");

describe.skipIf(!hasDb)("administration des utilisateurs (PostgreSQL)", () => {
  let db: Db;
  let users: Users;
  let teams: Teams;
  let signIn: (email: string, password: string) => Promise<"ok" | "banned" | "invalid">;
  let admin1: CurrentUser;
  let admin2: CurrentUser;
  let commercial: CurrentUser;

  const uniq = () => randomUUID().slice(0, 8);

  async function makeUser(role: Role, label: string): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: null, mustChangePassword: false };
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    users = await import("@/features/users/service");
    teams = await import("@/features/users/teams");
    const { auth } = await import("@/lib/auth/auth");
    const { APIError } = await import("better-auth/api");

    signIn = async (email, password) => {
      try {
        await auth.api.signInEmail({ body: { email, password } });
        return "ok";
      } catch (error) {
        return error instanceof APIError && error.body?.code === "BANNED_USER" ? "banned" : "invalid";
      }
    };

    // Base de test partagée entre exécutions : on repart d'une situation sans administrateur résiduel.
    await db.user.updateMany({ where: { role: "admin" }, data: { role: "commercial" } });
    admin1 = await makeUser("admin", "Admin Un");
    admin2 = await makeUser("admin", "Admin Deux");
    commercial = await makeUser("commercial", "Commercial Simple");
  });

  beforeEach(async () => {
    await db.user.updateMany({ where: { id: { in: [admin1.id, admin2.id] } }, data: { role: "admin", banned: false } });
    await db.passwordResetRequest.deleteMany();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function newAccount(role: Role = "commercial", name = `Compte ${uniq()}`) {
    const credential = await users.createUser(admin1, { name, email: `${uniq()}@test.local`, role });
    return credential;
  }

  describe("création de compte", () => {
    it("crée un compte avec un mot de passe temporaire qui permet de se connecter, sans le stocker en clair", async () => {
      const credential = await newAccount("manager");
      expect(credential.temporaryPassword).toHaveLength(16);

      const user = await db.user.findUniqueOrThrow({ where: { id: credential.id }, include: { accounts: true } });
      expect(user).toMatchObject({ role: "manager", mustChangePassword: true, emailVerified: true });
      expect(user.accounts[0].password).not.toContain(credential.temporaryPassword);

      expect(await signIn(credential.email, credential.temporaryPassword)).toBe("ok");
      expect(await signIn(credential.email, "Mauvais-mot-de-passe-1")).toBe("invalid");

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: credential.id, action: "user.created" } });
      expect(trace.actorUserId).toBe(admin1.id);
      expect(JSON.stringify(trace.metadata)).not.toContain(credential.temporaryPassword);
    });

    it("refuse une adresse e-mail déjà utilisée", async () => {
      const first = await newAccount();
      await expect(users.createUser(admin1, { name: "Autre Nom", email: first.email, role: "audit" })).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { email: expect.any(Array) } },
      });
    });

    it("refuse une équipe inexistante", async () => {
      await expect(
        users.createUser(admin1, { name: "Équipe Fantôme", email: `${uniq()}@test.local`, role: "commercial", teamId: randomUUID() }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("permissions (REC-09)", () => {
    it("refuse toute opération d'administration à un non-administrateur", async () => {
      const target = await newAccount();
      const attempts = [
        users.listUsers(commercial),
        users.getUser(commercial, target.id),
        users.createUser(commercial, { name: "Intrus Total", email: `${uniq()}@test.local`, role: "admin" }),
        users.updateUser(commercial, { id: target.id, name: "Piraté", role: "admin" }),
        users.setUserActive(commercial, target.id, false),
        users.resetPassword(commercial, target.id),
        users.listPendingResetRequests(commercial),
        teams.listTeams(commercial),
        teams.createTeam(commercial, { name: `Équipe ${uniq()}` }),
      ];
      for (const attempt of attempts) {
        await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      // Rien n'a été modifié.
      expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ name: expect.not.stringContaining("Piraté"), role: "commercial" });
    });
  });

  describe("modification", () => {
    it("change le rôle et l'équipe, révoque les sessions et n'audite que des noms de champs", async () => {
      const team = await teams.createTeam(admin1, { name: `Équipe ${uniq()}` });
      const account = await newAccount("commercial");
      await db.session.create({
        data: { userId: account.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
      });

      await users.updateUser(admin1, { id: account.id, name: account.name, role: "manager", teamId: team });

      const user = await db.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(user).toMatchObject({ role: "manager", teamId: team });
      expect(await db.session.count({ where: { userId: account.id } })).toBe(0);

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: account.id, action: "user.updated" } });
      expect(trace.metadata).toMatchObject({ changedFields: ["role", "teamId"], fromRole: "commercial", toRole: "manager" });
    });

    it("interdit à un administrateur de modifier son propre rôle", async () => {
      await expect(users.updateUser(admin1, { id: admin1.id, name: admin1.name, role: "commercial" })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: admin1.id } })).role).toBe("admin");
    });

    it("protège le dernier administrateur actif", async () => {
      // admin1 est désactivé : admin2 devient le seul administrateur actif.
      await db.user.update({ where: { id: admin1.id }, data: { banned: true } });
      await expect(users.updateUser(admin1, { id: admin2.id, name: admin2.name, role: "commercial" })).rejects.toMatchObject({
        code: "VALIDATION",
        message: expect.stringContaining("au moins un administrateur actif"),
      });
      await expect(users.setUserActive(admin1, admin2.id, false)).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await db.user.findUniqueOrThrow({ where: { id: admin2.id } })).role).toBe("admin");
    });
  });

  describe("désactivation immédiate", () => {
    it("ferme les sessions, refuse la connexion, puis la rétablit à la réactivation", async () => {
      const account = await newAccount();
      expect(await signIn(account.email, account.temporaryPassword)).toBe("ok");
      expect(await db.session.count({ where: { userId: account.id } })).toBeGreaterThan(0);

      await users.setUserActive(admin1, account.id, false);
      expect(await db.session.count({ where: { userId: account.id } })).toBe(0);
      expect(await signIn(account.email, account.temporaryPassword)).toBe("banned");

      await users.setUserActive(admin1, account.id, true);
      expect(await signIn(account.email, account.temporaryPassword)).toBe("ok");

      const actions = (await db.auditLog.findMany({ where: { entityId: account.id }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["user.deactivated", "user.reactivated"]));
    });

    it("interdit de désactiver son propre compte", async () => {
      await expect(users.setUserActive(admin1, admin1.id, false)).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("réinitialisation du mot de passe par l'administrateur", () => {
    it("remplace le mot de passe, force son changement, ferme les sessions et clôt les demandes", async () => {
      const account = await newAccount();
      await signIn(account.email, account.temporaryPassword);
      await db.user.update({ where: { id: account.id }, data: { mustChangePassword: false } });
      await db.passwordResetRequest.create({ data: { email: account.email } });

      const reset = await users.resetPassword(admin1, account.id);

      expect(reset.temporaryPassword).not.toBe(account.temporaryPassword);
      expect(await signIn(account.email, reset.temporaryPassword)).toBe("ok");
      expect(await signIn(account.email, account.temporaryPassword)).toBe("invalid");

      const user = await db.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(user.mustChangePassword).toBe(true);

      const request = await db.passwordResetRequest.findFirstOrThrow({ where: { email: account.email } });
      expect(request).toMatchObject({ status: "done", handledById: admin1.id });

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: account.id, action: "user.password_reset" } });
      expect(trace.actorUserId).toBe(admin1.id);
      expect(JSON.stringify(trace)).not.toContain(reset.temporaryPassword);
    });

    it("ferme les sessions existantes de l'utilisateur", async () => {
      const account = await newAccount();
      await db.session.create({ data: { userId: account.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) } });
      await users.resetPassword(admin1, account.id);
      expect(await db.session.count({ where: { userId: account.id } })).toBe(0);
    });

    it("refuse de réinitialiser son propre compte, un compte désactivé ou un compte inconnu", async () => {
      await expect(users.resetPassword(admin1, admin1.id)).rejects.toMatchObject({ code: "VALIDATION" });

      const account = await newAccount();
      await users.setUserActive(admin1, account.id, false);
      await expect(users.resetPassword(admin1, account.id)).rejects.toMatchObject({ code: "VALIDATION" });

      await expect(users.resetPassword(admin1, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("demandes de réinitialisation", () => {
    it("liste les demandes en attente avec le compte correspondant, et permet de les ignorer", async () => {
      const account = await newAccount();
      await db.passwordResetRequest.create({ data: { email: account.email } });
      await db.passwordResetRequest.create({ data: { email: `inconnu-${uniq()}@test.local` } });

      expect(await users.countPendingResetRequests()).toBe(2);
      const pending = await users.listPendingResetRequests(admin1);
      expect(pending.find((r) => r.email === account.email)).toMatchObject({ userId: account.id, userName: account.name });
      expect(pending.find((r) => r.userId === null)).toBeDefined();

      await users.dismissResetRequest(admin1, pending[0].id);
      expect(await users.countPendingResetRequests()).toBe(1);
      await expect(users.dismissResetRequest(admin1, pending[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("liste et recherche", () => {
    it("filtre par texte et par statut", async () => {
      const marker = uniq();
      const active = await users.createUser(admin1, { name: `Zoé ${marker}`, email: `zoe-${marker}@test.local`, role: "audit" });
      const disabled = await users.createUser(admin1, { name: `Yann ${marker}`, email: `yann-${marker}@test.local`, role: "audit" });
      await users.setUserActive(admin1, disabled.id, false);

      const all = await users.listUsers(admin1, { q: marker });
      expect(all.total).toBe(2);
      expect((await users.listUsers(admin1, { q: marker, status: "active" })).rows.map((u) => u.id)).toEqual([active.id]);
      expect((await users.listUsers(admin1, { q: marker, status: "disabled" })).rows.map((u) => u.id)).toEqual([disabled.id]);
    });
  });

  describe("équipes", () => {
    it("exige un responsable actif au rôle manager et refuse un nom déjà pris", async () => {
      const notManager = await makeUser("commercial", "Pas Manager");
      await expect(teams.createTeam(admin1, { name: `Équipe ${uniq()}`, managerUserId: notManager.id })).rejects.toMatchObject({
        code: "VALIDATION",
      });

      const manager = await makeUser("manager", "Vrai Manager");
      const name = `Équipe ${uniq()}`;
      const id = await teams.createTeam(admin1, { name, managerUserId: manager.id });
      expect(await teams.getTeam(admin1, id)).toMatchObject({ name, managerName: "Vrai Manager", memberCount: 0 });

      await expect(teams.createTeam(admin1, { name })).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("refuse de supprimer une équipe qui a des membres, puis la supprime une fois vide", async () => {
      const team = await teams.createTeam(admin1, { name: `Équipe ${uniq()}` });
      const member = await newAccount();
      await users.updateUser(admin1, { id: member.id, name: member.name, role: "commercial", teamId: team });

      await expect(teams.deleteTeam(admin1, team)).rejects.toMatchObject({ code: "VALIDATION" });

      await users.updateUser(admin1, { id: member.id, name: member.name, role: "commercial" });
      await teams.deleteTeam(admin1, team);
      await expect(teams.getTeam(admin1, team)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
