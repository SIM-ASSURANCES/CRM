import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests de la consultation et de l'export du journal d'audit sur la base dédiée (TEST_DATABASE_URL).
// Le journal est en ajout seul : les lignes ne peuvent pas être effacées entre deux tests. Chaque test isole donc les
// siennes avec une action et un type d'objet uniques (lettres seulement, comme l'exigent les filtres).
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("journal d'audit (PostgreSQL)", () => {
  let db: Db;
  let svc: typeof import("@/features/audit/service");
  let admin: CurrentUser;
  let auditor: CurrentUser;
  let direction: CurrentUser;
  let manager: CurrentUser;
  let commercial: CurrentUser;
  let formulaUser: CurrentUser;

  // Type d'objet unique, en lettres minuscules : « tabcdef »…
  const unique = () => `t${randomUUID().replace(/[^a-f]/g, "").slice(0, 8) || "abcdef"}`;

  async function makeUser(role: Role, label: string): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}@test.local`, role, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: null, mustChangePassword: false };
  }

  /** Crée des lignes d'audit horodatées, avec un type d'objet propre au test. */
  async function seed(entityType: string, entries: { action: string; actor?: CurrentUser | null; at: Date; metadata?: object }[]) {
    for (const entry of entries) {
      await db.auditLog.create({
        data: {
          actorUserId: entry.actor === undefined ? admin.id : (entry.actor?.id ?? null),
          action: entry.action,
          entityType,
          occurredAt: entry.at,
          metadata: entry.metadata,
          ipAddress: "10.0.0.1",
        },
      });
    }
  }

  const day = (d: number, h = 12) => new Date(Date.UTC(2020, 5, d, h));

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    svc = await import("@/features/audit/service");
    admin = await makeUser("admin", "Admin Audit");
    auditor = await makeUser("audit", "Auditeur");
    direction = await makeUser("direction", "Direction Audit");
    manager = await makeUser("manager", "Manager Audit");
    commercial = await makeUser("commercial", "Commercial Audit");
    formulaUser = await makeUser("commercial", "=HACK Auditeur");
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("droits", () => {
    it("autorise la lecture à l'administrateur et à l'audit, et la refuse aux autres profils", async () => {
      await expect(svc.listAuditLogs(admin)).resolves.toHaveProperty("rows");
      await expect(svc.listAuditLogs(auditor)).resolves.toHaveProperty("rows");
      for (const user of [direction, manager, commercial]) {
        await expect(svc.listAuditLogs(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(svc.auditFacets(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it("autorise l'export à l'administrateur et à l'audit, et le refuse aux autres profils", async () => {
      const kind = unique();
      await seed(kind, [{ action: `${kind}.created`, at: day(1) }]);
      await expect(svc.exportAuditLogs(admin, { entityType: kind })).resolves.toMatchObject({ rows: 1 });
      await expect(svc.exportAuditLogs(auditor, { entityType: kind })).resolves.toMatchObject({ rows: 1 });
      for (const user of [direction, manager, commercial]) {
        await expect(svc.exportAuditLogs(user, { entityType: kind })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });
  });

  describe("consultation et filtres", () => {
    it("liste du plus récent au plus ancien, avec l'auteur, ou « Système » pour une action automatique", async () => {
      const kind = unique();
      await seed(kind, [
        { action: `${kind}.first`, at: day(1) },
        { action: `${kind}.second`, at: day(3), actor: null },
        { action: `${kind}.third`, at: day(2), actor: auditor, metadata: { changedFields: ["status"] } },
      ]);

      const { rows, total } = await svc.listAuditLogs(admin, { entityType: kind });
      expect(total).toBe(3);
      expect(rows.map((r) => r.action)).toEqual([`${kind}.second`, `${kind}.third`, `${kind}.first`]);
      expect(rows.map((r) => r.actorName)).toEqual(["Système", "Auditeur", "Admin Audit"]);
      expect(rows[1].metadata).toEqual({ changedFields: ["status"] });
      expect(rows[0].actorEmail).toBeNull();
    });

    it("filtre par action exacte ou par famille d'actions", async () => {
      const kind = unique();
      await seed(kind, [
        { action: `${kind}.created`, at: day(1) },
        { action: `${kind}.updated`, at: day(2) },
        { action: `autre.created`, at: day(3) },
      ]);

      expect((await svc.listAuditLogs(admin, { entityType: kind, action: `${kind}.created` })).total).toBe(1);
      expect((await svc.listAuditLogs(admin, { entityType: kind, action: `${kind}.*` })).total).toBe(2);
      expect((await svc.listAuditLogs(admin, { entityType: kind, action: "autre.*" })).total).toBe(1);
    });

    it("filtre par auteur et par actions du système", async () => {
      const kind = unique();
      await seed(kind, [
        { action: `${kind}.a`, at: day(1), actor: admin },
        { action: `${kind}.b`, at: day(2), actor: auditor },
        { action: `${kind}.c`, at: day(3), actor: null },
      ]);

      expect((await svc.listAuditLogs(admin, { entityType: kind, actorId: auditor.id })).rows.map((r) => r.action)).toEqual([`${kind}.b`]);
      expect((await svc.listAuditLogs(admin, { entityType: kind, actorId: "system" })).rows.map((r) => r.action)).toEqual([`${kind}.c`]);
    });

    it("filtre par période, la date de fin incluant toute la journée", async () => {
      const kind = unique();
      await seed(kind, [
        { action: `${kind}.a`, at: day(10, 0) },
        { action: `${kind}.b`, at: day(10, 23) },
        { action: `${kind}.c`, at: day(11, 0) },
        { action: `${kind}.d`, at: day(9, 23) },
      ]);

      const parsed = svc.auditFiltersSchema.parse({ entityType: kind, from: "2020-06-10", to: "2020-06-10" });
      const { rows } = await svc.listAuditLogs(admin, parsed);
      expect(rows.map((r) => r.action).sort()).toEqual([`${kind}.a`, `${kind}.b`]);
    });

    it("pagine", async () => {
      const kind = unique();
      await seed(kind, Array.from({ length: 5 }, (_, i) => ({ action: `${kind}.n`, at: day(1 + i) })));

      const first = await svc.listAuditLogs(admin, { entityType: kind }, { pageSize: 2, page: 1 });
      const last = await svc.listAuditLogs(admin, { entityType: kind }, { pageSize: 2, page: 3 });
      expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(first.rows).toHaveLength(2);
      expect(last.rows).toHaveLength(1);
    });

    it("propose les actions, objets et auteurs existants pour les filtres", async () => {
      const kind = unique();
      await seed(kind, [{ action: `${kind}.created`, at: day(1), actor: auditor }]);

      const facets = await svc.auditFacets(admin);
      expect(facets.actions).toContain(`${kind}.created`);
      expect(facets.entityTypes).toContain(kind);
      expect(facets.actors.map((a) => a.id)).toContain(auditor.id);
    });
  });

  describe("validation des filtres", () => {
    it("accepte les actions, familles et objets bien formés et refuse le reste", () => {
      const ok = (input: object) => svc.auditFiltersSchema.safeParse(input).success;
      expect(ok({ action: "account.merged" })).toBe(true);
      expect(ok({ action: "auth.*" })).toBe(true);
      expect(ok({ action: "x'; DROP TABLE users;--" })).toBe(false);
      expect(ok({ action: "a.b.c" })).toBe(false);
      expect(ok({ entityType: "account" })).toBe(true);
      expect(ok({ entityType: "Account;" })).toBe(false);
      expect(ok({ actorId: "system" })).toBe(true);
      expect(ok({ actorId: "pas-un-uuid" })).toBe(false);
      expect(ok({ from: "2020-13-45" })).toBe(false);
    });

    it("traite les valeurs vides comme absentes", () => {
      expect(svc.auditFiltersSchema.parse({ action: "", entityType: "", actorId: "", from: "", to: "" })).toEqual({});
    });
  });

  describe("export (CDC 8.3)", () => {
    it("exporte le journal filtré en CSV avec les métadonnées, du plus récent au plus ancien", async () => {
      const kind = unique();
      await seed(kind, [
        { action: `${kind}.old`, at: day(1), metadata: { n: 1 } },
        { action: `${kind}.new`, at: day(2), actor: auditor },
      ]);

      const result = await svc.exportAuditLogs(admin, { entityType: kind }, { now: new Date(Date.UTC(2026, 9, 14)) });
      expect(result).toMatchObject({ rows: 2, truncated: false, filename: "journal-audit-2026-10-14.csv" });

      const lines = result.csv.replace(/^﻿/, "").trim().split("\r\n");
      expect(lines[0]).toBe("Date (UTC);Auteur;E-mail de l'auteur;Action;Objet;Identifiant de l'objet;Adresse IP;Métadonnées;Identifiant de requête");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain(`${kind}.new`);
      expect(lines[1]).toContain("Auditeur");
      expect(lines[2]).toContain(`"{""n"":1}"`);
    });

    it("journalise l'export avec ses filtres, sans recopier le contenu exporté", async () => {
      const kind = unique();
      await seed(kind, [{ action: `${kind}.created`, at: day(1) }]);

      await svc.exportAuditLogs(auditor, { entityType: kind, from: new Date(Date.UTC(2020, 5, 1)) });
      const entry = await db.auditLog.findFirstOrThrow({
        where: { action: "audit.exported", actorUserId: auditor.id },
        orderBy: { occurredAt: "desc" },
      });
      expect(entry.metadata).toMatchObject({ rows: 1, truncated: false, filters: { entityType: kind, from: "2020-06-01", to: null } });
    });

    it("plafonne le volume exporté et le signale", async () => {
      const kind = unique();
      await seed(kind, Array.from({ length: 4 }, (_, i) => ({ action: `${kind}.n`, at: day(1 + i) })));

      const result = await svc.exportAuditLogs(admin, { entityType: kind }, { limit: 3 });
      expect(result).toMatchObject({ rows: 3, truncated: true });
      expect(result.filename).toContain("-tronque");
      expect(result.csv.trim().split("\r\n")).toHaveLength(4);
      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "audit.exported" }, orderBy: { occurredAt: "desc" } });
      expect(entry.metadata).toMatchObject({ rows: 3, truncated: true });
    });

    it("ne permet pas de relever le plafond au-delà du maximum", async () => {
      const kind = unique();
      await seed(kind, [{ action: `${kind}.a`, at: day(1) }]);
      await expect(svc.exportAuditLogs(admin, { entityType: kind }, { limit: 1_000_000 })).resolves.toMatchObject({ rows: 1 });
      expect(svc.EXPORT_LIMIT).toBe(5000);
    });

    it("neutralise les formules dans les noms d'auteur exportés", async () => {
      const kind = unique();
      await seed(kind, [{ action: `${kind}.created`, at: day(1), actor: formulaUser }]);

      const { csv } = await svc.exportAuditLogs(admin, { entityType: kind });
      expect(csv).toContain("'=HACK Auditeur");
      expect(csv).not.toContain(";=HACK");
    });
  });

  describe("intégrité du journal", () => {
    it("refuse toute modification et toute suppression (ajout seul)", async () => {
      const kind = unique();
      await seed(kind, [{ action: `${kind}.created`, at: day(1) }]);
      const entry = await db.auditLog.findFirstOrThrow({ where: { entityType: kind } });

      await expect(db.auditLog.update({ where: { id: entry.id }, data: { action: "falsifie.action" } })).rejects.toThrow();
      await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
      expect((await db.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe(`${kind}.created`);
    });
  });
});
