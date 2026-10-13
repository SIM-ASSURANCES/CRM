import { describe, expect, it } from "vitest";
import { createLeadSchema, formDataToObject, markLostSchema } from "@/features/leads/schemas";

// Valeurs telles que les envoie un formulaire HTML : tout est du texte, les champs vides sont « ».
const valid = {
  companyName: "AACI",
  sector: "Mine et énergie",
  contactLastName: "Koffi",
  contactFirstName: "Gado",
  phone: "07 07 35 36 73",
  email: "Koffi.Gado@Client.CI",
  jobTitle: "Responsable achats",
  insertedOn: "2026-10-01",
  progress: "20",
  productId: "",
  expectedRevenue: "",
};

function messages(input: unknown): string[] {
  const result = createLeadSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("createLeadSchema", () => {
  it("accepte un prospect valide et normalise les valeurs", () => {
    const result = createLeadSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phone).toBe("0707353673");
    expect(result.data.email).toBe("koffi.gado@client.ci");
    expect(result.data.progress).toBe(20);
    expect(result.data.productId).toBeUndefined();
    expect(result.data.expectedRevenue).toBeUndefined();
    expect(result.data.insertedOn).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(result.data.wonConfirmed).toBe(false);
  });

  it("refuse une date d'insertion postérieure à la date du jour (règle de l'Excel)", () => {
    expect(messages({ ...valid, insertedOn: "2999-01-01" })).toContain(
      "La date d'insertion ne peut pas être postérieure à la date du jour.",
    );
  });

  it("refuse un secteur hors liste, une étape inconnue, un e-mail et un téléphone invalides", () => {
    expect(messages({ ...valid, sector: "Inconnu" })).toContain("Secteur d'activité obligatoire.");
    expect(messages({ ...valid, progress: "30" })).toContain("Étape du process de vente invalide.");
    expect(messages({ ...valid, email: "pas-un-mail" })).toContain("Adresse e-mail invalide.");
    expect(messages({ ...valid, phone: "123" })).toContain("Numéro de téléphone invalide (8 à 15 chiffres).");
  });

  it("signale les champs obligatoires manquants", () => {
    const result = createLeadSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = result.error.issues.map((i) => i.path[0]);
    for (const field of ["companyName", "sector", "contactLastName", "contactFirstName", "phone", "email", "jobTitle", "insertedOn", "progress"]) {
      expect(fields).toContain(field);
    }
  });

  it.each([
    ["6 245 790", 6245790],
    ["6245790,50", 6245790.5],
    ["0", 0],
  ])("lit le montant « %s » comme %d", (raw, expected) => {
    const result = createLeadSchema.safeParse({ ...valid, expectedRevenue: raw });
    expect(result.success && result.data.expectedRevenue).toBe(expected);
  });

  it("refuse un montant négatif ou illisible", () => {
    expect(messages({ ...valid, expectedRevenue: "-5" })).toContain("Le montant ne peut pas être négatif.");
    expect(messages({ ...valid, expectedRevenue: "abc" })).toContain("Montant invalide.");
  });

  it("lit la case à cocher « contrat signé » (valeur « on » d'un formulaire)", () => {
    const result = createLeadSchema.safeParse({ ...valid, wonConfirmed: "on" });
    expect(result.success && result.data.wonConfirmed).toBe(true);
  });
});

describe("markLostSchema", () => {
  const base = { id: "4f5b1c0e-6c2e-4b3f-9c61-0f9a3b7e2d11", version: "1" };

  it("exige un motif de perte (CDC 5.4)", () => {
    expect(markLostSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
  });

  it("exige un commentaire pour le motif « Autre »", () => {
    expect(markLostSchema.safeParse({ ...base, reason: "other", comment: "" }).success).toBe(false);
    expect(markLostSchema.safeParse({ ...base, reason: "other", comment: "Fusion avec un concurrent" }).success).toBe(true);
  });

  it("accepte un motif standard sans commentaire", () => {
    expect(markLostSchema.safeParse({ ...base, reason: "price" }).success).toBe(true);
  });
});

describe("formDataToObject", () => {
  it("retire les champs techniques ajoutés par React", () => {
    const formData = new FormData();
    formData.set("$ACTION_ID_abc", "x");
    formData.set("companyName", "AACI");
    expect(formDataToObject(formData)).toEqual({ companyName: "AACI" });
  });
});
