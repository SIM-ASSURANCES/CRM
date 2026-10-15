import { z } from "zod";
import { ACCOUNT_SOURCES, ACCOUNT_STATUSES, CONTACT_STATUSES, COUNTRIES } from "@/features/accounts/config";
import { accountFieldsSchema } from "@/features/accounts/schemas";
import { normalizeName } from "@/features/accounts/rules";
import { contactFieldsSchema } from "@/features/contacts/schemas";
import { SECTORS } from "@/features/leads/config";
import { IMPORT_FIELDS, type ImportDefaults, type ImportEntity } from "@/features/imports/config";
import { accountNameKey, contactNameKey, identifierKey, matchOption, recordFromRow } from "@/features/imports/rules";

// Analyse d'un fichier AVANT toute écriture : chaque ligne est normalisée, validée avec les MÊMES schémas que les
// formulaires, puis comparée aux données existantes et aux autres lignes du fichier. Fonctions pures : le contexte
// (comptes, contacts, responsables existants) est fourni par l'appelant.

export type SourceRow = { rowNumber: number; cells: string[] };

export type RowResult = {
  status: "valid" | "rejected" | "duplicate";
  /** Valeurs normalisées prêtes à être importées (statut « valid » uniquement). */
  parsed: Record<string, unknown> | null;
  errors: string[];
  /** Description du doublon (« Compte existant « X » » ou « Ligne 12 du fichier »). */
  duplicateOf: string | null;
  duplicateScope: "database" | "file" | null;
};

export type ImportReport = {
  total: number;
  valid: number;
  rejected: number;
  duplicatesInDatabase: number;
  duplicatesInFile: number;
  /** Champs recommandés vides parmi les lignes valides. */
  missing: { label: string; count: number }[];
  /** Motifs de rejet les plus fréquents. */
  reasons: { reason: string; count: number }[];
  unmappedHeaders: string[];
};

export type AccountContext = {
  /** E-mail (minuscules) → identifiant d'un utilisateur actif pouvant porter des comptes. */
  owners: ReadonlyMap<string, string>;
  existingByIdentifier: ReadonlyMap<string, string>;
  existingByName: ReadonlyMap<string, string>;
};

type AccountRef = { id: string; name: string };

export type ContactContext = {
  owners: ReadonlyMap<string, string>;
  accountsByIdentifier: ReadonlyMap<string, AccountRef[]>;
  accountsByName: ReadonlyMap<string, AccountRef[]>;
  existingContactsByEmail: ReadonlyMap<string, string>;
  existingContactsByName: ReadonlyMap<string, string>;
};

const fieldLabel = (entity: ImportEntity, key: string) => IMPORT_FIELDS[entity].find((field) => field.key === key)?.label ?? key;

const SECTOR_OPTIONS = SECTORS.map((sector) => ({ code: sector, label: sector }));

const rejected = (errors: string[]): RowResult => ({ status: "rejected", parsed: null, errors, duplicateOf: null, duplicateScope: null });
const duplicate = (of: string, scope: "database" | "file"): RowResult => ({
  status: "duplicate",
  parsed: null,
  errors: [],
  duplicateOf: of,
  duplicateScope: scope,
});
const valid = (parsed: Record<string, unknown>): RowResult => ({ status: "valid", parsed, errors: [], duplicateOf: null, duplicateScope: null });

/** « https://www.client.ci/contact » ou « marie@client.ci » → « client.ci » : tolère ce qu'on trouve dans les fichiers réels. */
export function cleanDomain(value: string): string {
  let domain = value.trim().toLowerCase();
  if (domain.includes("@")) domain = domain.slice(domain.lastIndexOf("@") + 1);
  return domain.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
}

/** « 1 250 » (espaces simples ou insécables des tableurs français) → « 1250 ». */
const digitsOnly = (value: string) => value.replace(/[\s  ]/g, "");

function zodMessages(entity: ImportEntity, error: z.ZodError, skip: ReadonlySet<string>): string[] {
  const messages: string[] = [];
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (skip.has(key)) continue;
    messages.push(`${fieldLabel(entity, key)} : ${issue.message}`);
  }
  return messages;
}

function resolveOwner(
  record: Record<string, string>,
  defaults: ImportDefaults,
  owners: ReadonlyMap<string, string>,
  errors: string[],
): string {
  const email = record.ownerEmail?.trim().toLowerCase();
  if (!email) return defaults.ownerUserId;
  const found = owners.get(email);
  if (!found) errors.push(`Responsable : aucun utilisateur actif ne correspond à « ${record.ownerEmail} ».`);
  return found ?? defaults.ownerUserId;
}

// --- Comptes -----------------------------------------------------------------------------------------------------

function normalizeAccount(record: Record<string, string>, defaults: ImportDefaults, ctx: AccountContext) {
  const errors: string[] = [];
  const handled = new Set<string>();

  const sectorRaw = record.sector || defaults.sector || "";
  let sector: string | undefined;
  if (!sectorRaw) {
    errors.push("Secteur d'activité : obligatoire (colonne vide et aucun secteur par défaut).");
    handled.add("sector");
  } else {
    sector = matchOption(sectorRaw, SECTOR_OPTIONS) ?? undefined;
    if (!sector) {
      errors.push(`Secteur d'activité : « ${sectorRaw} » n'est pas dans la liste du CRM.`);
      handled.add("sector");
    }
  }

  const statusRaw = record.status || defaults.status || "prospect";
  const status = matchOption(statusRaw, ACCOUNT_STATUSES) ?? undefined;
  if (!status) {
    errors.push(`Statut : « ${statusRaw} » n'est pas reconnu (Prospect, Client, Inactif, Partenaire).`);
    handled.add("status");
  }

  let source: string | undefined;
  if (record.source) {
    source = matchOption(record.source, ACCOUNT_SOURCES) ?? undefined;
    if (!source) {
      errors.push(`Source d'acquisition : « ${record.source} » n'est pas reconnue.`);
      handled.add("source");
    }
  }

  const countryRaw = record.country || defaults.country || "CI";
  const country = matchOption(countryRaw, COUNTRIES) ?? undefined;
  if (!country) {
    errors.push(`Pays : « ${countryRaw} » n'est pas reconnu.`);
    handled.add("country");
  }

  const ownerUserId = resolveOwner(record, defaults, ctx.owners, errors);

  const parsed = accountFieldsSchema.safeParse({
    legalName: record.legalName,
    tradeName: record.tradeName,
    legalIdentifier: record.legalIdentifier,
    sector,
    employeeCount: record.employeeCount === undefined ? undefined : digitsOnly(record.employeeCount),
    revenueAmount: record.revenueAmount,
    revenueYear: record.revenueYear === undefined ? undefined : digitsOnly(record.revenueYear),
    collectiveAgreement: record.collectiveAgreement,
    status,
    source,
    phone: record.phone,
    emailDomain: record.emailDomain ? cleanDomain(record.emailDomain) : undefined,
    addressLine: record.addressLine,
    city: record.city,
    country,
  });
  if (!parsed.success) errors.push(...zodMessages("accounts", parsed.error, handled));

  return { errors, data: parsed.success ? parsed.data : null, ownerUserId };
}

/**
 * Analyse les lignes d'un fichier de comptes. Un doublon est une ligne dont l'identifiant légal ou la raison sociale
 * (à pays égal) existe déjà en base OU plus haut dans le fichier : elle n'est pas importée, mais signalée.
 */
export function analyzeAccounts(
  rows: SourceRow[],
  headers: string[],
  mapping: Record<string, string>,
  defaults: ImportDefaults,
  ctx: AccountContext,
): Map<number, RowResult> {
  const results = new Map<number, RowResult>();
  const seenIdentifiers = new Map<string, number>();
  const seenNames = new Map<string, number>();

  for (const row of rows) {
    const { errors, data, ownerUserId } = normalizeAccount(recordFromRow(row.cells, headers, mapping), defaults, ctx);
    if (errors.length > 0 || !data) {
      results.set(row.rowNumber, rejected(errors));
      continue;
    }

    const idKey = data.legalIdentifier ? identifierKey(data.country, data.legalIdentifier) : null;
    const nameKey = accountNameKey(data.country, data.legalName);

    const inDatabase =
      (idKey && ctx.existingByIdentifier.has(idKey) && `Compte existant « ${ctx.existingByIdentifier.get(idKey)} » (même identifiant légal)`) ||
      (ctx.existingByName.has(nameKey) && `Compte existant « ${ctx.existingByName.get(nameKey)} » (même raison sociale)`);
    if (inDatabase) {
      results.set(row.rowNumber, duplicate(inDatabase, "database"));
      continue;
    }

    const firstRow = (idKey ? seenIdentifiers.get(idKey) : undefined) ?? seenNames.get(nameKey);
    if (firstRow !== undefined) {
      results.set(row.rowNumber, duplicate(`Ligne ${firstRow} du fichier`, "file"));
      continue;
    }

    if (idKey) seenIdentifiers.set(idKey, row.rowNumber);
    seenNames.set(nameKey, row.rowNumber);
    results.set(row.rowNumber, valid({ ...data, ownerUserId }));
  }
  return results;
}

// --- Contacts ----------------------------------------------------------------------------------------------------

function resolveAccount(reference: string, ctx: ContactContext): { account?: AccountRef; error?: string } {
  if (!reference) return { error: "Compte : obligatoire (colonne vide)." };
  const byIdentifier = ctx.accountsByIdentifier.get(reference.trim().toLowerCase().replace(/\s+/g, "")) ?? [];
  const matches = byIdentifier.length > 0 ? byIdentifier : (ctx.accountsByName.get(normalizeName(reference)) ?? []);
  if (matches.length === 0) return { error: `Compte : « ${reference} » est introuvable (importez d'abord les comptes).` };
  if (matches.length > 1) return { error: `Compte : « ${reference} » correspond à plusieurs comptes (précisez l'identifiant légal).` };
  return { account: matches[0] };
}

function normalizeContact(record: Record<string, string>, defaults: ImportDefaults, ctx: ContactContext) {
  const errors: string[] = [];
  const handled = new Set<string>();

  const statusRaw = record.status || defaults.status || "active";
  const status = matchOption(statusRaw, CONTACT_STATUSES) ?? undefined;
  if (!status) {
    errors.push(`Statut : « ${statusRaw} » n'est pas reconnu (Actif, À confirmer, Parti).`);
    handled.add("status");
  }

  const { account, error } = resolveAccount(record.accountRef ?? "", ctx);
  if (error) errors.push(error);

  const ownerUserId = resolveOwner(record, defaults, ctx.owners, errors);

  const parsed = contactFieldsSchema.safeParse({
    firstName: record.firstName,
    lastName: record.lastName,
    jobTitle: record.jobTitle,
    department: record.department,
    email: record.email,
    phone: record.phone,
    status,
  });
  if (!parsed.success) errors.push(...zodMessages("contacts", parsed.error, handled));

  return { errors, data: parsed.success ? parsed.data : null, account, ownerUserId };
}

/**
 * Analyse les lignes d'un fichier de contacts. Un doublon est un contact dont l'e-mail existe déjà, ou qui porte le même
 * nom dans le même compte, en base ou plus haut dans le fichier.
 */
export function analyzeContacts(
  rows: SourceRow[],
  headers: string[],
  mapping: Record<string, string>,
  defaults: ImportDefaults,
  ctx: ContactContext,
): Map<number, RowResult> {
  const results = new Map<number, RowResult>();
  const seenEmails = new Map<string, number>();
  const seenNames = new Map<string, number>();

  for (const row of rows) {
    const { errors, data, account, ownerUserId } = normalizeContact(recordFromRow(row.cells, headers, mapping), defaults, ctx);
    if (errors.length > 0 || !data || !account) {
      results.set(row.rowNumber, rejected(errors));
      continue;
    }

    const emailKey = data.email ? data.email.toLowerCase() : null;
    const nameKey = contactNameKey(account.id, data.firstName, data.lastName);

    const inDatabase =
      (emailKey && ctx.existingContactsByEmail.has(emailKey) && `Contact existant « ${ctx.existingContactsByEmail.get(emailKey)} » (même e-mail)`) ||
      (ctx.existingContactsByName.has(nameKey) && `Contact existant « ${ctx.existingContactsByName.get(nameKey)} » (même nom dans ce compte)`);
    if (inDatabase) {
      results.set(row.rowNumber, duplicate(inDatabase, "database"));
      continue;
    }

    const firstRow = (emailKey ? seenEmails.get(emailKey) : undefined) ?? seenNames.get(nameKey);
    if (firstRow !== undefined) {
      results.set(row.rowNumber, duplicate(`Ligne ${firstRow} du fichier`, "file"));
      continue;
    }

    if (emailKey) seenEmails.set(emailKey, row.rowNumber);
    seenNames.set(nameKey, row.rowNumber);
    results.set(row.rowNumber, valid({ ...data, accountId: account.id, ownerUserId }));
  }
  return results;
}

// --- Rapport de qualité ------------------------------------------------------------------------------------------

const isFilled = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

/** Rapport de qualité (CDC 16) : rejets, doublons, champs manquants. */
export function buildReport(
  entity: ImportEntity,
  results: Iterable<RowResult>,
  headers: string[],
  mapping: Record<string, string>,
): ImportReport {
  const all = [...results];
  const validRows = all.filter((result) => result.status === "valid");

  const reasonCounts = new Map<string, number>();
  for (const result of all) for (const reason of result.errors) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);

  const recommended = IMPORT_FIELDS[entity].filter((field) => field.recommended);
  const mapped = new Set(Object.values(mapping).filter(Boolean));

  return {
    total: all.length,
    valid: validRows.length,
    rejected: all.filter((result) => result.status === "rejected").length,
    duplicatesInDatabase: all.filter((result) => result.duplicateScope === "database").length,
    duplicatesInFile: all.filter((result) => result.duplicateScope === "file").length,
    missing: recommended
      .map((field) => ({ label: field.label, count: validRows.filter((result) => !isFilled(result.parsed?.[field.key])).length }))
      .filter((entry) => entry.count > 0),
    reasons: [...reasonCounts]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    unmappedHeaders: headers.filter((header) => !mapped.has(header)),
  };
}
