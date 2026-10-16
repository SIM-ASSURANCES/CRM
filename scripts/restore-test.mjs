// Test de RESTAURATION de sauvegarde (REC-12 : « données restaurées selon l'objectif RPO/RTO validé »).
//
//   node scripts/restore-test.mjs [--source crm_recette] [--keep]
//
// 1. Sauvegarde la base source avec pg_dump (format « custom », compressé), comme le ferait la sauvegarde quotidienne.
// 2. Restaure cette sauvegarde dans une base TEMPORAIRE (`crm_restore_check`), avec pg_restore.
// 3. Contrôle l'intégrité : mêmes tables, mêmes nombres de lignes, mêmes empreintes d'identifiants, contraintes valides,
//    même nombre de migrations, journal d'audit toujours en ajout seul.
// 4. Chronomètre le tout et le compare au RTO (4 h) ; rappelle le RPO (24 h : une sauvegarde par jour).
// 5. Supprime la base temporaire et le fichier de sauvegarde (sauf --keep) et écrit un rapport daté dans docs/recette/.
//
// La base source n'est jamais modifiée (lecture seule). Aucun mot de passe ni URL n'est affiché ni écrit dans le rapport.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const RESTORE_DB = "crm_restore_check";
const RTO_MS = 4 * 60 * 60 * 1000; // objectif validé : reprise en moins de 4 h
const RPO_HOURS = 24; // objectif validé : sauvegarde quotidienne, soit au plus 24 h de données perdues

process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est absente de .env.");
  process.exit(1);
}

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const sourceIndex = args.indexOf("--source");
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : "crm_recette";
if (!/^[a-z0-9_]+$/.test(source) || source === RESTORE_DB) {
  console.error("Nom de base source invalide.");
  process.exit(1);
}

function urlFor(database) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  return url;
}

/** Retrouve pg_dump / pg_restore : variable PG_BIN, sinon l'installation PostgreSQL de Windows, sinon le PATH. */
function pgTool(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(join(process.env.PG_BIN, exe));
  if (process.platform === "win32") for (const v of [18, 17, 16, 15]) candidates.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin\\${exe}`);
  return candidates.find((c) => existsSync(c)) ?? name;
}

function connectionArgs(database) {
  const url = urlFor(database);
  return { args: ["-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username)], env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } };
}

function tool(name, extra, database) {
  const { args: base, env } = connectionArgs(database);
  const result = spawnSync(pgTool(name), [...base, ...extra], { env, encoding: "utf8" });
  if (result.error) throw new Error(`${name} introuvable ou non exécutable (définissez PG_BIN) : ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} a échoué : ${(result.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);
  return result;
}

const admin = new pg.Client({ connectionString: urlFor("postgres").toString() });
const timings = {};
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });

async function snapshot(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
  const result = {};
  for (const table of tables) {
    const count = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
    const hasId = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'", [table])).rowCount > 0;
    const fingerprint = hasId && count > 0 ? (await client.query(`SELECT md5(string_agg(id::text, ',' ORDER BY id::text)) AS h FROM "${table}"`)).rows[0].h : null;
    result[table] = { count, fingerprint };
  }
  const constraints = await client.query(
    "SELECT contype, count(*)::int AS n, count(*) FILTER (WHERE NOT convalidated)::int AS invalid FROM pg_constraint WHERE connamespace = 'public'::regnamespace GROUP BY contype ORDER BY contype",
  );
  const triggers = Number((await client.query("SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal")).rows[0].n);
  return { tables: result, constraints: constraints.rows, triggers };
}

const dumpFile = join(tmpdir(), `crm-restore-test-${Date.now()}.dump`);
let failure = null;
let sourceSnap = null;
let restoredSnap = null;
let dumpBytes = 0;
let databaseBytes = 0;

const startedAt = new Date();
try {
  await admin.connect();

  // 1. Sauvegarde ---------------------------------------------------------------------------------------------------
  const sourceClient = new pg.Client({ connectionString: urlFor(source).toString() });
  await sourceClient.connect();
  databaseBytes = Number((await sourceClient.query("SELECT pg_database_size(current_database()) AS s")).rows[0].s);
  sourceSnap = await snapshot(sourceClient);
  await sourceClient.end();

  let t = Date.now();
  tool("pg_dump", ["-Fc", "--no-owner", "-f", dumpFile, source], source);
  timings.sauvegarde = Date.now() - t;
  dumpBytes = statSync(dumpFile).size;

  // 2. Restauration dans une base temporaire -------------------------------------------------------------------------
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [RESTORE_DB]);
  await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
  await admin.query(`CREATE DATABASE ${RESTORE_DB}`);
  t = Date.now();
  tool("pg_restore", ["--no-owner", "--exit-on-error", "-d", RESTORE_DB, dumpFile], RESTORE_DB);
  timings.restauration = Date.now() - t;

  // 3. Contrôles d'intégrité -----------------------------------------------------------------------------------------
  t = Date.now();
  const restoredClient = new pg.Client({ connectionString: urlFor(RESTORE_DB).toString() });
  await restoredClient.connect();
  restoredSnap = await snapshot(restoredClient);

  const sourceTables = Object.keys(sourceSnap.tables);
  const restoredTables = Object.keys(restoredSnap.tables);
  check("Mêmes tables", JSON.stringify(sourceTables) === JSON.stringify(restoredTables), `${sourceTables.length} table(s) à la source, ${restoredTables.length} restaurée(s)`);

  const mismatches = sourceTables.filter((table) => restoredSnap.tables[table]?.count !== sourceSnap.tables[table].count);
  const totalRows = sourceTables.reduce((sum, table) => sum + sourceSnap.tables[table].count, 0);
  check("Mêmes nombres de lignes, table par table", mismatches.length === 0, mismatches.length === 0 ? `${totalRows} ligne(s) au total` : `écarts : ${mismatches.join(", ")}`);

  const fingerprintMismatches = sourceTables.filter((table) => restoredSnap.tables[table]?.fingerprint !== sourceSnap.tables[table].fingerprint);
  check("Mêmes empreintes d'identifiants (aucune ligne remplacée)", fingerprintMismatches.length === 0, fingerprintMismatches.length === 0 ? "toutes les tables concordent" : `écarts : ${fingerprintMismatches.join(", ")}`);

  const invalid = restoredSnap.constraints.reduce((sum, c) => sum + c.invalid, 0);
  check("Contraintes identiques et toutes valides", JSON.stringify(restoredSnap.constraints) === JSON.stringify(sourceSnap.constraints) && invalid === 0, restoredSnap.constraints.map((c) => `${c.contype}:${c.n}`).join(" "));

  check("Déclencheurs identiques", restoredSnap.triggers === sourceSnap.triggers, `${restoredSnap.triggers} déclencheur(s)`);

  const migrations = Number((await restoredClient.query("SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0].n);
  check("Migrations toutes appliquées après restauration", migrations === sourceSnap.tables._prisma_migrations?.count && migrations > 0, `${migrations} migration(s)`);

  // Le journal d'audit doit rester en ajout seul après restauration : la modification d'une ligne doit être refusée.
  let appendOnly = false;
  if (restoredSnap.tables.audit_logs?.count > 0) {
    await restoredClient.query("BEGIN");
    try {
      await restoredClient.query("UPDATE audit_logs SET action = action WHERE id = (SELECT id FROM audit_logs LIMIT 1)");
    } catch {
      appendOnly = true;
    }
    await restoredClient.query("ROLLBACK");
  }
  check("Journal d'audit toujours en ajout seul", appendOnly, appendOnly ? "modification refusée par la base" : "la modification a été acceptée");

  // Un compte de connexion doit rester complet : un utilisateur sans compte d'identification ne pourrait plus se connecter.
  const orphanUsers = Number((await restoredClient.query("SELECT count(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential')")).rows[0].n);
  check("Chaque utilisateur conserve son identifiant de connexion", orphanUsers === 0, orphanUsers === 0 ? "aucun utilisateur orphelin" : `${orphanUsers} sans identifiant`);
  await restoredClient.end();
  timings.controles = Date.now() - t;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (!keep) {
    try {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [RESTORE_DB]);
      await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
    } catch {
      /* la base temporaire sera recréée au prochain essai */
    }
    rmSync(dumpFile, { force: true });
  }
  await admin.end().catch(() => {});
}

// 4. Verdict et rapport ----------------------------------------------------------------------------------------------
const durationMs = (timings.sauvegarde ?? 0) + (timings.restauration ?? 0) + (timings.controles ?? 0);
const restoreMs = (timings.restauration ?? 0) + (timings.controles ?? 0);
const rtoOk = restoreMs <= RTO_MS;
const allOk = !failure && checks.length > 0 && checks.every((c) => c.ok) && rtoOk;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} Mo`;
// Projection prudente : on suppose un temps de restauration proportionnel au volume (en pratique la restauration des index domine).
const projected = databaseBytes > 0 && timings.restauration ? (timings.restauration * (10 * 1024 * 1048576)) / databaseBytes : null;

const lines = [
  `# Test de restauration — ${startedAt.toISOString().slice(0, 10)}`,
  "",
  `Scénario **REC-12** : restaurer une sauvegarde en recette. Résultat : **${allOk ? "CONFORME" : "NON CONFORME"}**.`,
  "",
  "## Objectifs validés",
  "",
  `- **RPO ${RPO_HOURS} h** : une sauvegarde complète par jour ; en cas de sinistre, au plus ${RPO_HOURS} h de saisies sont perdues.`,
  `- **RTO ${RTO_MS / 3_600_000} h** : service rétabli en moins de ${RTO_MS / 3_600_000} h après décision de restaurer.`,
  "",
  "## Mesures",
  "",
  "| Étape | Durée |",
  "|---|---|",
  `| Sauvegarde (pg_dump, format custom) | ${seconds(timings.sauvegarde ?? 0)} |`,
  `| Restauration (pg_restore) | ${seconds(timings.restauration ?? 0)} |`,
  `| Contrôles d'intégrité | ${seconds(timings.controles ?? 0)} |`,
  `| **Restauration + contrôles (à comparer au RTO)** | **${seconds(restoreMs)}** sur ${RTO_MS / 3_600_000} h autorisées — ${rtoOk ? "conforme" : "NON conforme"} |`,
  "",
  `Base source : \`${source}\`, ${megabytes(databaseBytes)} ; sauvegarde : ${megabytes(dumpBytes)}.`,
  projected ? `Projection indicative pour une base de 10 Go : environ ${Math.round(projected / 60000)} min de restauration (à confirmer sur l'hébergement de production).` : "",
  "",
  "## Contrôles",
  "",
  "| Contrôle | Résultat | Détail |",
  "|---|---|---|",
  ...checks.map((c) => `| ${c.name} | ${c.ok ? "OK" : "**ÉCHEC**"} | ${c.detail} |`),
  failure ? `\n**Erreur** : ${failure}\n` : "",
  "## Limites de ce test",
  "",
  "- Il valide la **procédure** (sauvegarde puis restauration complète, contrôles) sur la base de recette, pas les sauvegardes de production, qui n'existent pas encore (phase 9).",
  "- La durée mesurée exclut le temps d'approvisionnement d'un serveur neuf, de reconfiguration des secrets et de bascule du domaine : à ajouter dans le plan de reprise.",
  "- Le test se fait sur la même machine que la base source ; un test sur l'hébergement cible est à refaire avant la mise en production.",
  "",
];

const reportDir = join("docs", "recette");
mkdirSync(reportDir, { recursive: true });
const reportPath = join(reportDir, `restore-test-${startedAt.toISOString().slice(0, 10)}.md`);
writeFileSync(reportPath, lines.join("\n") + "\n", { encoding: "utf8" });

console.log(`Test de restauration : ${allOk ? "CONFORME" : "NON CONFORME"} (restauration + contrôles ${seconds(restoreMs)}, total ${seconds(durationMs)}).`);
for (const c of checks) console.log(`  ${c.ok ? "OK    " : "ÉCHEC "} ${c.name} — ${c.detail}`);
if (failure) console.error(`Erreur : ${failure}`);
console.log(`Rapport : ${reportPath}`);
process.exit(allOk ? 0 : 1);
