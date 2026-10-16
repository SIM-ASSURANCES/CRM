import { parseSourceDate } from "@/features/imports/values";
import { normalizePhone } from "@/lib/phone";

// Inventaire d'une source (phase 7 : « inventaire des sources, volumes, qualité ») : ce que contient le fichier AVANT
// de décider du mapping. Calculé une fois au dépôt, à partir des seules cellules du fichier. Fonction pure.

export type ColumnKind = "empty" | "number" | "date" | "email" | "phone" | "text";

export type ColumnProfile = {
  header: string;
  /** Cellules renseignées (non vides). */
  filled: number;
  distinct: number;
  /** Type probable : celui que partagent au moins 80 % des cellules renseignées. */
  kind: ColumnKind;
  /** Valeurs les plus fréquentes (5 au plus ; 3 quand la colonne est très variée) avec leur nombre d'occurrences. */
  top: { value: string; count: number }[];
};

export type SourceProfile = {
  rows: number;
  /** Lignes strictement identiques à une ligne plus haut dans le fichier. */
  duplicateRows: number;
  columns: ColumnProfile[];
};

const KIND_THRESHOLD = 0.8;
const MAX_VALUE_LENGTH = 80;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER = /^-?\d[\d\s.,]*$/;

function detectKind(values: readonly string[]): ColumnKind {
  if (values.length === 0) return "empty";
  const share = (test: (value: string) => boolean) => values.filter(test).length / values.length;

  if (share((value) => EMAIL.test(value)) >= KIND_THRESHOLD) return "email";
  if (share((value) => parseSourceDate(value) !== null) >= KIND_THRESHOLD) return "date";
  // Un téléphone ressemble à un nombre : on le reconnaît d'abord (numéro complet, ou numéro ivoirien à 8 chiffres).
  const phoneLike = (value: string) => {
    const result = normalizePhone(value);
    return result.ok || result.reason === "legacy";
  };
  if (share((value) => /^[+0\d]/.test(value) && phoneLike(value)) >= KIND_THRESHOLD) return "phone";
  if (share((value) => NUMBER.test(value)) >= KIND_THRESHOLD) return "number";
  return "text";
}

export function profileSource(headers: readonly string[], rows: readonly { cells: readonly string[] }[]): SourceProfile {
  const columns: ColumnProfile[] = headers.map((header, index) => {
    const counts = new Map<string, number>();
    const filledValues: string[] = [];
    for (const row of rows) {
      const value = (row.cells[index] ?? "").trim();
      if (value === "") continue;
      filledValues.push(value);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const top = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))
      .slice(0, counts.size > 50 ? 3 : 5)
      .map(([value, count]) => ({ value: value.slice(0, MAX_VALUE_LENGTH), count }));
    return { header, filled: filledValues.length, distinct: counts.size, kind: detectKind(filledValues), top };
  });

  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    const key = row.cells.map((cell) => cell.trim().toLowerCase()).join("\u0001");
    if (key.replaceAll("\u0001", "") === "") continue;
    if (seen.has(key)) duplicateRows += 1;
    else seen.add(key);
  }
  return { rows: rows.length, duplicateRows, columns };
}
