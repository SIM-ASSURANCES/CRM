import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, PROGRESS_STEPS } from "@/features/leads/config";
import { destinationViews, isLeadView, viewWhere } from "@/features/leads/views";

const t = DEFAULT_THRESHOLDS;

describe("destinationViews (seuils par défaut de l'Excel)", () => {
  it.each([10, 20, 40])("place un prospect à %i %% dans « Reporting prospect »", (progress) => {
    expect(destinationViews(progress, "open", t)).toEqual(["prospects"]);
  });

  it("place un prospect à 60 % dans « Prospects qualifiés »", () => {
    expect(destinationViews(60, "open", t)).toEqual(["qualifies"]);
  });

  it.each([80, 90])("place une offre à %i %% dans « Propositions envoyées » ET « Valeur du pipeline »", (progress) => {
    expect(destinationViews(progress, "open", t)).toEqual(["propositions", "pipeline"]);
  });

  it("place une affaire gagnée uniquement dans « Taux de transformation »", () => {
    expect(destinationViews(100, "won", t)).toEqual(["gagnes"]);
  });

  it("n'affiche un prospect perdu dans aucun écran", () => {
    expect(destinationViews(40, "lost", t)).toEqual([]);
  });

  it("applique des seuils modifiés (paramètres)", () => {
    const custom = { qualifiedAbove: 20, proposalAbove: 60, pipelineMin: 60 };
    expect(destinationViews(20, "open", custom)).toEqual(["prospects"]);
    expect(destinationViews(40, "open", custom)).toEqual(["qualifies"]);
    expect(destinationViews(60, "open", custom)).toEqual(["qualifies", "pipeline"]);
  });

  it("répartit chaque prospect ouvert dans exactement un écran principal (aucun trou, aucun doublon)", () => {
    for (const progress of PROGRESS_STEPS.filter((p) => p < 100)) {
      const primary = destinationViews(progress, "open", t).filter((v) => v !== "pipeline");
      expect(primary, `étape ${progress} %`).toHaveLength(1);
    }
  });
});

describe("viewWhere", () => {
  it("construit les filtres de chaque écran", () => {
    expect(viewWhere("prospects", t)).toEqual({ status: "open", progress: { lte: 40 } });
    expect(viewWhere("qualifies", t)).toEqual({ status: "open", progress: { gt: 40, lte: 60 } });
    expect(viewWhere("propositions", t)).toEqual({ status: "open", progress: { gt: 60, lt: 100 } });
    expect(viewWhere("pipeline", t)).toEqual({ status: "open", progress: { gte: 80, lt: 100 } });
    expect(viewWhere("gagnes", t)).toEqual({ status: "won" });
  });
});

describe("isLeadView", () => {
  it("reconnaît uniquement les écrans connus", () => {
    expect(isLeadView("qualifies")).toBe(true);
    expect(isLeadView("inconnu")).toBe(false);
  });
});
