import writeExcelFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS } from "@/features/imports/config";
import { parseSpreadsheet } from "@/features/imports/parse";

const csv = (text: string) => Buffer.from(text, "utf8");

describe("lecture d'un CSV", () => {
  it("lit les en-têtes et les lignes, en conservant le numéro de ligne du tableur", async () => {
    const parsed = await parseSpreadsheet(csv("Nom;Ville\nAlpha;Abidjan\n;\nBéta;Bouaké\n"), "comptes.csv");
    expect(parsed.headers).toEqual(["Nom", "Ville"]);
    // La ligne 3 est vide : elle est ignorée, mais la ligne de Béta reste la ligne 4.
    expect(parsed.rows).toEqual([
      { rowNumber: 2, cells: ["Alpha", "Abidjan"] },
      { rowNumber: 4, cells: ["Béta", "Bouaké"] },
    ]);
  });

  it("décode un CSV Windows-1252 enregistré par un Excel français", async () => {
    const parsed = await parseSpreadsheet(Buffer.from("Société;Ville\nÉlan;Bouaké\n", "latin1"), "ansi.csv");
    expect(parsed.headers[0]).toBe("Société");
    expect(parsed.rows[0].cells).toEqual(["Élan", "Bouaké"]);
  });

  it("nomme les colonnes sans titre et distingue les titres en double", async () => {
    const parsed = await parseSpreadsheet(csv("Nom;;Nom\nA;B;C\n"), "x.csv");
    expect(parsed.headers).toEqual(["Nom", "Colonne 2", "Nom (2)"]);
  });

  it("ignore les colonnes vides en fin d'en-tête et complète les lignes trop courtes", async () => {
    const parsed = await parseSpreadsheet(csv("A;B;;\n1\n"), "x.csv");
    expect(parsed.headers).toEqual(["A", "B"]);
    expect(parsed.rows[0].cells).toEqual(["1", ""]);
  });

  it("refuse un fichier vide, sans données, trop volumineux ou binaire", async () => {
    await expect(parseSpreadsheet(Buffer.alloc(0), "x.csv")).rejects.toMatchObject({ message: "Le fichier est vide." });
    await expect(parseSpreadsheet(csv("Nom;Ville\n"), "x.csv")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(parseSpreadsheet(csv("\n\n"), "x.csv")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(parseSpreadsheet(Buffer.from([0x4e, 0x00, 0x01, 0x02]), "x.csv")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(parseSpreadsheet(Buffer.alloc(6 * 1024 * 1024, 65), "x.csv")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse un fichier de plus de lignes que la limite, en expliquant comment faire", async () => {
    const lines = ["Nom", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Société ${i}`)];
    await expect(parseSpreadsheet(csv(lines.join("\n")), "gros.csv")).rejects.toMatchObject({
      message: expect.stringContaining("Découpez-le"),
    });
  });

  it("accepte exactement la limite", async () => {
    const lines = ["Nom", ...Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `Société ${i}`)];
    expect((await parseSpreadsheet(csv(lines.join("\n")), "limite.csv")).rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("tronque une cellule démesurée", async () => {
    const parsed = await parseSpreadsheet(csv(`Note\n${"x".repeat(5000)}\n`), "x.csv");
    expect(parsed.rows[0].cells[0]).toHaveLength(2000);
  });
});

describe("contrôle du format", () => {
  it("refuse un format inconnu et l'ancien .xls", async () => {
    await expect(parseSpreadsheet(csv("a"), "x.pdf")).rejects.toMatchObject({ message: expect.stringContaining(".csv ou .xlsx") });
    await expect(parseSpreadsheet(csv("a"), "x.xls")).rejects.toMatchObject({ message: expect.stringContaining(".xls") });
  });

  it("ne se fie pas à l'extension : un faux .xlsx est refusé", async () => {
    await expect(parseSpreadsheet(csv("Nom;Ville\nA;B"), "faux.xlsx")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse un .xlsx corrompu (signature correcte, contenu invalide)", async () => {
    await expect(parseSpreadsheet(Buffer.from("PK\x03\x04 pas vraiment une archive"), "casse.xlsx")).rejects.toMatchObject({
      message: expect.stringContaining("illisible"),
    });
  });
});

describe("lecture d'un XLSX", () => {
  it("lit un vrai classeur : textes, nombres, dates et cellules vides", async () => {
    const buffer = await writeExcelFile([
      [{ value: "Raison sociale" }, { value: "Effectif" }, { value: "Créée le" }, { value: "Ville" }],
      [{ value: "Société Alpha" }, { value: 250, type: Number }, { value: new Date(Date.UTC(2026, 0, 5)), type: Date, format: "dd/mm/yyyy" }, { value: "Abidjan" }],
      [{ value: "Béta" }, { value: "12" }, { value: "" }, { value: "Bouaké" }],
    ]).toBuffer();

    const parsed = await parseSpreadsheet(buffer, "comptes.xlsx");
    expect(parsed.headers).toEqual(["Raison sociale", "Effectif", "Créée le", "Ville"]);
    expect(parsed.rows).toEqual([
      { rowNumber: 2, cells: ["Société Alpha", "250", "2026-01-05", "Abidjan"] },
      { rowNumber: 3, cells: ["Béta", "12", "", "Bouaké"] },
    ]);
  });
});
