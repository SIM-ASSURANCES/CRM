import { z } from "zod";
import { ACCOUNT_SOURCES, ACCOUNT_STATUSES, CONTACT_STATUSES, COUNTRIES } from "@/features/accounts/config";
import { accountFieldsSchema } from "@/features/accounts/schemas";
import { normalizeName } from "@/features/accounts/rules";
import { contactFieldsSchema } from "@/features/contacts/schemas";
import { LOSS_REASONS, type LeadThresholds } from "@/features/leads/config";
import { leadFieldsSchema } from "@/features/leads/schemas";
import { validateLeadRules } from "@/features/leads/rules";
import { IMPORT_FIELDS, type ImportDefaults, type ImportEntity } from "@/features/imports/config";
import { accountNameKey, contactNameKey, identifierKey, matchOption, recordFromRow } from "@/features/imports/rules";
import {
  parseProgressValue,
  parseSourceDate,
  productKey,
  resolveLeadStatus,
  resolveProduct,
  resolveSector,
  type ProductRef,
  type UnrecognizedField,
  type ValueMap,
} from "@/features/imports/values";
import { normalizePhone } from "@/lib/phone";

// Analyse d'un fichier AVANT toute écriture : chaque ligne est normalisée, validée avec les MÊMES schémas que les
// formulaires, puis comparée aux données existantes et aux autres lignes du fichier. Fonctions pures : le contexte
// (comptes, contacts, responsables existants) est fourni par l'appelant.

export type SourceRow = { rowNumber: number; cells: string[] };

/** Valeur d'un fichier que le CRM ne reconnaît pas (secteur, produit) : l'administrateur la rapproche d'une valeur du CRM. */
export type Unrecognized = { field: UnrecognizedField; /** Clé de rapprochement (valeur normalisée). */ key: string; /** Valeur telle qu'écrite dans le fichier. */ value: string };

export type RowResult = {
  status: "valid" | "rejected" | "duplicate";
  /** Valeurs normalisées prêtes à être importées (statut « valid » uniquement). */
  parsed: Record<string, unknown> | null;
  errors: string[];
  /** Anomalies qui n'empêchent pas l'import (téléphone ignoré, produit inconnu avant qualification…). */
  warnings: string[];
  /** Valeurs non reconnues rencontrées sur la ligne, pour la table de correspondance du lot. */
  unrecognized: Unrecognized[];
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
  /** Lignes portant au moins un avertissement, et les avertissements les plus fréquents. */
  warningRows: number;
  warnings: { reason: string; count: number }[];
  /** Valeurs distinctes non reconnues, avec le nombre de lignes concernées (à rapprocher avant l'import). */
  unrecognized: { field: UnrecognizedField; key: string; value: string; count: number }[];
};

export type AccountContext = {
  /** E-mail (minuscules) → identifiant d'un utilisateur actif pouvant porter des comptes. */
  owners: ReadonlyMap<string, string>;
  existingByIdentifier: ReadonlyMap<string, string>;
  existingByName: ReadonlyMap<string, string>;
  /** Correspondances de valeurs choisies pour ce lot. */
  valueMap: ValueMap;
};

export type LeadContext = {
  owners: ReadonlyMap<string, string>;
  products: readonly ProductRef[];
  thresholds: LeadThresholds;
  valueMap: ValueMap;
  /** E-mail (minuscules) → « Entreprise — Prénom Nom » d'un prospect existant. */
  existingByEmail: ReadonlyMap<string, string>;
  /** Clé entreprise + prénom + nom → description d'un prospect existant. */
  existingByIdentity: ReadonlyMap<string, string>;
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

type Extras = { warnings?: string[]; unrecognized?: Unrecognized[] };

const rejected = (errors: string[], extras: Extras = {}): RowResult => ({
  status: "rejected",
  parsed: null,
  errors,
  warnings: extras.warnings ?? [],
  unrecognized: extras.unrecognized ?? [],
  duplicateOf: null,
  duplicateScope: null,
});
const duplicate = (of: string, scope: "database" | "file", extras: Extras = {}): RowResult => ({
  status: "duplicate",
  parsed: null,
  errors: [],
  warnings: extras.warnings ?? [],
  unrecognized: extras.unrecognized ?? [],
  duplicateOf: of,
  duplicateScope: scope,
});
const valid = (parsed: Record<string, unknown>, extras: Extras = {}): RowResult => ({
  status: "valid",
  parsed,
  errors: [],
  warnings: extras.warnings ?? [],
  unrecognized: extras.unrecognized ?? [],
  duplicateOf: null,
  duplicateScope: null,
});

/**
 * Téléphone FACULTATIF (comptes, contacts) : un numéro inexploitable (8 chiffres d'avant 2021, lettres…) n'empêche pas
 * l'import de la fiche. Il est ignoré et signalé, avec sa valeur d'origine, pour être corrigé dans la source.
 */
function optionalPhone(raw: string | undefined, warnings: string[]): string | undefined {
  if (!raw) return undefined;
  const result = normalizePhone(raw);
  if (result.ok) return result.value;
  warnings.push(`Téléphone : « ${raw} » non importé. ${result.message}`);
  return undefined;
}

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
  const warnings: string[] = [];
  const unrecognized: Unrecognized[] = [];
  const handled = new Set<string>();

  const sectorRaw = record.sector || defaults.sector || "";
  let sector: string | undefined;
  if (!sectorRaw) {
    errors.push("Secteur d'activité : obligatoire (colonne vide et aucun secteur par défaut).");
    handled.add("sector");
  } else {
    sector = resolveSector(sectorRaw, ctx.valueMap.sector) ?? undefined;
    if (!sector) {
      errors.push(`Secteur d'activité : « ${sectorRaw} » n'est pas dans la liste du CRM.`);
      unrecognized.push({ field: "sector", key: normalizeName(sectorRaw), value: sectorRaw });
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
    phone: optionalPhone(record.phone, warnings),
    emailDomain: record.emailDomain ? cleanDomain(record.emailDomain) : undefined,
    addressLine: record.addressLine,
    city: record.city,
    country,
  });
  if (!parsed.success) errors.push(...zodMessages("accounts", parsed.error, handled));

  return { errors, warnings, unrecognized, data: parsed.success ? parsed.data : null, ownerUserId };
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
    const { errors, warnings, unrecognized, data, ownerUserId } = normalizeAccount(recordFromRow(row.cells, headers, mapping), defaults, ctx);
    const extras = { warnings, unrecognized };
    if (errors.length > 0 || !data) {
      results.set(row.rowNumber, rejected(errors, extras));
      continue;
    }

    const idKey = data.legalIdentifier ? identifierKey(data.country, data.legalIdentifier) : null;
    const nameKey = accountNameKey(data.country, data.legalName);

    const inDatabase =
      (idKey && ctx.existingByIdentifier.has(idKey) && `Compte existant « ${ctx.existingByIdentifier.get(idKey)} » (même identifiant légal)`) ||
      (ctx.existingByName.has(nameKey) && `Compte existant « ${ctx.existingByName.get(nameKey)} » (même raison sociale)`);
    if (inDatabase) {
      results.set(row.rowNumber, duplicate(inDatabase, "database", extras));
      continue;
    }

    const firstRow = (idKey ? seenIdentifiers.get(idKey) : undefined) ?? seenNames.get(nameKey);
    if (firstRow !== undefined) {
      results.set(row.rowNumber, duplicate(`Ligne ${firstRow} du fichier`, "file", extras));
      continue;
    }

    if (idKey) seenIdentifiers.set(idKey, row.rowNumber);
    seenNames.set(nameKey, row.rowNumber);
    results.set(row.rowNumber, valid({ ...data, ownerUserId }, extras));
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
  const warnings: string[] = [];
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
    phone: optionalPhone(record.phone, warnings),
    status,
  });
  if (!parsed.success) errors.push(...zodMessages("contacts", parsed.error, handled));

  return { errors, warnings, data: parsed.success ? parsed.data : null, account, ownerUserId };
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
    const { errors, warnings, data, account, ownerUserId } = normalizeContact(recordFromRow(row.cells, headers, mapping), defaults, ctx);
    const extras = { warnings };
    if (errors.length > 0 || !data || !account) {
      results.set(row.rowNumber, rejected(errors, extras));
      continue;
    }

    const emailKey = data.email ? data.email.toLowerCase() : null;
    const nameKey = contactNameKey(account.id, data.firstName, data.lastName);

    const inDatabase =
      (emailKey && ctx.existingContactsByEmail.has(emailKey) && `Contact existant « ${ctx.existingContactsByEmail.get(emailKey)} » (même e-mail)`) ||
      (ctx.existingContactsByName.has(nameKey) && `Contact existant « ${ctx.existingContactsByName.get(nameKey)} » (même nom dans ce compte)`);
    if (inDatabase) {
      results.set(row.rowNumber, duplicate(inDatabase, "database", extras));
      continue;
    }

    const firstRow = (emailKey ? seenEmails.get(emailKey) : undefined) ?? seenNames.get(nameKey);
    if (firstRow !== undefined) {
      results.set(row.rowNumber, duplicate(`Ligne ${firstRow} du fichier`, "file", extras));
      continue;
    }

    if (emailKey) seenEmails.set(emailKey, row.rowNumber);
    seenNames.set(nameKey, row.rowNumber);
    results.set(row.rowNumber, valid({ ...data, accountId: account.id, ownerUserId }, extras));
  }
  return results;
}

// --- Prospects ---------------------------------------------------------------------------------------------------

/** Identité d'un prospect pour la détection de doublons : entreprise + prénom + nom (insensible à la casse et aux accents). */
export function leadIdentityKey(company: string, firstName: string, lastName: string): string {
  return `${normalizeName(company)}|${normalizeName(firstName)}|${normalizeName(lastName)}`;
}

/**
 * Normalise une ligne de prospect avec les MÊMES règles que la saisie manuelle (`leadFieldsSchema`, produit et chiffre
 * d'affaires exigés au-delà du seuil de qualification). Particularité de la migration : un prospect à 100 % est repris
 * comme GAGNÉ, la source valant confirmation du contrat signé et du premier paiement.
 */
function normalizeLead(record: Record<string, string>, defaults: ImportDefaults, ctx: LeadContext) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unrecognized: Unrecognized[] = [];
  const handled = new Set<string>();

  const sectorRaw = record.sector ?? "";
  let sector: string | undefined;
  if (!sectorRaw) {
    errors.push("Secteur d'activité : obligatoire (colonne vide).");
    handled.add("sector");
  } else {
    sector = resolveSector(sectorRaw, ctx.valueMap.sector) ?? undefined;
    if (!sector) {
      errors.push(`Secteur d'activité : « ${sectorRaw} » n'est pas dans la liste du CRM.`);
      unrecognized.push({ field: "sector", key: normalizeName(sectorRaw), value: sectorRaw });
      handled.add("sector");
    }
  }

  let insertedOn: string | undefined;
  if (!record.insertedOn) {
    errors.push("Date d'insertion : obligatoire.");
    handled.add("insertedOn");
  } else {
    insertedOn = parseSourceDate(record.insertedOn) ?? undefined;
    if (!insertedOn) {
      errors.push(`Date d'insertion : « ${record.insertedOn} » n'est pas une date reconnue (JJ/MM/AAAA ou AAAA-MM-JJ).`);
      handled.add("insertedOn");
    }
  }

  let progress: number | undefined;
  if (!record.progress) {
    errors.push("Process de vente : obligatoire.");
    handled.add("progress");
  } else {
    const value = parseProgressValue(record.progress);
    if (value === null) {
      errors.push(`Process de vente : « ${record.progress} » n'est pas un pourcentage.`);
      handled.add("progress");
    } else {
      progress = value;
    }
  }

  let productId: string | undefined;
  let productUnknown = false;
  if (record.productName) {
    const product = resolveProduct(record.productName, ctx.products, ctx.valueMap.product);
    if (product) {
      productId = product.id;
    } else {
      productUnknown = true;
      unrecognized.push({ field: "product", key: productKey(record.productName), value: record.productName });
      const message = `Produit : « ${record.productName} » n'est pas dans le catalogue du CRM.`;
      // Avant la qualification le produit est facultatif : la ligne reste importable, sans produit, avec un avertissement.
      if (progress !== undefined && progress > ctx.thresholds.qualifiedAbove) errors.push(message);
      else warnings.push(`${message} Le prospect est importé sans produit.`);
    }
  }

  let status: "open" | "won" | "lost" = progress === 100 ? "won" : "open";
  if (record.status) {
    const declared = resolveLeadStatus(record.status);
    if (!declared) errors.push(`Statut : « ${record.status} » n'est pas reconnu (Ouvert, Gagné, Perdu).`);
    else if (declared === "won" && progress !== undefined && progress !== 100) errors.push("Statut Gagné : le process de vente doit être à 100 %.");
    else if (declared !== "won" && progress === 100) errors.push(`Statut ${declared === "lost" ? "Perdu" : "Ouvert"} : incompatible avec un process de vente à 100 % (gagné).`);
    else if (declared) status = declared;
  }

  let lossReason: string | undefined;
  if (status === "lost") {
    lossReason = record.lossReason ? (matchOption(record.lossReason, LOSS_REASONS) ?? undefined) : undefined;
    if (!lossReason) errors.push(record.lossReason ? `Motif de perte : « ${record.lossReason} » n'est pas reconnu.` : "Motif de perte : obligatoire pour un prospect perdu.");
  } else if (record.lossReason) {
    warnings.push(`Motif de perte : « ${record.lossReason} » ignoré (le prospect n'est pas perdu).`);
  }

  const ownerUserId = resolveOwner(record, defaults, ctx.owners, errors);

  const parsed = leadFieldsSchema.safeParse({
    companyName: record.companyName,
    sector,
    contactLastName: record.contactLastName,
    contactFirstName: record.contactFirstName,
    phone: record.phone,
    email: record.email,
    jobTitle: record.jobTitle,
    insertedOn,
    progress,
    productId,
    expectedRevenue: record.expectedRevenue,
    wonConfirmed: progress === 100,
  });
  if (!parsed.success) errors.push(...zodMessages("leads", parsed.error, handled));

  if (parsed.success) {
    const ruleErrors = validateLeadRules(
      { progress: parsed.data.progress, productId: parsed.data.productId, expectedRevenue: parsed.data.expectedRevenue, wonConfirmed: parsed.data.wonConfirmed },
      ctx.thresholds,
    );
    for (const [key, messages] of Object.entries(ruleErrors ?? {})) {
      // Produit inconnu : déjà signalé avec sa valeur d'origine, inutile de répéter « produit obligatoire ».
      if (key === "productId" && productUnknown) continue;
      errors.push(`${key === "productId" ? "Produit proposé" : fieldLabel("leads", key)} : ${messages[0]}`);
    }
  }

  return { errors, warnings, unrecognized, data: parsed.success ? parsed.data : null, status, lossReason, ownerUserId, insertedOn };
}

/**
 * Analyse les lignes d'un fichier de prospects. Un doublon est un prospect dont l'e-mail existe déjà, ou qui a la même
 * identité (entreprise + prénom + nom), en base ou plus haut dans le fichier. Deux contacts différents d'une même
 * entreprise ne sont PAS des doublons.
 */
export function analyzeLeads(
  rows: SourceRow[],
  headers: string[],
  mapping: Record<string, string>,
  defaults: ImportDefaults,
  ctx: LeadContext,
): Map<number, RowResult> {
  const results = new Map<number, RowResult>();
  const seenEmails = new Map<string, number>();
  const seenIdentities = new Map<string, number>();

  for (const row of rows) {
    const { errors, warnings, unrecognized, data, status, lossReason, ownerUserId, insertedOn } = normalizeLead(recordFromRow(row.cells, headers, mapping), defaults, ctx);
    const extras = { warnings, unrecognized };
    if (errors.length > 0 || !data || !insertedOn) {
      results.set(row.rowNumber, rejected(errors, extras));
      continue;
    }

    const emailKey = data.email.toLowerCase();
    const identityKey = leadIdentityKey(data.companyName, data.contactFirstName, data.contactLastName);

    const inDatabase =
      (ctx.existingByEmail.has(emailKey) && `Prospect existant « ${ctx.existingByEmail.get(emailKey)} » (même e-mail)`) ||
      (ctx.existingByIdentity.has(identityKey) && `Prospect existant « ${ctx.existingByIdentity.get(identityKey)} » (même entreprise et même contact)`);
    if (inDatabase) {
      results.set(row.rowNumber, duplicate(inDatabase, "database", extras));
      continue;
    }

    const firstRow = seenEmails.get(emailKey) ?? seenIdentities.get(identityKey);
    if (firstRow !== undefined) {
      results.set(row.rowNumber, duplicate(`Ligne ${firstRow} du fichier`, "file", extras));
      continue;
    }

    seenEmails.set(emailKey, row.rowNumber);
    seenIdentities.set(identityKey, row.rowNumber);
    results.set(
      row.rowNumber,
      valid(
        {
          companyName: data.companyName,
          sector: data.sector,
          contactLastName: data.contactLastName,
          contactFirstName: data.contactFirstName,
          phone: data.phone,
          email: data.email,
          jobTitle: data.jobTitle,
          // Texte « AAAA-MM-JJ » : le lot est stocké en JSON, où une date perdrait son type.
          insertedOn,
          progress: data.progress,
          status,
          productId: data.productId,
          expectedRevenue: data.expectedRevenue,
          lossReason,
          ownerUserId,
        },
        extras,
      ),
    );
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

  // Avertissements : regroupés par nature (le début du message, avant la valeur citée), pour rester lisibles à grande échelle.
  const warningCounts = new Map<string, number>();
  for (const result of all) for (const warning of result.warnings) warningCounts.set(warning, (warningCounts.get(warning) ?? 0) + 1);

  // Valeurs non reconnues : une entrée par valeur distincte, avec le nombre de lignes concernées.
  const unrecognizedCounts = new Map<string, { field: UnrecognizedField; key: string; value: string; count: number }>();
  for (const result of all) {
    for (const item of result.unrecognized) {
      const id = `${item.field}|${item.key}`;
      const known = unrecognizedCounts.get(id);
      if (known) known.count += 1;
      else unrecognizedCounts.set(id, { ...item, count: 1 });
    }
  }

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
    warningRows: all.filter((result) => result.warnings.length > 0).length,
    warnings: [...warningCounts]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    unrecognized: [...unrecognizedCounts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr")).slice(0, 100),
  };
}
