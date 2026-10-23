import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURE_SETTING_PREFIX } from "@/features/modules/config";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Interrupteur global des fonctionnalités sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
// Le journal d'audit est en ajout seul : on filtre sur l'identifiant de l'administrateur créé pour ces tests.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("fonctionnalités activables (PostgreSQL)", () => {
  let db: Db;
  let modules: typeof import("@/features/modules/service");
  let admin: CurrentUser;
  let manager: CurrentUser;
  let commercial: CurrentUser;

  const uniq = () => randomUUID().slice(0, 8);

  async function makeUser(role: Role, label: string): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: null, mustChangePassword: false };
  }

  const rows = () => db.setting.findMany({ where: { key: { startsWith: FEATURE_SETTING_PREFIX } } });
  const audits = () => db.auditLog.findMany({ where: { actorUserId: admin.id }, orderBy: { occurredAt: "asc" } });

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    modules = await import("@/features/modules/service");
    admin = await makeUser("admin", "Admin Fonctionnalités");
    manager = await makeUser("manager", "Manager Fonctionnalités");
    commercial = await makeUser("commercial", "Commercial Fonctionnalités");
  });

  beforeEach(async () => {
    await db.setting.deleteMany({ where: { key: { startsWith: FEATURE_SETTING_PREFIX } } });
  });

  afterAll(async () => {
    await db.setting.deleteMany({ where: { key: { startsWith: FEATURE_SETTING_PREFIX } } });
    await db?.$disconnect();
  });

  it("par défaut, toutes les fonctionnalités sont actives (aucune ligne n'est nécessaire)", async () => {
    expect(await modules.getDisabledFeatures()).toEqual([]);
    const states = await modules.listFeatureStates(admin);
    expect(states.map((state) => state.key)).toEqual([...FEATURE_KEYS]);
    expect(states.every((state) => state.enabled)).toBe(true);
    expect(await modules.isFeatureEnabled("taches")).toBe(true);
  });

  it("désactiver puis réactiver une fonctionnalité est persisté et s'applique à tous", async () => {
    expect(await modules.setFeatureEnabled(admin, { key: "taches", enabled: false })).toEqual({ key: "taches", enabled: false, changed: true });
    expect(await modules.getDisabledFeatures()).toEqual(["taches"]);
    expect(await modules.isFeatureEnabled("taches")).toBe(false);
    expect(await modules.isFeatureEnabled("comptes")).toBe(true);
    expect((await modules.listFeatureStates(admin)).find((state) => state.key === "taches")?.enabled).toBe(false);

    expect(await modules.setFeatureEnabled(admin, { key: "taches", enabled: true })).toEqual({ key: "taches", enabled: true, changed: true });
    expect(await modules.getDisabledFeatures()).toEqual([]);
  });

  it("une seule ligne par fonctionnalité : deux fonctionnalités désactivées ne s'écrasent pas", async () => {
    await modules.setFeatureEnabled(admin, { key: "taches", enabled: false });
    await modules.setFeatureEnabled(admin, { key: "previsions", enabled: false });
    await modules.setFeatureEnabled(admin, { key: "taches", enabled: true });

    const stored = await rows();
    expect(stored.map((row) => row.key).sort()).toEqual(["features.previsions", "features.taches"]);
    expect(await modules.getDisabledFeatures()).toEqual(["previsions"]);
    expect(stored.find((row) => row.key === "features.previsions")?.updatedBy).toBe(admin.id);
  });

  it("est idempotent : redemander l'état actuel n'écrit rien et ne remplit pas le journal d'audit", async () => {
    const before = (await audits()).length;
    expect(await modules.setFeatureEnabled(admin, { key: "contacts", enabled: true })).toMatchObject({ changed: false });
    expect(await rows()).toHaveLength(0);

    await modules.setFeatureEnabled(admin, { key: "contacts", enabled: false });
    expect(await modules.setFeatureEnabled(admin, { key: "contacts", enabled: false })).toMatchObject({ enabled: false, changed: false });
    expect((await audits()).length - before).toBe(1);
  });

  it("trace chaque changement réel dans le journal d'audit, sans donnée personnelle", async () => {
    const before = (await audits()).length;
    await modules.setFeatureEnabled(admin, { key: "messagerie", enabled: false });
    await modules.setFeatureEnabled(admin, { key: "messagerie", enabled: true });

    const entries = (await audits()).slice(before);
    expect(entries.map((entry) => entry.action)).toEqual(["feature.disabled", "feature.enabled"]);
    for (const entry of entries) {
      expect(entry.entityType).toBe("setting");
      expect(entry.metadata).toEqual({ feature: "messagerie" });
    }
  });

  it("est réservé à l'administrateur (lecture de l'écran comme modification)", async () => {
    for (const user of [manager, commercial]) {
      await expect(modules.setFeatureEnabled(user, { key: "taches", enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(modules.listFeatureStates(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await rows()).toHaveLength(0);
  });

  it("refuse une fonctionnalité inconnue, notamment le tableau de bord et l'administration", async () => {
    for (const key of ["dashboard", "admin", "fonctionnalites", "", null, 42]) {
      await expect(modules.setFeatureEnabled(admin, { key, enabled: false })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await rows()).toHaveLength(0);
  });

  it("tolère une valeur stockée illisible : la fonctionnalité reste active", async () => {
    await db.setting.create({ data: { key: "features.taches", value: "n'importe quoi", updatedBy: admin.id } });
    await db.setting.create({ data: { key: "features.inconnue", value: { enabled: false }, updatedBy: admin.id } });
    expect(await modules.getDisabledFeatures()).toEqual([]);
  });
});
