import { describe, expect, it } from "vitest";
import { IMPORT_FIELDS, templateRows } from "@/features/imports/config";
import {
  accountNameKey,
  checkMapping,
  contactNameKey,
  identifierKey,
  matchOption,
  recordFromRow,
  suggestMapping,
} from "@/features/imports/rules";

describe("association automatique des colonnes", () => {
  const fields = IMPORT_FIELDS.accounts;

  it("reconnaît les intitulés exacts malgré accents, casse et ponctuation", () => {
    const mapping = suggestMapping(["RAISON SOCIALE", "Secteur d'activité", "Téléphone", "Ville"], fields);
    expect(mapping).toMatchObject({
      legalName: "RAISON SOCIALE",
      sector: "Secteur d'activité",
      phone: "Téléphone",
      city: "Ville",
    });
  });

  it("reconnaît les synonymes usuels", () => {
    const mapping = suggestMapping(["Entreprise", "RCCM", "Nb salariés", "Tel", "CA"], fields);
    expect(mapping.legalName).toBe("Entreprise");
    expect(mapping.legalIdentifier).toBe("RCCM");
    expect(mapping.phone).toBe("Tel");
    expect(mapping.revenueAmount).toBe("CA");
  });

  it("n'associe jamais deux champs à la même colonne", () => {
    const mapping = suggestMapping(["Entreprise"], IMPORT_FIELDS.contacts);
    expect(Object.values(mapping).filter((header) => header === "Entreprise")).toHaveLength(1);
  });

  it("ne propose rien pour une colonne inconnue", () => {
    expect(suggestMapping(["Colonne X"], fields)).toEqual({});
  });

  it("associe d'abord l'intitulé exact avant les synonymes", () => {
    const mapping = suggestMapping(["Nom", "Prénom"], IMPORT_FIELDS.contacts);
    expect(mapping.lastName).toBe("Nom");
    expect(mapping.firstName).toBe("Prénom");
  });
});

describe("reconnaissance des valeurs", () => {
  const options = [
    { code: "CI", label: "Côte d'Ivoire" },
    { code: "SN", label: "Sénégal" },
  ];

  it("reconnaît le code ou le libellé, sans tenir compte des accents ni de la casse", () => {
    expect(matchOption("ci", options)).toBe("CI");
    expect(matchOption("COTE D IVOIRE", options)).toBe("CI");
    expect(matchOption("Sénégal", options)).toBe("SN");
    expect(matchOption("senegal", options)).toBe("SN");
  });

  it("ne devine pas : une valeur inconnue ou vide n'est pas reconnue", () => {
    expect(matchOption("Ivoire", options)).toBeNull();
    expect(matchOption("", options)).toBeNull();
    expect(matchOption("  ", options)).toBeNull();
  });
});

describe("lecture d'une ligne", () => {
  const headers = ["Nom", "Ville", "Tel"];

  it("range les cellules par champ du CRM d'après l'association", () => {
    expect(recordFromRow([" Alpha ", "Abidjan", ""], headers, { legalName: "Nom", city: "Ville", phone: "Tel" })).toEqual({
      legalName: "Alpha",
      city: "Abidjan",
      phone: "",
    });
  });

  it("ignore un champ non associé et une colonne introuvable", () => {
    expect(recordFromRow(["A", "B", "C"], headers, { legalName: "Nom", city: "", phone: "Absente" })).toEqual({
      legalName: "A",
      phone: "",
    });
  });
});

describe("clés de comparaison", () => {
  it("compare les identifiants sans tenir compte de la casse ni des espaces", () => {
    expect(identifierKey("CI", " ci-abj 2020 b 1 ")).toBe(identifierKey("CI", "CI-ABJ2020B1"));
    expect(identifierKey("CI", "X1")).not.toBe(identifierKey("SN", "X1"));
  });

  it("compare les raisons sociales sans accents ni ponctuation, à pays égal", () => {
    expect(accountNameKey("CI", "Société Générale d'Électricité")).toBe(accountNameKey("CI", "SOCIETE GENERALE D ELECTRICITE"));
    expect(accountNameKey("CI", "Alpha")).not.toBe(accountNameKey("SN", "Alpha"));
  });

  it("distingue deux contacts de même nom dans des comptes différents", () => {
    expect(contactNameKey("a1", "Awa", "Koné")).toBe(contactNameKey("a1", "AWA", "kone"));
    expect(contactNameKey("a1", "Awa", "Koné")).not.toBe(contactNameKey("a2", "Awa", "Koné"));
  });
});

describe("vérification de l'association", () => {
  const headers = ["Nom", "Secteur"];

  it("signale les champs obligatoires non associés", () => {
    expect(checkMapping({}, headers, IMPORT_FIELDS.accounts, {}).missingRequired).toEqual(["Raison sociale", "Secteur d'activité"]);
  });

  it("accepte l'absence de colonne secteur si un secteur par défaut est choisi", () => {
    expect(checkMapping({ legalName: "Nom" }, headers, IMPORT_FIELDS.accounts, { sector: "Santé" }).missingRequired).toEqual([]);
  });

  it("signale une colonne inexistante et un champ inconnu", () => {
    const problems = checkMapping({ legalName: "Absente", inconnu: "Nom" }, headers, IMPORT_FIELDS.accounts, { sector: "Santé" });
    expect(problems.unknownHeaders).toEqual(["Absente"]);
    expect(problems.unknownFields).toEqual(["inconnu"]);
  });
});

describe("fichier modèle", () => {
  it("fournit les en-têtes de chaque champ et une ligne d'exemple de même largeur", () => {
    for (const entity of ["accounts", "contacts"] as const) {
      const [header, example] = templateRows(entity);
      expect(header).toHaveLength(IMPORT_FIELDS[entity].length);
      expect(example).toHaveLength(header.length);
    }
  });

  it("se réassocie automatiquement à tous ses propres champs", () => {
    for (const entity of ["accounts", "contacts"] as const) {
      const [header] = templateRows(entity);
      const mapping = suggestMapping(header, IMPORT_FIELDS[entity]);
      expect(Object.keys(mapping)).toHaveLength(IMPORT_FIELDS[entity].length);
    }
  });
});
