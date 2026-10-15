import { normalizeName } from "@/features/accounts/rules";
import type { ImportField } from "@/features/imports/config";

// Règles pures de l'import (sans accès base) : association des colonnes et reconnaissance des valeurs.

/** « Raison sociale », « RAISON_SOCIALE » et « raison-sociale » deviennent la même clé de comparaison. */
export function normalizeHeader(value: string): string {
  return normalizeName(value);
}

/**
 * Propose l'association « champ du CRM → colonne du fichier » : d'abord sur l'intitulé exact du champ, puis sur ses
 * synonymes usuels. Une colonne n'est proposée qu'une fois. L'utilisateur garde toujours la main pour corriger.
 */
export function suggestMapping(headers: string[], fields: ImportField[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const find = (candidates: string[]) =>
    headers.find((header) => !used.has(header) && candidates.includes(normalizeHeader(header)));

  for (const pass of ["label", "alias"] as const) {
    for (const field of fields) {
      if (mapping[field.key]) continue;
      const candidates =
        pass === "label"
          ? [normalizeHeader(field.label), normalizeHeader(field.key)]
          : field.aliases.map(normalizeHeader);
      const header = find(candidates);
      if (header) {
        mapping[field.key] = header;
        used.add(header);
      }
    }
  }
  return mapping;
}

/** Reconnaît une valeur saisie librement (« client », « Côte d Ivoire », « ci ») parmi les options d'une liste contrôlée. */
export function matchOption(value: string, options: readonly { code: string; label: string }[]): string | null {
  const key = normalizeName(value);
  if (key === "") return null;
  return options.find((option) => normalizeName(option.code) === key || normalizeName(option.label) === key)?.code ?? null;
}

/** Cellules d'une ligne → valeurs par champ du CRM, d'après l'association choisie. Une colonne absente donne « ». */
export function recordFromRow(cells: string[], headers: string[], mapping: Record<string, string>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    const index = headers.indexOf(header);
    record[field] = index >= 0 ? (cells[index] ?? "").trim() : "";
  }
  return record;
}

/** Clé de comparaison d'un identifiant légal (insensible à la casse et aux espaces superflus). */
export function identifierKey(country: string, identifier: string): string {
  return `${country}|${identifier.trim().toLowerCase().replace(/\s+/g, "")}`;
}

export function accountNameKey(country: string, legalName: string): string {
  return `${country}|${normalizeName(legalName)}`;
}

export function contactNameKey(accountId: string, firstName: string, lastName: string): string {
  return `${accountId}|${normalizeName(firstName)}|${normalizeName(lastName)}`;
}

export type MappingProblems = { missingRequired: string[]; unknownHeaders: string[]; unknownFields: string[] };

/** Vérifie une association : champs obligatoires couverts, colonnes existantes, champs connus. */
export function checkMapping(
  mapping: Record<string, string>,
  headers: string[],
  fields: ImportField[],
  defaults: { sector?: string },
): MappingProblems {
  const known = new Set(fields.map((field) => field.key));
  return {
    missingRequired: fields
      .filter((field) => field.required && !mapping[field.key] && !(field.key === "sector" && defaults.sector))
      .map((field) => field.label),
    unknownHeaders: Object.values(mapping).filter((header) => header && !headers.includes(header)),
    unknownFields: Object.keys(mapping).filter((key) => !known.has(key)),
  };
}
