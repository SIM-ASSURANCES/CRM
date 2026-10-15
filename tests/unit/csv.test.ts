import { describe, expect, it } from "vitest";
import { detectDelimiter, guardFormula, parseCsv, toCsv } from "@/lib/csv";

describe("lecture CSV", () => {
  it("devine le séparateur d'après la première ligne", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("seule colonne")).toBe(";");
  });

  it("ignore les séparateurs placés entre guillemets pour deviner le séparateur", () => {
    expect(detectDelimiter('"a;b;c",d,e\n1,2,3')).toBe(",");
  });

  it("lit des lignes simples, avec CRLF et BOM", () => {
    expect(parseCsv("﻿nom;ville\r\nAlpha;Abidjan\r\nBéta;Bouaké\r\n")).toEqual([
      ["nom", "ville"],
      ["Alpha", "Abidjan"],
      ["Béta", "Bouaké"],
    ]);
  });

  it("lit les champs entre guillemets : séparateur, guillemets doublés et retours à la ligne", () => {
    const rows = parseCsv('nom;note\n"Dupont; fils";"Il a dit ""oui"""\n"Multi";"ligne 1\nligne 2"');
    expect(rows[1]).toEqual(["Dupont; fils", 'Il a dit "oui"']);
    expect(rows[2]).toEqual(["Multi", "ligne 1\nligne 2"]);
  });

  it("garde les cellules vides et les lignes vides (les numéros de ligne restent ceux du tableur)", () => {
    expect(parseCsv("a;b;c\n1;;3\n\n4;5;6")).toEqual([["a", "b", "c"], ["1", "", "3"], [""], ["4", "5", "6"]]);
  });

  it("lit un dernier enregistrement sans fin de ligne", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("écriture CSV", () => {
  it("écrit pour Excel : BOM, séparateur « ; » et CRLF", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("﻿a;b\r\n1;2\r\n");
  });

  it("met entre guillemets ce qui contient un séparateur, un guillemet ou un retour à la ligne", () => {
    expect(toCsv([["x;y", 'dit "oui"', "a\nb"]])).toBe('﻿"x;y";"dit ""oui""";"a\nb"\r\n');
  });

  it("conserve les nombres, dates et valeurs vides", () => {
    expect(toCsv([[12, true, null, undefined, new Date(Date.UTC(2026, 0, 5))]])).toBe("﻿12;true;;;2026-01-05T00:00:00.000Z\r\n");
  });

  it("neutralise l'injection de formule dans les textes", () => {
    expect(guardFormula("=SOMME(A1:A9)")).toBe("'=SOMME(A1:A9)");
    expect(guardFormula("+33 1 02 03")).toBe("'+33 1 02 03");
    expect(guardFormula("-cmd")).toBe("'-cmd");
    expect(guardFormula("@import")).toBe("'@import");
    expect(guardFormula("Société normale")).toBe("Société normale");
    expect(toCsv([['=HYPERLINK("http://x")']])).toContain("'=HYPERLINK");
  });

  it("ne modifie pas un nombre négatif transmis comme nombre", () => {
    expect(toCsv([[-5]])).toBe("﻿-5\r\n");
    // Option « virgule décimale » (exports de reporting) : désactivée par défaut, et un négatif reste un nombre.
    expect(toCsv([[1234.5, -1500.25, 12, "texte 1.5"]])).toBe("﻿1234.5;-1500.25;12;texte 1.5\r\n");
    expect(toCsv([[1234.5, -1500.25, 12, "texte 1.5"]], ";", { decimalComma: true })).toBe("﻿1234,5;-1500,25;12;texte 1.5\r\n");
  });

  it("relit ce qu'il écrit", () => {
    const rows = [["Raison sociale", "Note"], ["Alpha; Cie", 'a "b"\nc']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
