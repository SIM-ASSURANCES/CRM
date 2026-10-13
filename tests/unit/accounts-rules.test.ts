import { describe, expect, it } from "vitest";
import {
  completenessPercent,
  emailDomainOf,
  missingAccountFields,
  normalizeName,
  wouldCreateCycle,
  type CompletenessInput,
} from "@/features/accounts/rules";

describe("normalizeName", () => {
  it("ignore la casse, les accents et la ponctuation", () => {
    expect(normalizeName("Société Générale d'Électricité")).toBe("societegeneraledelectricite");
    expect(normalizeName("SOCIETE GENERALE D ELECTRICITE")).toBe("societegeneraledelectricite");
  });

  it("distingue des noms différents", () => {
    expect(normalizeName("Abidjan Mines")).not.toBe(normalizeName("Abidjan Mine SA"));
  });
});

describe("emailDomainOf", () => {
  it("extrait le domaine en minuscules", () => {
    expect(emailDomainOf("Marie.Test@Client.CI")).toBe("client.ci");
  });

  it("renvoie null pour une adresse invalide", () => {
    expect(emailDomainOf("pas-un-mail")).toBeNull();
    expect(emailDomainOf("@client.ci")).toBeNull();
    expect(emailDomainOf("marie@")).toBeNull();
  });
});

describe("wouldCreateCycle (hiérarchie groupe / filiale)", () => {
  // Groupe G → filiale F → sous-filiale S
  const parents: Record<string, string | null> = { G: null, F: "G", S: "F", X: null };
  const parentOf = (id: string) => parents[id] ?? null;

  it("autorise un rattachement valide ou la suppression du parent", () => {
    expect(wouldCreateCycle("X", "G", parentOf)).toBe(false);
    expect(wouldCreateCycle("G", null, parentOf)).toBe(false);
  });

  it("refuse qu'un compte soit son propre parent", () => {
    expect(wouldCreateCycle("G", "G", parentOf)).toBe(true);
  });

  it("refuse de rattacher un groupe à l'une de ses filiales, à n'importe quelle profondeur", () => {
    expect(wouldCreateCycle("G", "F", parentOf)).toBe(true);
    expect(wouldCreateCycle("G", "S", parentOf)).toBe(true);
    expect(wouldCreateCycle("F", "S", parentOf)).toBe(true);
  });

  it("n'entre pas dans une boucle infinie si les données sont déjà corrompues", () => {
    const corrupted: Record<string, string | null> = { A: "B", B: "A" };
    expect(wouldCreateCycle("Z", "A", (id) => corrupted[id] ?? null)).toBe(true);
  });
});

describe("complétude d'un compte", () => {
  const complete: CompletenessInput = {
    legalName: "AACI SA",
    sector: "Mine et énergie",
    ownerUserId: "u1",
    legalIdentifier: "CI-ABJ-2020-B-12345",
    city: "Abidjan",
    phone: "0707353673",
    emailDomain: "aaci.ci",
    employeeCount: 120,
    revenueAmount: 1_500_000_000,
  };

  it("vaut 100 % quand tout est renseigné", () => {
    expect(completenessPercent(complete)).toBe(100);
    expect(missingAccountFields(complete)).toEqual({ required: [], recommended: [] });
  });

  it("distingue les champs obligatoires des champs recommandés manquants", () => {
    const partial = { ...complete, sector: null, phone: "", employeeCount: null };
    const missing = missingAccountFields(partial);
    expect(missing.required).toEqual(["Secteur d'activité"]);
    expect(missing.recommended).toEqual(["Téléphone", "Effectif"]);
    expect(completenessPercent(partial)).toBe(67);
  });

  it("considère un chiffre d'affaires de 0 comme renseigné", () => {
    expect(missingAccountFields({ ...complete, revenueAmount: 0 }).recommended).not.toContain("Chiffre d'affaires");
  });
});
