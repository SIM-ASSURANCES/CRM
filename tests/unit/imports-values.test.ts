import { describe, expect, it } from "vitest";
import { profileSource } from "@/features/imports/profile";
import { parseProgressValue, parseSourceDate, productKey, resolveLeadStatus, resolveProduct, resolveSector } from "@/features/imports/values";

// Reconnaissance des valeurs d'un fichier de migration (phase 7) : secteurs, produits, dates, pourcentages, statuts, inventaire.

const products = [
  { id: "p1", code: "secur-maison", label: "SECUR Maison" },
  { id: "p2", code: "secur-maison-plus", label: "SECUR Maison+" },
  { id: "p3", code: "relax-sante", label: "RELAX Santé" },
  { id: "p4", code: "relax-auto", label: "RELAX Auto" },
];

describe("secteurs", () => {
  it("reconnaît le libellé exact, sans tenir compte de la casse ni des accents", () => {
    expect(resolveSector("Santé")).toBe("Santé");
    expect(resolveSector("SANTE")).toBe("Santé");
    expect(resolveSector("  éducation ")).toBe("Éducation");
    expect(resolveSector("banque et finance")).toBe("Banque et finance");
  });

  it("rapproche les variantes courantes", () => {
    expect(resolveSector("Assurances")).toBe("Assurance");
    expect(resolveSector("BTP")).toBe("BTP et immobilier");
    expect(resolveSector("Télécoms")).toBe("Télécommunications et numérique");
    expect(resolveSector("Hôtellerie")).toBe("Hôtellerie et restauration");
    expect(resolveSector("ONG")).toBe("Administration et ONG");
  });

  it("ne devine pas une valeur inconnue ou vide", () => {
    expect(resolveSector("Vente de bijoux")).toBeNull();
    expect(resolveSector("")).toBeNull();
    expect(resolveSector("   ")).toBeNull();
  });

  it("applique en priorité la correspondance choisie par l'administrateur, mais seulement vers un secteur du CRM", () => {
    expect(resolveSector("Vente de bijoux", { ventedebijoux: "Commerce et distribution" })).toBe("Commerce et distribution");
    expect(resolveSector("BTP", { btp: "Industrie" })).toBe("Industrie");
    expect(resolveSector("Vente de bijoux", { ventedebijoux: "Secteur inventé" })).toBeNull();
  });
});

describe("produits", () => {
  it("distingue SECUR Maison de SECUR Maison+ (« + » compte)", () => {
    expect(productKey("SECUR Maison")).not.toBe(productKey("SECUR Maison+"));
    expect(resolveProduct("SECUR Maison", products)?.id).toBe("p1");
    expect(resolveProduct("SECUR Maison+", products)?.id).toBe("p2");
    expect(resolveProduct("secur maison plus", products)?.id).toBe("p2");
  });

  it("reconnaît le code, le libellé, la casse et les accents", () => {
    expect(resolveProduct("relax-sante", products)?.id).toBe("p3");
    expect(resolveProduct("RELAX SANTE", products)?.id).toBe("p3");
    expect(resolveProduct("Relax  Auto", products)?.id).toBe("p4");
  });

  it("ne devine pas un produit inconnu ; la correspondance du lot désigne un produit par son code", () => {
    expect(resolveProduct("Assurance auto", products)).toBeNull();
    expect(resolveProduct("", products)).toBeNull();
    expect(resolveProduct("Assurance auto", products, { [productKey("Assurance auto")]: "relax-auto" })?.id).toBe("p4");
    expect(resolveProduct("Assurance auto", products, { [productKey("Assurance auto")]: "code-inexistant" })).toBeNull();
  });
});

describe("dates", () => {
  it("lit les formats usuels", () => {
    expect(parseSourceDate("2026-10-13")).toBe("2026-10-13");
    expect(parseSourceDate("2026-10-13T08:30:00.000Z")).toBe("2026-10-13");
    expect(parseSourceDate("13/10/2026")).toBe("2026-10-13");
    expect(parseSourceDate("13-10-2026")).toBe("2026-10-13");
    expect(parseSourceDate("13.10.2026")).toBe("2026-10-13");
    expect(parseSourceDate("3/1/2026")).toBe("2026-01-03");
    expect(parseSourceDate("13/10/26")).toBe("2026-10-13");
    expect(parseSourceDate("13/10/2026 14:05")).toBe("2026-10-13");
  });

  it("refuse une date qui n'existe pas au calendrier : JJ/MM, jamais MM/JJ deviné", () => {
    for (const raw of ["31/02/2026", "13/13/2026", "00/10/2026", "2026-02-30", "n'importe quoi", "", "10/2026", "46000"]) {
      expect(parseSourceDate(raw), raw).toBeNull();
    }
    expect(parseSourceDate("29/02/2028")).toBe("2028-02-29");
    expect(parseSourceDate("29/02/2027")).toBeNull();
  });
});

describe("process de vente et statut", () => {
  it("lit un pourcentage écrit de plusieurs façons", () => {
    expect(parseProgressValue("40")).toBe(40);
    expect(parseProgressValue("40 %")).toBe(40);
    expect(parseProgressValue("40%")).toBe(40);
    expect(parseProgressValue("0,4")).toBe(40);
    expect(parseProgressValue("0.9")).toBe(90);
    expect(parseProgressValue("100")).toBe(100);
    expect(parseProgressValue("1")).toBe(1);
    expect(parseProgressValue("beaucoup")).toBeNull();
    expect(parseProgressValue("")).toBeNull();
    expect(parseProgressValue("-10")).toBeNull();
  });

  it("reconnaît les statuts d'un prospect", () => {
    expect(resolveLeadStatus("Gagné")).toBe("won");
    expect(resolveLeadStatus("gagnee")).toBe("won");
    expect(resolveLeadStatus("Perdu")).toBe("lost");
    expect(resolveLeadStatus("en cours")).toBe("open");
    expect(resolveLeadStatus("Ouvert")).toBe("open");
    expect(resolveLeadStatus("bof")).toBeNull();
    expect(resolveLeadStatus("")).toBeNull();
  });
});

describe("inventaire de la source", () => {
  const headers = ["Entreprise", "Date", "E-mail", "Tel", "CA", "Secteur"];
  const rows = [
    { cells: ["Alpha", "13/10/2026", "a@alpha.ci", "01 02 03 04 05", "1 200 000", "Santé"] },
    { cells: ["Béta", "12/10/2026", "b@beta.ci", "07 35 36 73", "800 000", "Santé"] },
    { cells: ["Gamma", "11/10/2026", "g@gamma.ci", "+225 05 05 05 05 05", "", "BTP"] },
    { cells: ["Alpha", "13/10/2026", "a@alpha.ci", "01 02 03 04 05", "1 200 000", "Santé"] },
    { cells: ["", "", "", "", "", ""] },
  ];
  const profile = profileSource(headers, rows);

  it("compte les lignes, les renseignements et les valeurs distinctes", () => {
    expect(profile.rows).toBe(5);
    const byHeader = Object.fromEntries(profile.columns.map((column) => [column.header, column]));
    expect(byHeader.Entreprise).toMatchObject({ filled: 4, distinct: 3 });
    expect(byHeader.CA).toMatchObject({ filled: 3, distinct: 2 });
    expect(byHeader.Secteur.top[0]).toEqual({ value: "Santé", count: 3 });
  });

  it("devine le type probable de chaque colonne, y compris un numéro à 8 chiffres", () => {
    const kinds = Object.fromEntries(profile.columns.map((column) => [column.header, column.kind]));
    expect(kinds).toEqual({ Entreprise: "text", Date: "date", "E-mail": "email", Tel: "phone", CA: "number", Secteur: "text" });
  });

  it("repère les lignes identiques à une ligne plus haut, sans compter les lignes vides", () => {
    expect(profile.duplicateRows).toBe(1);
  });

  it("signale une colonne entièrement vide", () => {
    const empty = profileSource(["A", "B"], [{ cells: ["x", ""] }, { cells: ["y", ""] }]);
    expect(empty.columns[1]).toMatchObject({ kind: "empty", filled: 0, distinct: 0, top: [] });
  });
});
