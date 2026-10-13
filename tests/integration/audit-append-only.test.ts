import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Ce test écrit dans le journal d'audit, qui est en ajout seul : il ne peut pas être nettoyé.
// Il s'exécute donc uniquement sur une base dédiée (TEST_DATABASE_URL), jamais sur la base de développement.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("journal d'audit en ajout seul (PostgreSQL)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function insertRow() {
    return db.auditLog.create({ data: { action: "test.insert", entityType: "test" } });
  }

  it("accepte l'ajout d'une trace", async () => {
    const row = await insertRow();
    expect(row.id).toBeTruthy();
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it("refuse la modification d'une trace", async () => {
    const row = await insertRow();
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "falsifie" } })).rejects.toThrow();
    const after = await db.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.action).toBe("test.insert");
  });

  it("refuse la suppression d'une trace", async () => {
    const row = await insertRow();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { id: row.id } })).toBe(1);
  });

  it("refuse le vidage de la table", async () => {
    await insertRow();
    await expect(db.$executeRawUnsafe("TRUNCATE TABLE audit_logs")).rejects.toThrow();
    expect(await db.auditLog.count()).toBeGreaterThan(0);
  });
});
