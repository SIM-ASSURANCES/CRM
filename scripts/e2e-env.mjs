// Lance une commande avec l'environnement « essai de bout en bout » : la base est la BASE DE TEST, jamais celle de
// développement, et l'application se présente sur le port 3101.
//
//   node scripts/e2e-env.mjs npx tsx --conditions=react-server prisma/seed.ts      (données de démonstration)
//   node scripts/e2e-env.mjs npx tsx --conditions=react-server scripts/e2e-user.ts  (comptes d'essai)
//   node scripts/e2e-env.mjs npx next dev -p 3101                                    (serveur d'essai)
import { spawn } from "node:child_process";

process.loadEnvFile(".env");

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("TEST_DATABASE_URL est absente de .env : impossible de lancer l'environnement d'essai.");
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage : node scripts/e2e-env.mjs <commande> [arguments]");
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: testUrl,
    BETTER_AUTH_URL: "http://localhost:3101",
    NODE_ENV: "development",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
