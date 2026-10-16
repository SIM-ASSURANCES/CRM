// Environnement de RECETTE : une base PostgreSQL dédiée (`crm_recette`), distincte du développement (`crm`) et des tests
// (`crm_test`), avec un jeu de données fictives anonymisées (scripts/recette-seed.ts). Le serveur de recette écoute sur 3200.
//
//   node scripts/recette-env.mjs init                  crée la base si besoin, applique les migrations, charge le jeu de données
//   node scripts/recette-env.mjs reset                 supprime la base de recette puis refait `init` (repart de zéro)
//   node scripts/recette-env.mjs <commande> [args…]    lance une commande avec l'environnement de recette
//                                                      (ex. : node scripts/recette-env.mjs npx next start -p 3200)
//
// L'URL de la base est déduite de DATABASE_URL (.env) en ne changeant que le nom de la base ; elle n'est jamais affichée.
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const RECETTE_DB = "crm_recette";
const RECETTE_PORT = 3200;

process.loadEnvFile(".env");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est absente de .env : impossible de déduire la base de recette.");
  process.exit(1);
}

function urlFor(database) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

const recetteUrl = urlFor(RECETTE_DB);
const recetteEnv = { ...process.env, DATABASE_URL: recetteUrl, BETTER_AUTH_URL: `http://localhost:${RECETTE_PORT}` };

/** Exécute une commande dans l'environnement de recette ; arrête tout si elle échoue. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env: recetteEnv });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function withAdmin(callback) {
  // On se connecte à la base de maintenance « postgres » : on ne peut pas créer une base depuis elle-même.
  const client = new pg.Client({ connectionString: urlFor("postgres") });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function ensureDatabase() {
  await withAdmin(async (client) => {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [RECETTE_DB]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE ${RECETTE_DB}`);
      console.log(`Base ${RECETTE_DB} créée.`);
    } else {
      console.log(`Base ${RECETTE_DB} déjà présente.`);
    }
  });
}

async function dropDatabase() {
  // Garde-fou : seule la base de recette peut être supprimée par ce script.
  await withAdmin(async (client) => {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [RECETTE_DB]);
    await client.query(`DROP DATABASE IF EXISTS ${RECETTE_DB}`);
    console.log(`Base ${RECETTE_DB} supprimée.`);
  });
}

function seed() {
  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["tsx", "--conditions=react-server", "scripts/recette-seed.ts"]);
}

const [command, ...args] = process.argv.slice(2);

if (command === "init") {
  await ensureDatabase();
  seed();
} else if (command === "reset") {
  await dropDatabase();
  await ensureDatabase();
  seed();
} else if (command) {
  const child = spawn(command, args, { stdio: "inherit", shell: true, env: recetteEnv });
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  console.error("Usage : node scripts/recette-env.mjs init | reset | <commande> [arguments]");
  process.exit(1);
}
