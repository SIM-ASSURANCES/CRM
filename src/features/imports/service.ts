import "server-only";
import { z } from "zod";
import { normalizeName } from "@/features/accounts/rules";
import {
  analyzeAccounts,
  analyzeContacts,
  buildReport,
  type AccountContext,
  type ContactContext,
  type ImportReport,
  type RowResult,
} from "@/features/imports/analysis";
import {
  IMPORT_FIELDS,
  isImportEntity,
  type ImportDefaults,
  type ImportEntity,
} from "@/features/imports/config";
import { parseSpreadsheet } from "@/features/imports/parse";
import { accountNameKey, checkMapping, identifierKey, matchOption, suggestMapping } from "@/features/imports/rules";
import { ACCOUNT_STATUSES, CONTACT_STATUSES, COUNTRIES } from "@/features/accounts/config";
import { SECTORS } from "@/features/leads/config";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { FieldErrors } from "@/lib/forms";
import { logger } from "@/lib/logger";

// Import initial de données (CDC 11, 14 et 16). Quatre étapes : dépôt, association des colonnes + analyse (rien n'est
// écrit dans les comptes ou contacts), puis import après confirmation. Réservé à `import:run` (administrateur).

export type BatchSummary = {
  id: string;
  entity: ImportEntity;
  filename: string;
  status: string;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateRows: number;
  importedRows: number;
  creatorName: string;
  createdAt: Date;
  importedAt: Date | null;
};

export type ProblemRow = {
  rowNumber: number;
  status: "rejected" | "duplicate";
  messages: string[];
  /** Premières cellules de la ligne : de quoi la retrouver dans le fichier. */
  preview: string[];
};

export type BatchDetail = BatchSummary & {
  headers: string[];
  mapping: Record<string, string>;
  suggestedMapping: Record<string, string>;
  defaults: ImportDefaults | null;
  report: ImportReport | null;
  problems: ProblemRow[];
  problemsTruncated: boolean;
};

const PROBLEMS_SHOWN = 100;
const IMPORT_CHUNK = 200;

function assertImport(user: CurrentUser): void {
  if (!can(user.role, "import:run")) throw errors.forbidden();
}

function fail(fieldErrors: FieldErrors, message: string): never {
  throw errors.validation(message, { fieldErrors });
}

function toSummary(batch: Prisma.ImportBatchGetPayload<{ include: { creator: { select: { name: true } } } }>): BatchSummary {
  return {
    id: batch.id,
    entity: batch.entity as ImportEntity,
    filename: batch.filename,
    status: batch.status,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    rejectedRows: batch.rejectedRows,
    duplicateRows: batch.duplicateRows,
    importedRows: batch.importedRows,
    creatorName: batch.creator.name,
    createdAt: batch.createdAt,
    importedAt: batch.importedAt,
  };
}

const withCreator = { creator: { select: { name: true } } } as const;

/** Nom de fichier sans chemin ni caractères de contrôle : il s'affiche et se journalise. */
function cleanFilename(name: string): string {
  return (
    name
      .replace(/^.*[\\/]/, "")
      .replace(/[\u0000-\u001f]/g, "")
      .trim()
      .slice(0, 200) || "fichier"
  );
}

// --- Lecture -----------------------------------------------------------------------------------------------------

export async function listBatches(user: CurrentUser, limit = 20): Promise<BatchSummary[]> {
  assertImport(user);
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100), include: withCreator });
  return batches.map(toSummary);
}

export async function getBatch(user: CurrentUser, id: string): Promise<BatchDetail> {
  assertImport(user);
  const batch = await db.importBatch.findUnique({ where: { id }, include: withCreator });
  if (!batch) throw errors.notFound("Lot d'import introuvable.");

  const entity = batch.entity as ImportEntity;
  const headers = batch.headers as string[];
  const mapping = (batch.mapping ?? {}) as Record<string, string>;

  const problemRows = await db.importRow.findMany({
    where: { batchId: id, status: { in: ["rejected", "duplicate"] } },
    orderBy: { rowNumber: "asc" },
    take: PROBLEMS_SHOWN + 1,
    select: { rowNumber: true, status: true, errors: true, duplicateOf: true, raw: true },
  });

  return {
    ...toSummary(batch),
    headers,
    mapping,
    suggestedMapping: batch.mapping ? mapping : suggestMapping(headers, IMPORT_FIELDS[entity]),
    defaults: (batch.defaults ?? null) as ImportDefaults | null,
    report: (batch.report ?? null) as ImportReport | null,
    problems: problemRows.slice(0, PROBLEMS_SHOWN).map((row) => ({
      rowNumber: row.rowNumber,
      status: row.status as "rejected" | "duplicate",
      messages: row.status === "duplicate" ? [`Doublon : ${row.duplicateOf ?? "déjà présent"}`] : ((row.errors ?? []) as string[]),
      preview: ((row.raw ?? []) as string[]).filter(Boolean).slice(0, 3),
    })),
    problemsTruncated: problemRows.length > PROBLEMS_SHOWN,
  };
}

// --- Étape 1 : dépôt du fichier ----------------------------------------------------------------------------------

export async function createBatch(
  user: CurrentUser,
  input: { entity: string; filename: string; buffer: Buffer },
): Promise<{ id: string }> {
  assertImport(user);
  if (!isImportEntity(input.entity)) fail({ entity: ["Choisissez ce que vous importez."] }, "Type d'import invalide.");

  const filename = cleanFilename(input.filename);
  const parsed = await parseSpreadsheet(input.buffer, filename);

  return db.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        entity: input.entity,
        filename,
        headers: parsed.headers,
        totalRows: parsed.rows.length,
        createdByUserId: user.id,
      },
    });
    for (let start = 0; start < parsed.rows.length; start += 500) {
      await tx.importRow.createMany({
        data: parsed.rows.slice(start, start + 500).map((row) => ({ batchId: batch.id, rowNumber: row.rowNumber, raw: row.cells })),
      });
    }
    await writeAudit(
      { actorUserId: user.id, action: "import.uploaded", entityType: "import_batch", entityId: batch.id, metadata: { entity: input.entity, rows: parsed.rows.length } },
      tx,
    );
    return { id: batch.id };
  });
}

// --- Étape 2 : association des colonnes et analyse ---------------------------------------------------------------

async function loadOwners(): Promise<Map<string, string>> {
  const users = await db.user.findMany({
    where: { role: { not: "audit" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true, email: true },
  });
  return new Map(users.map((user) => [user.email.toLowerCase(), user.id]));
}

async function loadAccountContext(): Promise<AccountContext> {
  const accounts = await db.crmAccount.findMany({
    where: { archivedAt: null },
    select: { legalName: true, legalIdentifier: true, country: true },
  });
  const existingByIdentifier = new Map<string, string>();
  const existingByName = new Map<string, string>();
  for (const account of accounts) {
    if (account.legalIdentifier) existingByIdentifier.set(identifierKey(account.country, account.legalIdentifier), account.legalName);
    existingByName.set(accountNameKey(account.country, account.legalName), account.legalName);
  }
  return { owners: await loadOwners(), existingByIdentifier, existingByName };
}

async function loadContactContext(): Promise<ContactContext> {
  const [accounts, contacts] = await Promise.all([
    db.crmAccount.findMany({ where: { archivedAt: null }, select: { id: true, legalName: true, legalIdentifier: true } }),
    db.contact.findMany({
      where: { archivedAt: null },
      select: { firstName: true, lastName: true, email: true, accounts: { select: { accountId: true } } },
    }),
  ]);

  const accountsByIdentifier = new Map<string, { id: string; name: string }[]>();
  const accountsByName = new Map<string, { id: string; name: string }[]>();
  const push = (map: Map<string, { id: string; name: string }[]>, key: string, value: { id: string; name: string }) =>
    map.set(key, [...(map.get(key) ?? []), value]);
  for (const account of accounts) {
    const ref = { id: account.id, name: account.legalName };
    if (account.legalIdentifier) push(accountsByIdentifier, account.legalIdentifier.trim().toLowerCase().replace(/\s+/g, ""), ref);
    push(accountsByName, normalizeName(account.legalName), ref);
  }

  const existingContactsByEmail = new Map<string, string>();
  const existingContactsByName = new Map<string, string>();
  for (const contact of contacts) {
    const fullName = `${contact.firstName} ${contact.lastName}`;
    if (contact.email) existingContactsByEmail.set(contact.email.toLowerCase(), fullName);
    for (const link of contact.accounts) {
      existingContactsByName.set(`${link.accountId}|${normalizeName(contact.firstName)}|${normalizeName(contact.lastName)}`, fullName);
    }
  }
  return { owners: await loadOwners(), accountsByIdentifier, accountsByName, existingContactsByEmail, existingContactsByName };
}

export const analyzeInputSchema = z.object({
  id: z.uuid(),
  mapping: z.record(z.string(), z.string()),
  defaults: z.object({
    ownerUserId: z.uuid({ error: "Choisissez le responsable par défaut." }),
    sector: z.string().optional(),
    status: z.string().optional(),
    country: z.string().optional(),
  }),
});
export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

/** Valeurs par défaut vérifiées et ramenées à leurs codes : une valeur inconnue est refusée, jamais devinée. */
async function resolveDefaults(entity: ImportEntity, input: AnalyzeInput["defaults"]): Promise<ImportDefaults> {
  const fieldErrors: FieldErrors = {};

  const owner = await db.user.findFirst({
    where: { id: input.ownerUserId, role: { not: "audit" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true },
  });
  if (!owner) fieldErrors.ownerUserId = ["Le responsable doit être un utilisateur actif pouvant porter des comptes."];

  const defaults: ImportDefaults = { ownerUserId: input.ownerUserId };

  if (entity === "accounts") {
    if (input.sector) {
      const sector = (SECTORS as readonly string[]).find((candidate) => candidate === input.sector);
      if (sector) defaults.sector = sector;
      else fieldErrors.sector = ["Secteur par défaut inconnu."];
    }
    if (input.country) {
      const country = matchOption(input.country, COUNTRIES);
      if (country) defaults.country = country;
      else fieldErrors.country = ["Pays par défaut inconnu."];
    }
  }
  if (input.status) {
    const status = matchOption(input.status, entity === "accounts" ? ACCOUNT_STATUSES : CONTACT_STATUSES);
    if (status) defaults.status = status;
    else fieldErrors.status = ["Statut par défaut inconnu."];
  }

  if (Object.keys(fieldErrors).length > 0) fail(fieldErrors, "Certaines valeurs par défaut sont invalides.");
  return defaults;
}

/**
 * Enregistre l'association des colonnes puis analyse TOUTES les lignes : validation, doublons, rapport de qualité.
 * Peut être relancée tant que rien n'a été importé (corriger l'association, puis ré-analyser).
 */
export async function analyzeBatch(user: CurrentUser, input: AnalyzeInput): Promise<BatchSummary> {
  assertImport(user);
  const batch = await db.importBatch.findUnique({ where: { id: input.id } });
  if (!batch) throw errors.notFound("Lot d'import introuvable.");
  if (batch.status !== "uploaded" && batch.status !== "analyzed") throw errors.conflict("Ce lot a déjà été importé ou annulé : il ne peut plus être analysé.");

  const entity = batch.entity as ImportEntity;
  const headers = batch.headers as string[];
  const mapping = Object.fromEntries(Object.entries(input.mapping).filter(([, header]) => header !== ""));
  const defaults = await resolveDefaults(entity, input.defaults);

  const problems = checkMapping(mapping, headers, IMPORT_FIELDS[entity], defaults);
  if (problems.missingRequired.length > 0 || problems.unknownHeaders.length > 0 || problems.unknownFields.length > 0) {
    const fieldErrors: FieldErrors = {};
    for (const field of IMPORT_FIELDS[entity]) {
      if (problems.missingRequired.includes(field.label)) fieldErrors[`mapping_${field.key}`] = ["Associez une colonne du fichier."];
    }
    fail(fieldErrors, "L'association des colonnes est incomplète.");
  }

  const rows = (await db.importRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" }, select: { rowNumber: true, raw: true } })).map(
    (row) => ({ rowNumber: row.rowNumber, cells: row.raw as string[] }),
  );

  const results: Map<number, RowResult> =
    entity === "accounts"
      ? analyzeAccounts(rows, headers, mapping, defaults, await loadAccountContext())
      : analyzeContacts(rows, headers, mapping, defaults, await loadContactContext());
  const report = buildReport(entity, results.values(), headers, mapping);

  // Écriture des résultats par blocs : une transaction par bloc borne la taille des requêtes.
  const entries = [...results];
  for (let start = 0; start < entries.length; start += IMPORT_CHUNK) {
    await db.$transaction(
      entries.slice(start, start + IMPORT_CHUNK).map(([rowNumber, result]) =>
        db.importRow.update({
          where: { batchId_rowNumber: { batchId: batch.id, rowNumber } },
          data: {
            status: result.status,
            parsed: result.parsed ? (result.parsed as Prisma.InputJsonValue) : Prisma.DbNull,
            errors: result.errors.length > 0 ? result.errors : Prisma.DbNull,
            duplicateOf: result.duplicateOf,
          },
        }),
      ),
    );
  }

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "analyzed",
        mapping,
        defaults: defaults as Prisma.InputJsonValue,
        report: report as unknown as Prisma.InputJsonValue,
        validRows: report.valid,
        rejectedRows: report.rejected,
        duplicateRows: report.duplicatesInDatabase + report.duplicatesInFile,
        analyzedAt: new Date(),
      },
      include: withCreator,
    });
    await writeAudit(
      {
        actorUserId: user.id,
        action: "import.analyzed",
        entityType: "import_batch",
        entityId: batch.id,
        metadata: { entity, valid: report.valid, rejected: report.rejected, duplicates: report.duplicatesInDatabase + report.duplicatesInFile },
      },
      tx,
    );
    return saved;
  });
  return toSummary(updated);
}

// --- Étape 3 : import --------------------------------------------------------------------------------------------

type ParsedAccount = {
  legalName: string;
  tradeName?: string;
  legalIdentifier?: string;
  sector: string;
  employeeCount?: number;
  revenueAmount?: number;
  revenueYear?: number;
  collectiveAgreement?: string;
  status: string;
  source?: string;
  phone?: string;
  emailDomain?: string;
  addressLine?: string;
  city?: string;
  country: string;
  ownerUserId: string;
};

type ParsedContact = {
  firstName: string;
  lastName: string;
  jobTitle?: string;
  department?: string;
  email?: string;
  phone?: string;
  status: string;
  accountId: string;
  ownerUserId: string;
};

/**
 * Importe UNE ligne dans sa propre transaction : la ligne est « réclamée » (valid → imported) puis l'objet créé. Si la
 * création échoue, la réclamation est annulée avec elle : une ligne n'est jamais marquée importée sans son objet, et
 * deux exécutions simultanées ne peuvent pas importer deux fois la même ligne.
 */
async function importRow(entity: ImportEntity, row: { id: string; parsed: Prisma.JsonValue }): Promise<"imported" | "skipped"> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.importRow.updateMany({ where: { id: row.id, status: "valid" }, data: { status: "imported" } });
    if (claimed.count === 0) return "skipped";

    let createdId: string;
    if (entity === "accounts") {
      const p = row.parsed as unknown as ParsedAccount;
      const account = await tx.crmAccount.create({
        data: {
          legalName: p.legalName,
          tradeName: p.tradeName ?? null,
          legalIdentifier: p.legalIdentifier ?? null,
          sector: p.sector,
          employeeCount: p.employeeCount ?? null,
          revenueAmount: p.revenueAmount ?? null,
          revenueYear: p.revenueYear ?? null,
          collectiveAgreement: p.collectiveAgreement ?? null,
          status: p.status,
          source: p.source ?? null,
          phone: p.phone ?? null,
          emailDomain: p.emailDomain ?? null,
          addressLine: p.addressLine ?? null,
          city: p.city ?? null,
          country: p.country,
          ownerUserId: p.ownerUserId,
        },
        select: { id: true },
      });
      createdId = account.id;
    } else {
      const p = row.parsed as unknown as ParsedContact;
      const contact = await tx.contact.create({
        data: {
          firstName: p.firstName,
          lastName: p.lastName,
          jobTitle: p.jobTitle ?? null,
          department: p.department ?? null,
          email: p.email ?? null,
          phone: p.phone ?? null,
          status: p.status,
          ownerUserId: p.ownerUserId,
        },
        select: { id: true },
      });
      const hasPrimary = await tx.accountContact.count({ where: { accountId: p.accountId, isPrimary: true } });
      await tx.accountContact.create({
        data: { accountId: p.accountId, contactId: contact.id, relationshipTitle: p.jobTitle ?? null, isPrimary: hasPrimary === 0 },
      });
      createdId = contact.id;
    }
    await tx.importRow.update({ where: { id: row.id }, data: { createdEntityId: createdId } });
    return "imported";
  });
}

export type ImportOutcome = { imported: number; failed: number; remaining: number };

/**
 * Importe les lignes valides d'un lot analysé. Reprenable : en cas d'interruption, relancer l'import ne traite que les
 * lignes restantes. Une ligne qui échoue à l'insertion (conflit d'unicité, par exemple) est rejetée avec son motif ;
 * elle n'arrête pas les autres.
 */
export async function importBatch(user: CurrentUser, id: string): Promise<ImportOutcome> {
  assertImport(user);
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) throw errors.notFound("Lot d'import introuvable.");

  const claimed = await db.importBatch.updateMany({ where: { id, status: { in: ["analyzed", "importing"] } }, data: { status: "importing" } });
  if (claimed.count === 0) throw errors.conflict("Ce lot n'est pas prêt à être importé (analyse manquante, déjà importé ou annulé).");

  const entity = batch.entity as ImportEntity;
  const rows = await db.importRow.findMany({ where: { batchId: id, status: "valid" }, orderBy: { rowNumber: "asc" }, select: { id: true, parsed: true } });

  let failed = 0;
  for (const row of rows) {
    if (row.parsed === null) continue;
    try {
      await importRow(entity, { id: row.id, parsed: row.parsed });
    } catch (error) {
      failed += 1;
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!conflict) logger.error({ err: error, batchId: id }, "Échec d'insertion d'une ligne d'import");
      await db.importRow.updateMany({
        where: { id: row.id, status: "valid" },
        data: {
          status: "rejected",
          errors: [conflict ? "Conflit à l'insertion : un enregistrement identique vient d'être créé." : "Erreur à l'insertion de cette ligne."],
        },
      });
    }
  }

  const [counts, remaining] = await Promise.all([
    db.importRow.groupBy({ by: ["status"], where: { batchId: id }, _count: { _all: true } }),
    db.importRow.count({ where: { batchId: id, status: "valid" } }),
  ]);
  const count = (status: string) => counts.find((entry) => entry.status === status)?._count._all ?? 0;

  await db.$transaction(async (tx) => {
    // Minimisation des données : les cellules d'origine des lignes importées n'ont plus d'utilité (la fiche existe).
    await tx.importRow.updateMany({ where: { batchId: id, status: "imported" }, data: { raw: [] } });
    await tx.importBatch.update({
      where: { id },
      data: {
        status: remaining === 0 ? "imported" : "importing",
        importedRows: count("imported"),
        validRows: remaining,
        rejectedRows: count("rejected"),
        importedAt: remaining === 0 ? new Date() : null,
      },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        action: "import.completed",
        entityType: "import_batch",
        entityId: id,
        metadata: { entity, imported: count("imported"), rejected: count("rejected"), duplicates: count("duplicate"), failedAtInsert: failed, remaining },
      },
      tx,
    );
  });

  return { imported: count("imported"), failed, remaining };
}

// --- Annulation et exports ---------------------------------------------------------------------------------------

/** Abandonne un lot non importé : les lignes (données personnelles du fichier) sont supprimées immédiatement. */
export async function cancelBatch(user: CurrentUser, id: string): Promise<void> {
  assertImport(user);
  await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id }, select: { status: true, entity: true } });
    if (!batch) throw errors.notFound("Lot d'import introuvable.");
    if (batch.status !== "uploaded" && batch.status !== "analyzed") throw errors.conflict("Seul un lot non importé peut être annulé.");

    await tx.importRow.deleteMany({ where: { batchId: id } });
    await tx.importBatch.update({ where: { id }, data: { status: "cancelled" } });
    await writeAudit({ actorUserId: user.id, action: "import.cancelled", entityType: "import_batch", entityId: id, metadata: { entity: batch.entity } }, tx);
  });
}

/**
 * Rapport des lignes rejetées et des doublons, au format CSV, à corriger puis réimporter. Contient des données du
 * fichier d'origine : l'export est donc journalisé (CDC 8.3).
 */
export async function rejectsCsv(user: CurrentUser, id: string): Promise<{ filename: string; csv: string }> {
  assertImport(user);
  const batch = await db.importBatch.findUnique({ where: { id }, select: { headers: true, filename: true, entity: true } });
  if (!batch) throw errors.notFound("Lot d'import introuvable.");

  const rows = await db.importRow.findMany({
    where: { batchId: id, status: { in: ["rejected", "duplicate"] } },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, status: true, errors: true, duplicateOf: true, raw: true },
  });

  const csv = toCsv([
    ["Ligne", "Résultat", "Motif", ...(batch.headers as string[])],
    ...rows.map((row) => [
      row.rowNumber,
      row.status === "duplicate" ? "Doublon" : "Rejetée",
      row.status === "duplicate" ? (row.duplicateOf ?? "") : ((row.errors ?? []) as string[]).join(" | "),
      ...(row.raw as string[]),
    ]),
  ]);

  await writeAudit({ actorUserId: user.id, action: "import.rejects_exported", entityType: "import_batch", entityId: id, metadata: { entity: batch.entity, rows: rows.length } });
  const base = batch.filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "import";
  return { filename: `rejets-${base}.csv`, csv };
}
