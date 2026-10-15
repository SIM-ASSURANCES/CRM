// Crée (ou réinitialise) des comptes d'essai dans la BASE DE TEST, avec des mots de passe générés au hasard.
// À lancer via : node scripts/e2e-env.mjs npx tsx --conditions=react-server scripts/e2e-user.ts
// Les identifiants sont écrits dans `.e2e-credentials` (ignoré par git) ; ils ne sont jamais affichés.
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { auth } from "../src/lib/auth/auth";
import { db } from "../src/lib/db";

const ACCOUNTS = [
  { key: "admin", email: "e2e-admin@test.local", name: "E2E Administrateur", role: "admin" },
  { key: "manager", email: "e2e-manager@test.local", name: "E2E Manager", role: "manager" },
  { key: "commercial", email: "e2e-commercial@test.local", name: "E2E Commercial", role: "commercial" },
] as const;

async function main() {
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error("Refus : la base visée ne ressemble pas à une base de test. Lancez ce script via scripts/e2e-env.mjs.");
  }

  const context = await auth.$context;
  const credentials: Record<string, { email: string; password: string }> = {};

  for (const account of ACCOUNTS) {
    const password = `${randomBytes(15).toString("base64url")}9aZ!`;
    const hash = await context.password.hash(password);
    const existing = await db.user.findUnique({ where: { email: account.email }, include: { accounts: true } });

    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { role: account.role, banned: false, mustChangePassword: false } });
      await db.account.updateMany({ where: { userId: existing.id, providerId: "credential" }, data: { password: hash } });
    } else {
      const id = randomUUID();
      await db.user.create({
        data: {
          id,
          name: account.name,
          email: account.email,
          emailVerified: true,
          role: account.role,
          mustChangePassword: false,
          accounts: { create: { accountId: id, providerId: "credential", password: hash } },
        },
      });
    }
    credentials[account.key] = { email: account.email, password };
  }

  writeFileSync(".e2e-credentials", JSON.stringify(credentials, null, 2), { encoding: "utf8" });
  console.log(`${ACCOUNTS.length} comptes d'essai prêts dans la base de test (identifiants dans .e2e-credentials).`);
}

main()
  .catch((error) => {
    console.error("Échec :", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
