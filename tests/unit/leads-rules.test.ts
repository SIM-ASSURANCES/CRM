import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/features/leads/config";
import { validateLeadRules } from "@/features/leads/rules";

const t = DEFAULT_THRESHOLDS;
const PRODUCT = "4f5b1c0e-6c2e-4b3f-9c61-0f9a3b7e2d11";

describe("validateLeadRules", () => {
  it("n'exige ni produit ni chiffre d'affaires jusqu'au seuil de qualification (40 %)", () => {
    expect(validateLeadRules({ progress: 10, wonConfirmed: false }, t)).toBeNull();
    expect(validateLeadRules({ progress: 40, wonConfirmed: false }, t)).toBeNull();
  });

  it("exige le produit ET le chiffre d'affaires au-delà du seuil (fenêtre de qualification)", () => {
    const errors = validateLeadRules({ progress: 60, wonConfirmed: false }, t);
    expect(errors).toHaveProperty("productId");
    expect(errors).toHaveProperty("expectedRevenue");
  });

  it("accepte un prospect qualifié complet", () => {
    expect(
      validateLeadRules({ progress: 60, productId: PRODUCT, expectedRevenue: 6245790, wonConfirmed: false }, t),
    ).toBeNull();
  });

  it("accepte un chiffre d'affaires de 0 (valeur renseignée)", () => {
    expect(validateLeadRules({ progress: 60, productId: PRODUCT, expectedRevenue: 0, wonConfirmed: false }, t)).toBeNull();
  });

  it("exige la confirmation « contrat signé + premier paiement » pour passer à 100 %", () => {
    const base = { progress: 100, productId: PRODUCT, expectedRevenue: 1 };
    expect(validateLeadRules({ ...base, wonConfirmed: false }, t)).toHaveProperty("wonConfirmed");
    expect(validateLeadRules({ ...base, wonConfirmed: true }, t)).toBeNull();
  });

  it("suit les seuils paramétrés", () => {
    const custom = { qualifiedAbove: 20, proposalAbove: 60, pipelineMin: 80 };
    expect(validateLeadRules({ progress: 40, wonConfirmed: false }, custom)).toHaveProperty("productId");
    expect(validateLeadRules({ progress: 20, wonConfirmed: false }, custom)).toBeNull();
  });
});
