import { describe, expect, it } from "vitest";
import { createAccountSchema, mergeAccountsSchema } from "@/features/accounts/schemas";
import {
  addRoleSchema,
  createContactSchema,
  linkContactSchema,
} from "@/features/contacts/schemas";

const UUID = "4f5b1c0e-6c2e-4b3f-9c61-0f9a3b7e2d11";
const OTHER_UUID = "9a1d3c52-1b7e-4d0a-8f64-2c5e7b9a0d13";

// Valeurs telles que les envoie un formulaire HTML : tout est du texte, les champs vides sont « ».
const validAccount = {
  legalName: "AACI SA",
  tradeName: "",
  legalIdentifier: "CI-ABJ-2020-B-12345",
  sector: "Mine et énergie",
  employeeCount: "120",
  revenueAmount: "1 250 000 000",
  revenueYear: "2025",
  revenueSource: "Bilan 2025",
  collectiveAgreement: "",
  status: "client",
  source: "referral",
  phone: "07 07 35 36 73",
  emailDomain: "AACI.ci",
  addressLine: "Zone 4",
  city: "Abidjan",
  country: "",
  parentAccountId: "",
  ownerUserId: "",
};

function accountMessages(input: unknown): string[] {
  const result = createAccountSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("createAccountSchema", () => {
  it("accepte un compte complet et normalise les valeurs", () => {
    const result = createAccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      legalName: "AACI SA",
      tradeName: undefined,
      employeeCount: 120,
      revenueAmount: 1_250_000_000,
      revenueYear: 2025,
      phone: "0707353673",
      emailDomain: "aaci.ci",
      country: "CI",
      parentAccountId: undefined,
      forceDuplicate: false,
    });
  });

  it("n'exige que la raison sociale, le secteur et le statut", () => {
    const minimal = { legalName: "Petite Entreprise", sector: "Santé", status: "prospect" };
    expect(createAccountSchema.safeParse(minimal).success).toBe(true);
  });

  it("refuse un secteur absent ou hors liste (obligatoire pour le reporting sectoriel)", () => {
    expect(accountMessages({ ...validAccount, sector: "" })).toContain(
      "Le secteur d'activité est obligatoire (reporting sectoriel).",
    );
    expect(accountMessages({ ...validAccount, sector: "Inconnu" })).toContain(
      "Le secteur d'activité est obligatoire (reporting sectoriel).",
    );
  });

  it("refuse une raison sociale vide, un statut, un pays et une source invalides", () => {
    expect(accountMessages({ ...validAccount, legalName: " " })).toContain("La raison sociale est obligatoire (2 caractères minimum).");
    expect(accountMessages({ ...validAccount, status: "vip" })).toContain("Statut invalide.");
    expect(accountMessages({ ...validAccount, country: "XX" })).toContain("Pays invalide.");
    expect(accountMessages({ ...validAccount, source: "radio" })).toContain("Source d'acquisition invalide.");
  });

  it("valide effectif, année, domaine et téléphone", () => {
    expect(accountMessages({ ...validAccount, employeeCount: "-3" })).toContain("Effectif invalide.");
    expect(accountMessages({ ...validAccount, revenueYear: "1800" })).toContain("Année invalide.");
    expect(accountMessages({ ...validAccount, emailDomain: "pas un domaine" })).toContain("Domaine invalide (exemple : client.ci).");
    expect(accountMessages({ ...validAccount, phone: "123" })).toContain("Numéro de téléphone invalide (8 à 15 chiffres).");
    expect(accountMessages({ ...validAccount, revenueAmount: "-1" })).toContain("Le montant ne peut pas être négatif.");
  });

  it("lit la case « créer quand même » d'un formulaire", () => {
    const result = createAccountSchema.safeParse({ ...validAccount, forceDuplicate: "on" });
    expect(result.success && result.data.forceDuplicate).toBe(true);
  });
});

describe("mergeAccountsSchema", () => {
  it("exige deux identifiants valides", () => {
    expect(mergeAccountsSchema.safeParse({ targetId: UUID, sourceId: OTHER_UUID }).success).toBe(true);
    expect(mergeAccountsSchema.safeParse({ targetId: UUID, sourceId: "x" }).success).toBe(false);
  });
});

describe("createContactSchema", () => {
  const valid = { firstName: " Marie ", lastName: "Kouassi", email: " Marie@Client.CI ", phone: "07 07 35 36 73", status: "active" };

  it("normalise l'e-mail et le téléphone, et accepte un compte vide", () => {
    const result = createContactSchema.safeParse({ ...valid, accountId: "", jobTitle: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ firstName: "Marie", email: "marie@client.ci", phone: "0707353673", accountId: undefined });
  });

  it("exige le prénom et le nom", () => {
    const result = createContactSchema.safeParse({ status: "active" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = result.error.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["firstName", "lastName"]));
  });

  it("refuse un e-mail, un statut et un canal invalides", () => {
    expect(createContactSchema.safeParse({ ...valid, email: "x" }).success).toBe(false);
    expect(createContactSchema.safeParse({ ...valid, status: "mort" }).success).toBe(false);
    expect(createContactSchema.safeParse({ ...valid, preferredChannel: "pigeon" }).success).toBe(false);
  });
});

describe("linkContactSchema", () => {
  const base = { contactId: UUID, accountId: OTHER_UUID };

  it("lit les dates et la case « contact principal »", () => {
    const result = linkContactSchema.safeParse({ ...base, isPrimary: "on", startDate: "2026-01-05", endDate: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isPrimary).toBe(true);
    expect(result.data.startDate).toEqual(new Date("2026-01-05T00:00:00.000Z"));
    expect(result.data.endDate).toBeUndefined();
  });

  it("refuse une date de fin antérieure à la date de début", () => {
    const result = linkContactSchema.safeParse({ ...base, startDate: "2026-06-01", endDate: "2026-01-01" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("La date de fin doit suivre la date de début.");
  });
});

describe("addRoleSchema", () => {
  const base = { contactId: UUID, accountId: OTHER_UUID };

  it("accepte un rôle d'achat sans produit ni influence", () => {
    const result = addRoleSchema.safeParse({ ...base, roleType: "decision_maker", productId: "", influence: "" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.productId).toBeUndefined();
  });

  it("refuse un rôle ou une influence inconnus", () => {
    expect(addRoleSchema.safeParse({ ...base, roleType: "roi" }).success).toBe(false);
    expect(addRoleSchema.safeParse({ ...base, roleType: "buyer", influence: "énorme" }).success).toBe(false);
  });
});
