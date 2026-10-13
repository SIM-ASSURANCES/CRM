import { describe, expect, it } from "vitest";
import {
  defaultOpportunityName,
  isOverdue,
  summarize,
  validateStageMove,
  weightedAmount,
} from "@/features/opportunities/rules";

describe("weightedAmount (CDC 5.3)", () => {
  it("multiplie le montant par la probabilité de l'étape", () => {
    expect(weightedAmount(10_000_000, 60)).toBe(6_000_000);
    expect(weightedAmount(1_000_000, 10)).toBe(100_000);
    expect(weightedAmount(5_245_875, 80)).toBe(4_196_700);
  });

  it("vaut 0 pour un montant nul et le montant entier à 100 %", () => {
    expect(weightedAmount(0, 90)).toBe(0);
    expect(weightedAmount(250_000, 100)).toBe(250_000);
  });

  it("arrondit au centime sans erreur de virgule flottante", () => {
    expect(weightedAmount(0.1, 60)).toBe(0.06);
    expect(weightedAmount(33.33, 90)).toBe(30);
  });
});

describe("validateStageMove", () => {
  const base = { from: 20, to: 40, productId: null, amount: 0, criteriaConfirmed: true, wonConfirmed: false };

  it("autorise d'avancer jusqu'au seuil de qualification sans produit ni montant", () => {
    expect(validateStageMove(base)).toBeNull();
  });

  it("exige la confirmation du critère pour avancer", () => {
    expect(validateStageMove({ ...base, criteriaConfirmed: false })).toHaveProperty("criteriaConfirmed");
  });

  it("ne demande aucune confirmation pour reculer", () => {
    expect(validateStageMove({ ...base, from: 60, to: 40, criteriaConfirmed: false })).toBeNull();
  });

  it("exige produit et montant au-delà du seuil de qualification", () => {
    const errors = validateStageMove({ ...base, to: 60 });
    expect(errors).toHaveProperty("productId");
    expect(errors).toHaveProperty("amount");
    expect(validateStageMove({ ...base, to: 60, productId: "p1", amount: 1_000_000 })).toBeNull();
  });

  it("refuse un montant nul à une étape qui exige un montant", () => {
    expect(validateStageMove({ ...base, to: 80, productId: "p1", amount: 0 })).toHaveProperty("amount");
  });

  it("exige la confirmation « contrat signé + premier paiement » pour gagner, sans critère d'étape", () => {
    const toWon = { from: 90, to: 100, productId: "p1", amount: 500_000, criteriaConfirmed: false, wonConfirmed: false };
    expect(validateStageMove(toWon)).toHaveProperty("wonConfirmed");
    expect(validateStageMove(toWon)).not.toHaveProperty("criteriaConfirmed");
    expect(validateStageMove({ ...toWon, wonConfirmed: true })).toBeNull();
  });

  it("refuse un changement vers la même étape", () => {
    expect(validateStageMove({ ...base, to: 20 })).toHaveProperty("targetStage");
  });

  it("applique un seuil de qualification paramétré", () => {
    const move = { ...base, from: 10, to: 20 };
    expect(validateStageMove(move, 40)).toBeNull();
    expect(validateStageMove(move, 10)).toHaveProperty("productId");
  });
});

describe("defaultOpportunityName", () => {
  it("compose compte – produit – échéance", () => {
    expect(defaultOpportunityName("Groupe Ouattara", "RELAX Auto", new Date("2026-11-15T00:00:00Z"))).toBe(
      "Groupe Ouattara – RELAX Auto – 11/2026",
    );
  });

  it("gère l'absence de produit ou de date", () => {
    expect(defaultOpportunityName("Clinique Sainte-Marie", null, new Date("2026-03-01T00:00:00Z"))).toBe(
      "Clinique Sainte-Marie – Opportunité – 03/2026",
    );
    expect(defaultOpportunityName("Clinique Sainte-Marie", "SECUR Maison", null)).toBe("Clinique Sainte-Marie – SECUR Maison");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-10-14T15:30:00Z");

  it("considère en retard une action datée d'avant aujourd'hui", () => {
    expect(isOverdue(new Date("2026-10-13T00:00:00Z"), now)).toBe(true);
  });

  it("ne considère pas en retard une action du jour ou à venir", () => {
    expect(isOverdue(new Date("2026-10-14T00:00:00Z"), now)).toBe(false);
    expect(isOverdue(new Date("2026-10-20T00:00:00Z"), now)).toBe(false);
  });

  it("ignore l'absence de date", () => {
    expect(isOverdue(null, now)).toBe(false);
  });
});

describe("summarize", () => {
  it("totalise nombre, montant brut et montant pondéré", () => {
    const totals = summarize([
      { amount: 10_000_000, stage: 60 },
      { amount: 4_000_000, stage: 90 },
    ]);
    expect(totals).toEqual({ count: 2, gross: 14_000_000, weighted: 9_600_000 });
  });

  it("renvoie des zéros pour une colonne vide", () => {
    expect(summarize([])).toEqual({ count: 0, gross: 0, weighted: 0 });
  });
});
