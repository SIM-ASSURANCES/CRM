import { describe, expect, it } from "vitest";
import {
  addOpportunityContactSchema,
  convertLeadSchema,
  createOpportunitySchema,
  markOpportunityLostSchema,
  moveStageSchema,
} from "@/features/opportunities/schemas";

const UUID = "4f5b1c0e-6c2e-4b3f-9c61-0f9a3b7e2d11";
const OTHER = "9a1d3c52-1b7e-4d0a-8f64-2c5e7b9a0d13";

// Valeurs telles que les envoie un formulaire HTML : tout est du texte, les champs vides sont « ».
const valid = {
  name: "",
  accountId: UUID,
  productId: "",
  amount: "12 500 000",
  revenuePeriod: "annual",
  estimationMethod: "",
  stage: "20",
  expectedCloseDate: "2026-12-15",
  nextAction: "Envoyer la proposition",
  nextActionDate: "2026-10-20",
  competitor: "",
  currentSolution: "",
  ownerUserId: "",
};

function messages(input: unknown): string[] {
  const result = createOpportunitySchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("createOpportunitySchema", () => {
  it("accepte une opportunité complète et normalise les valeurs", () => {
    const result = createOpportunitySchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      name: undefined,
      amount: 12_500_000,
      stage: 20,
      productId: undefined,
      expectedCloseDate: new Date("2026-12-15T00:00:00.000Z"),
      nextActionDate: new Date("2026-10-20T00:00:00.000Z"),
    });
  });

  it("exige la date de clôture, la prochaine action et sa date (CDC 5.1 et 14)", () => {
    expect(messages({ ...valid, expectedCloseDate: "" })).toContain("La date de clôture prévisionnelle obligatoire.");
    expect(messages({ ...valid, nextAction: " " })).toContain("La prochaine action est obligatoire.");
    expect(messages({ ...valid, nextActionDate: "" })).toContain("La date de la prochaine action obligatoire.");
  });

  it("exige un montant (0 autorisé) et refuse un montant négatif", () => {
    expect(messages({ ...valid, amount: "" })).toEqual(expect.arrayContaining([expect.stringContaining("montant")]));
    expect(createOpportunitySchema.safeParse({ ...valid, amount: "0" }).success).toBe(true);
    expect(messages({ ...valid, amount: "-5" })).toContain("Le montant ne peut pas être négatif.");
  });

  it("n'accepte qu'une étape ouverte à la création", () => {
    expect(createOpportunitySchema.safeParse({ ...valid, stage: "90" }).success).toBe(true);
    expect(messages({ ...valid, stage: "100" })).toEqual(expect.arrayContaining([expect.stringContaining("Étape invalide")]));
    expect(messages({ ...valid, stage: "30" })).toEqual(expect.arrayContaining([expect.stringContaining("Étape invalide")]));
  });

  it("refuse une période de revenu et un compte invalides", () => {
    expect(messages({ ...valid, revenuePeriod: "hebdomadaire" })).toContain("Période de revenu invalide.");
    expect(messages({ ...valid, accountId: "x" })).toContain("Choisissez le compte.");
  });
});

describe("moveStageSchema", () => {
  const base = { id: UUID, version: "3", targetStage: "60" };

  it("lit l'étape cible et les cases de confirmation", () => {
    const result = moveStageSchema.safeParse({ ...base, criteriaConfirmed: "on" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ version: 3, targetStage: 60, criteriaConfirmed: true, wonConfirmed: false });
  });

  it("accepte 100 (gagné) mais refuse une étape inexistante", () => {
    expect(moveStageSchema.safeParse({ ...base, targetStage: "100", wonConfirmed: "on" }).success).toBe(true);
    expect(moveStageSchema.safeParse({ ...base, targetStage: "35" }).success).toBe(false);
  });
});

describe("markOpportunityLostSchema", () => {
  const base = { id: UUID, version: "1" };

  it("exige un motif de perte, et un commentaire pour « Autre » (CDC 5.4)", () => {
    expect(markOpportunityLostSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(markOpportunityLostSchema.safeParse({ ...base, reason: "other", comment: "" }).success).toBe(false);
    expect(markOpportunityLostSchema.safeParse({ ...base, reason: "other", comment: "Fusion" }).success).toBe(true);
    expect(markOpportunityLostSchema.safeParse({ ...base, reason: "competition" }).success).toBe(true);
  });
});

describe("addOpportunityContactSchema", () => {
  it("accepte un contact avec ou sans rôle", () => {
    expect(addOpportunityContactSchema.safeParse({ opportunityId: UUID, contactId: OTHER, roleType: "", isMain: "on" }).success).toBe(true);
    expect(addOpportunityContactSchema.safeParse({ opportunityId: UUID, contactId: OTHER, roleType: "buyer" }).success).toBe(true);
  });

  it("refuse un rôle inconnu", () => {
    expect(addOpportunityContactSchema.safeParse({ opportunityId: UUID, contactId: OTHER, roleType: "roi" }).success).toBe(false);
  });
});

describe("convertLeadSchema", () => {
  const base = { leadId: UUID, expectedCloseDate: "2026-12-01", nextAction: "Rappeler", nextActionDate: "2026-10-18" };

  it("accepte une conversion vers un nouveau compte ou un compte existant", () => {
    const create = convertLeadSchema.safeParse({ ...base, existingAccountId: "" });
    expect(create.success && create.data.existingAccountId).toBeUndefined();
    expect(convertLeadSchema.safeParse({ ...base, existingAccountId: OTHER }).success).toBe(true);
  });

  it("exige la date de clôture et la prochaine action de l'opportunité créée", () => {
    expect(convertLeadSchema.safeParse({ ...base, expectedCloseDate: "" }).success).toBe(false);
    expect(convertLeadSchema.safeParse({ ...base, nextAction: "" }).success).toBe(false);
  });
});
