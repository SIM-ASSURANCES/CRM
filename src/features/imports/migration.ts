import "server-only";
import { SOURCE_RETENTION_DAYS, type ImportEntity } from "@/features/imports/config";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";

// Migration de données (phase 7) : rapprochement d'un lot avec la source, validation (qui efface la source), purge d'office
// des sources non validées, et normalisation des téléphones DÉJÀ en base. Réservé à `import:run` (administrateur).

function assertImport(user: CurrentUser): void {
  if (!can(user.role, "import:run")) throw errors.forbidden();
}

// --- Rapprochement ----------------------------------------------------------------------------------------------

export type ReconciliationCheck = { label: string; ok: boolean; detail: string };

export type Reconciliation = {
  batchId: string;
  entity: ImportEntity;
  status: string;
  sourceRows: number;
  counts: { imported: number; rejected: number; duplicates: number; pending: number; withWarnings: number };
  /** Montants du fichier d'origine rapprochés des montants en base ; null si le lot n'a pas de colonne de montant. */
  amounts: null | {
    label: string;
    imported: number;
    inCrm: number;
    rejected: number;
    duplicates: number;
    pending: number;
  };
  checks: ReconciliationCheck[];
  /** Les cellules d'origine sont-elles encore conservées ? (non après validation ou purge). */
  sourceAvailable: boolean;
  /** Tous les contrôles sont réussis : le lot peut être validé. */
  ready: boolean;
  validatedAt: Date | null;
};

/** « 1 250 000 », « 1250000,50 », « 6 245 790 FCFA » → nombre ; null si la cellule n'en contient pas. */
export function parseSourceAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s  ]/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const AMOUNT_FIELD: Partial<Record<ImportEntity, { key: string; label: string }>> = {
  accounts: { key: "revenueAmount", label: "Chiffre d'affaires des comptes (FCFA)" },
  leads: { key: "expectedRevenue", label: "Chiffre d'affaires attendu des prospects (FCFA)" },
};

/** Somme des montants en base des fiches créées par un lot. */
async function amountInCrm(entity: ImportEntity, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  if (entity === "accounts") {
    const sum = await db.crmAccount.aggregate({ where: { id: { in: ids } }, _sum: { revenueAmount: true } });
    return sum._sum.revenueAmount?.toNumber() ?? 0;
  }
  if (entity === "leads") {
    const sum = await db.lead.aggregate({ where: { id: { in: ids } }, _sum: { expectedRevenue: true } });
    return sum._sum.expectedRevenue?.toNumber() ?? 0;
  }
  return 0;
}

async function countCreated(entity: ImportEntity, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  if (entity === "accounts") return db.crmAccount.count({ where: { id: { in: ids } } });
  if (entity === "leads") return db.lead.count({ where: { id: { in: ids } } });
  return db.contact.count({ where: { id: { in: ids } } });
}

/**
 * Rapprochement d'un lot (« sortie de phase : rapprochement accepté »). Trois sources INDÉPENDANTES sont comparées : les
 * cellules du fichier d'origine, le sort de chaque ligne, et les fiches réellement présentes en base. Comparer seulement
 * « lignes importées » et « fiches créées » ne prouverait rien (le même code écrit les deux) : c'est le montant relu dans
 * le fichier brut, rapproché du montant en base, qui révèle une valeur perdue ou déformée en route.
 */
export async function getReconciliation(user: CurrentUser, id: string): Promise<Reconciliation> {
  assertImport(user);
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) throw errors.notFound("Lot d'import introuvable.");
  const entity = batch.entity as ImportEntity;

  const rows = await db.importRow.findMany({
    where: { batchId: id },
    select: { status: true, raw: true, warnings: true, createdEntityId: true },
  });

  const headers = batch.headers as string[];
  const mapping = (batch.mapping ?? {}) as Record<string, string>;
  const amountField = AMOUNT_FIELD[entity];
  const amountIndex = amountField && mapping[amountField.key] ? headers.indexOf(mapping[amountField.key]) : -1;

  const counts = { imported: 0, rejected: 0, duplicates: 0, pending: 0, withWarnings: 0 };
  const amounts = { imported: 0, rejected: 0, duplicates: 0, pending: 0 };
  const createdIds: string[] = [];
  let sourceAvailable = false;

  for (const row of rows) {
    const cells = row.raw as string[];
    if (cells.length > 0) sourceAvailable = true;
    if (row.warnings !== null) counts.withWarnings += 1;

    const bucket = row.status === "imported" ? "imported" : row.status === "rejected" ? "rejected" : row.status === "duplicate" ? "duplicates" : "pending";
    counts[bucket] += 1;
    if (row.status === "imported" && row.createdEntityId) createdIds.push(row.createdEntityId);

    if (amountIndex >= 0 && cells.length > 0) amounts[bucket] += parseSourceAmount(cells[amountIndex] ?? "") ?? 0;
  }

  const checks: ReconciliationCheck[] = [];
  const accounted = counts.imported + counts.rejected + counts.duplicates + counts.pending;
  checks.push({
    label: "Chaque ligne du fichier a un sort",
    ok: accounted === batch.totalRows,
    detail: `${batch.totalRows} ligne(s) dans le fichier = ${counts.imported} importée(s) + ${counts.rejected} rejetée(s) + ${counts.duplicates} doublon(s) + ${counts.pending} en attente.`,
  });
  checks.push({
    label: "Aucune ligne valide en attente d'import",
    ok: counts.pending === 0,
    detail: counts.pending === 0 ? "Toutes les lignes valides sont importées." : `${counts.pending} ligne(s) restent à importer (import pilote en cours ?).`,
  });

  const present = await countCreated(entity, createdIds);
  checks.push({
    label: "Chaque ligne importée correspond à une fiche en base",
    ok: createdIds.length === counts.imported && present === counts.imported,
    detail: `${counts.imported} ligne(s) importée(s) ; ${present} fiche(s) retrouvée(s) en base.`,
  });

  let amountSummary: Reconciliation["amounts"] = null;
  if (amountField && amountIndex >= 0) {
    if (!sourceAvailable) {
      checks.push({ label: "Montants : fichier d'origine rapproché de la base", ok: false, detail: "La source a été effacée : le rapprochement des montants n'est plus possible." });
    } else {
      const inCrm = round2(await amountInCrm(entity, createdIds));
      const imported = round2(amounts.imported);
      amountSummary = {
        label: amountField.label,
        imported,
        inCrm,
        rejected: round2(amounts.rejected),
        duplicates: round2(amounts.duplicates),
        pending: round2(amounts.pending),
      };
      checks.push({
        label: "Montants : fichier d'origine rapproché de la base",
        ok: Math.abs(imported - inCrm) < 0.01,
        detail: `${amountField.label} : ${imported} dans le fichier (lignes importées) ; ${inCrm} en base.`,
      });
    }
  }

  return {
    batchId: id,
    entity,
    status: batch.status,
    sourceRows: batch.totalRows,
    counts,
    amounts: amountSummary,
    checks,
    sourceAvailable,
    ready: batch.status === "imported" && checks.every((check) => check.ok),
    validatedAt: batch.validatedAt,
  };
}

// --- Validation -------------------------------------------------------------------------------------------------

/**
 * Accepte le rapprochement d'un lot : il passe à « Validé » et la source (cellules d'origine et valeurs normalisées des
 * lignes) est EFFACÉE. Refusé tant qu'un contrôle échoue. Si le lot a des rejets, des doublons ou des avertissements,
 * l'administrateur doit confirmer en avoir pris connaissance (le rapport d'anomalies est téléchargeable avant).
 */
export async function validateBatch(user: CurrentUser, id: string, options: { acknowledged: boolean }): Promise<void> {
  assertImport(user);
  const reconciliation = await getReconciliation(user, id);
  if (reconciliation.status === "validated") throw errors.conflict("Ce lot est déjà validé.");
  if (reconciliation.status !== "imported") throw errors.conflict("Seul un lot entièrement importé peut être validé.");
  if (!reconciliation.ready) throw errors.validation("Le rapprochement n'est pas conforme : corrigez les contrôles en échec avant de valider.");

  const { rejected, duplicates, withWarnings } = reconciliation.counts;
  if (rejected + duplicates + withWarnings > 0 && !options.acknowledged) {
    throw errors.validation("Confirmez avoir pris connaissance du rapport d'anomalies avant de valider.", { fieldErrors: { acknowledged: ["Confirmation requise."] } });
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    // Verrou : deux validations simultanées ne passent pas toutes les deux.
    const claimed = await tx.importBatch.updateMany({ where: { id, status: "imported" }, data: { status: "validated", validatedAt: now, validatedByUserId: user.id } });
    if (claimed.count === 0) throw errors.conflict("Ce lot vient d'être validé ou modifié.");
    // Minimisation des données : la source a servi au rapprochement, elle n'a plus d'utilité.
    await tx.importRow.updateMany({ where: { batchId: id }, data: { raw: [], parsed: Prisma.DbNull } });
    await writeAudit(
      {
        actorUserId: user.id,
        action: "import.validated",
        entityType: "import_batch",
        entityId: id,
        metadata: { entity: reconciliation.entity, sourceRows: reconciliation.sourceRows, ...reconciliation.counts },
      },
      tx,
    );
  });
}

// --- Purge d'office ---------------------------------------------------------------------------------------------

/**
 * Efface la source des lots non validés plus vieux que SOURCE_RETENTION_DAYS : un fichier de personnes ne reste pas en
 * base indéfiniment faute de validation. Un lot jamais importé (déposé, analysé) est abandonné ; un lot importé garde ses
 * fiches mais perd sa source. Idempotent.
 */
export async function purgeExpiredSources(now: Date = new Date()): Promise<{ abandoned: number; purgedRows: number }> {
  const cutoff = new Date(now.getTime() - SOURCE_RETENTION_DAYS * 86_400_000);

  const abandonedBatches = await db.importBatch.findMany({ where: { status: { in: ["uploaded", "analyzed"] }, createdAt: { lt: cutoff } }, select: { id: true, entity: true } });
  for (const batch of abandonedBatches) {
    await db.$transaction(async (tx) => {
      await tx.importRow.deleteMany({ where: { batchId: batch.id } });
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: "cancelled" } });
      await writeAudit({ actorUserId: null, action: "import.source_purged", entityType: "import_batch", entityId: batch.id, metadata: { entity: batch.entity, reason: "abandoned" } }, tx);
    });
  }

  const staleBatches = await db.importBatch.findMany({ where: { status: { in: ["importing", "imported"] }, createdAt: { lt: cutoff } }, select: { id: true, entity: true } });
  let purgedRows = 0;
  for (const batch of staleBatches) {
    const cleared = await db.$executeRaw`UPDATE import_rows SET raw = '[]'::jsonb, parsed = NULL WHERE batch_id = ${batch.id}::uuid AND (raw <> '[]'::jsonb OR parsed IS NOT NULL)`;
    if (cleared > 0) {
      purgedRows += cleared;
      await writeAudit({ actorUserId: null, action: "import.source_purged", entityType: "import_batch", entityId: batch.id, metadata: { entity: batch.entity, reason: "retention", rows: cleared } });
    }
  }
  return { abandoned: abandonedBatches.length, purgedRows };
}

// --- Téléphones déjà en base ------------------------------------------------------------------------------------

export type StoredPhoneEntity = "accounts" | "contacts" | "leads";

export type StoredPhoneReport = {
  entity: StoredPhoneEntity;
  /** Fiches ayant un numéro. */
  withPhone: number;
  /** Déjà au format +225… (ou international valide) : rien à faire. */
  alreadyNormalized: number;
  /** Numéros que la normalisation réécrit (« 07 07 35 36 73 » → « +2250707353673 »). */
  toNormalize: number;
  /** Numéros inexploitables (8 chiffres d'avant 2021, lettres…) : laissés tels quels, à corriger à la main. */
  unresolved: number;
  /** Quelques exemples de numéros à corriger. */
  samples: { id: string; label: string; phone: string; reason: string }[];
};

type PhoneRecord = { id: string; label: string; phone: string };

const PAGE = 1000;

async function* phoneRecords(entity: StoredPhoneEntity): AsyncGenerator<PhoneRecord[]> {
  let cursor: string | undefined;
  for (;;) {
    const page: PhoneRecord[] =
      entity === "accounts"
        ? (await db.crmAccount.findMany({ where: { phone: { not: null } }, select: { id: true, legalName: true, phone: true }, orderBy: { id: "asc" }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })).map(
            (row) => ({ id: row.id, label: row.legalName, phone: row.phone ?? "" }),
          )
        : entity === "contacts"
          ? (await db.contact.findMany({ where: { phone: { not: null } }, select: { id: true, firstName: true, lastName: true, phone: true }, orderBy: { id: "asc" }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })).map(
              (row) => ({ id: row.id, label: `${row.firstName} ${row.lastName}`, phone: row.phone ?? "" }),
            )
          : (await db.lead.findMany({ select: { id: true, companyName: true, phone: true }, orderBy: { id: "asc" }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })).map(
              (row) => ({ id: row.id, label: row.companyName, phone: row.phone }),
            );
    if (page.length === 0) return;
    yield page;
    cursor = page[page.length - 1].id;
    if (page.length < PAGE) return;
  }
}

async function updatePhones(entity: StoredPhoneEntity, updates: { id: string; phone: string }[]): Promise<void> {
  for (let start = 0; start < updates.length; start += 200) {
    const chunk = updates.slice(start, start + 200);
    await db.$transaction(
      chunk.map(({ id, phone }) =>
        entity === "accounts"
          ? db.crmAccount.update({ where: { id }, data: { phone } })
          : entity === "contacts"
            ? db.contact.update({ where: { id }, data: { phone } })
            : db.lead.update({ where: { id }, data: { phone } }),
      ),
    );
  }
}

const ENTITIES: StoredPhoneEntity[] = ["accounts", "contacts", "leads"];

async function scanStoredPhones(apply: boolean): Promise<StoredPhoneReport[]> {
  const reports: StoredPhoneReport[] = [];
  for (const entity of ENTITIES) {
    const report: StoredPhoneReport = { entity, withPhone: 0, alreadyNormalized: 0, toNormalize: 0, unresolved: 0, samples: [] };
    for await (const page of phoneRecords(entity)) {
      const updates: { id: string; phone: string }[] = [];
      for (const record of page) {
        if (record.phone.trim() === "") continue;
        report.withPhone += 1;
        const result = normalizePhone(record.phone);
        if (!result.ok) {
          report.unresolved += 1;
          if (report.samples.length < 20) report.samples.push({ id: record.id, label: record.label, phone: record.phone, reason: result.message });
        } else if (result.value === record.phone) {
          report.alreadyNormalized += 1;
        } else {
          report.toNormalize += 1;
          updates.push({ id: record.id, phone: result.value });
        }
      }
      if (apply) await updatePhones(entity, updates);
    }
    reports.push(report);
  }
  return reports;
}

/** Simulation : ce que la normalisation changerait, sans rien écrire. */
export async function previewStoredPhones(user: CurrentUser): Promise<StoredPhoneReport[]> {
  assertImport(user);
  return scanStoredPhones(false);
}

/**
 * Normalise les numéros déjà enregistrés (comptes, contacts, prospects) au format unique +225… . Les numéros
 * inexploitables ne sont JAMAIS modifiés ni effacés : ils restent à corriger à la main. Tracé sans aucun numéro.
 */
export async function normalizeStoredPhones(user: CurrentUser): Promise<StoredPhoneReport[]> {
  assertImport(user);
  const reports = await scanStoredPhones(true);
  await writeAudit({
    actorUserId: user.id,
    action: "phone.normalized",
    entityType: "phone_normalization",
    metadata: Object.fromEntries(reports.map((report) => [report.entity, { normalized: report.toNormalize, unresolved: report.unresolved }])),
  });
  return reports;
}
