import "server-only";
import { readSheet } from "read-excel-file/node";
import { MAX_CELL_LENGTH, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/features/imports/config";
import type { SourceRow } from "@/features/imports/analysis";
import { parseCsv } from "@/lib/csv";
import { errors } from "@/lib/errors";

// Lecture d'un fichier déposé (CSV ou XLSX) → en-têtes et lignes de texte. Le fichier vient d'un navigateur : on ne se
// fie ni à son nom, ni à son type annoncé. Format vérifié sur le contenu, taille et nombre de lignes bornés.

export type ParsedFile = { headers: string[]; rows: SourceRow[] };

function cellToText(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (value instanceof Date) text = value.toISOString().slice(0, 10);
  else if (typeof value === "boolean") text = value ? "Oui" : "Non";
  else text = String(value);
  return text.trim().slice(0, MAX_CELL_LENGTH);
}

/** Texte CSV : UTF-8, ou Windows-1252 quand le fichier vient d'un Excel français enregistré en « CSV » simple. */
function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** Matrice de cellules → en-têtes uniques + lignes non vides (le numéro de ligne reste celui du tableur). */
function toParsedFile(matrix: unknown[][]): ParsedFile {
  const first = (matrix[0] ?? []).map(cellToText);
  // Les colonnes vides en fin de ligne d'en-tête ne comptent pas.
  while (first.length > 0 && first[first.length - 1] === "") first.pop();
  if (first.length === 0) throw errors.validation("La première ligne du fichier doit contenir les en-têtes de colonnes.");

  const seen = new Map<string, number>();
  const headers = first.map((header, index) => {
    const base = header || `Colonne ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });

  const rows: SourceRow[] = [];
  matrix.slice(1).forEach((line, index) => {
    const cells = headers.map((_, column) => cellToText(line[column]));
    if (cells.every((cell) => cell === "")) return;
    rows.push({ rowNumber: index + 2, cells });
  });

  if (rows.length === 0) throw errors.validation("Le fichier ne contient aucune ligne de données sous les en-têtes.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw errors.validation(`Le fichier contient ${rows.length} lignes : la limite est de ${MAX_IMPORT_ROWS} par import. Découpez-le en plusieurs fichiers.`);
  }
  return { headers, rows };
}

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedFile> {
  if (buffer.length === 0) throw errors.validation("Le fichier est vide.");
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw errors.validation(`Le fichier dépasse ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} Mo.`);
  }

  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "xls") {
    throw errors.validation("Le format .xls (Excel ancien) n'est pas pris en charge : enregistrez le fichier en .xlsx ou en .csv.");
  }

  if (extension === "xlsx") {
    // Un .xlsx est une archive ZIP : sa signature commence par « PK ».
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw errors.validation("Ce fichier n'est pas un classeur .xlsx valide.");
    // Seule la lecture du classeur est protégée : les erreurs de validation métier de toParsedFile restent visibles.
    let matrix: unknown[][];
    try {
      matrix = await readSheet(buffer);
    } catch {
      throw errors.validation("Le classeur .xlsx est illisible ou corrompu.");
    }
    return toParsedFile(matrix);
  }

  if (extension === "csv" || extension === "txt") {
    // Un octet nul trahit un fichier binaire renommé en .csv.
    if (buffer.includes(0)) throw errors.validation("Ce fichier n'est pas un CSV valide (contenu binaire).");
    return toParsedFile(parseCsv(decodeCsv(buffer)));
  }

  throw errors.validation("Format non pris en charge : déposez un fichier .csv ou .xlsx.");
}
