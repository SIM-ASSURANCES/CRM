// Lecture et écriture CSV, sans dépendance. Pensé pour Excel en français : séparateur « ; », BOM UTF-8, CRLF.

export type Delimiter = ";" | "," | "\t";

/**
 * Devine le séparateur d'après la première ligne (hors guillemets) : Excel français écrit « ; », les exports anglais
 * « , », les copier-coller « tabulation ». À égalité, « ; ».
 */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of text.replace(/^﻿/, "")) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && char in counts) counts[char as Delimiter] += 1;
  }
  if (counts[";"] >= counts[","] && counts[";"] >= counts["\t"]) return ";";
  return counts[","] >= counts["\t"] ? "," : "\t";
}

/**
 * Lit un texte CSV : champs entre guillemets (avec guillemets doublés), retours à la ligne dans un champ, fins de
 * ligne CRLF ou LF, BOM ignoré. Chaque enregistrement devient une ligne de cellules ; les lignes vides sont conservées
 * (le numéro d'une ligne doit rester celui que l'utilisateur voit dans son tableur).
 */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const source = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\r") {
      if (source[i + 1] === "\n") i += 1;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      cell += char;
    }
  }
  // Dernier enregistrement sans fin de ligne.
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Neutralise l'« injection de formule » : un texte commençant par = + - @ (ou une tabulation) serait exécuté comme une
 * formule à l'ouverture dans Excel. On le préfixe d'une apostrophe, qui reste invisible dans le tableur.
 */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export type CsvCell = string | number | boolean | Date | null | undefined;

function formatCell(value: CsvCell, decimalComma: boolean): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  // Les nombres ne passent jamais par guardFormula : un écart négatif (« -1500 ») reste un nombre, pas du texte quoté.
  if (typeof value === "number") return decimalComma ? String(value).replace(".", ",") : String(value);
  if (typeof value === "boolean") return String(value);
  return guardFormula(value);
}

/**
 * Écrit un CSV pour Excel : BOM UTF-8, séparateur « ; », guillemets si nécessaire, fins de ligne CRLF.
 * `decimalComma` écrit les nombres avec une virgule décimale (« 1234,5 »), que l'Excel français lit comme un nombre.
 */
export function toCsv(rows: CsvCell[][], delimiter: Delimiter = ";", options: { decimalComma?: boolean } = {}): string {
  const decimalComma = options.decimalComma ?? false;
  const quote = (cell: string) =>
    cell.includes(delimiter) || cell.includes('"') || cell.includes("\n") || cell.includes("\r") ? `"${cell.replace(/"/g, '""')}"` : cell;
  return `﻿${rows.map((row) => row.map((cell) => quote(formatCell(cell, decimalComma))).join(delimiter)).join("\r\n")}\r\n`;
}
