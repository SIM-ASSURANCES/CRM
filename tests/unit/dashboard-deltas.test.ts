import { describe, expect, it } from "vitest";
import { describeComparison, describePoints } from "@/components/dashboard/kpi-card";
import { compareValues } from "@/features/leads/kpi-math";

// Les cinq cartes du tableau de bord (Nouveaux prospects, RDV obtenus, Propositions envoyées, Taux de transformation, Valeur
// du pipeline) passent toutes par ces deux fonctions : la mention « non calculable vs semaine dernière » est donc la même
// partout, dès que la semaine précédente ne permet pas de calcul (CDC 8.1).
const NOT_COMPUTABLE = "non calculable vs semaine dernière";

describe("cartes du tableau de bord : variation vs semaine dernière", () => {
  it.each([
    ["Nouveaux prospects", compareValues(4, 0)],
    ["RDV obtenus", compareValues(3, 0)],
    ["Propositions envoyées", compareValues(2, 0)],
    ["Valeur du pipeline commercial", compareValues(5_000_000, 0)],
  ])("%s : « non calculable » quand la semaine précédente vaut zéro", (_card, comparison) => {
    expect(describeComparison(comparison)).toEqual({ text: NOT_COMPUTABLE, tone: "na" });
  });

  it("deux semaines vides : toujours « non calculable », jamais « +0 % »", () => {
    expect(describeComparison(compareValues(0, 0))).toEqual({ text: NOT_COMPUTABLE, tone: "na" });
  });

  it("Taux de transformation : « non calculable » quand l'un des deux taux n'existe pas", () => {
    expect(describePoints(null)).toEqual({ text: NOT_COMPUTABLE, tone: "na" });
  });

  it("calcule la variation dès que la semaine précédente est non nulle", () => {
    expect(describeComparison(compareValues(25, 20))).toMatchObject({ tone: "up" });
    expect(describeComparison(compareValues(1, 3))).toMatchObject({ tone: "down" });
    expect(describeComparison(compareValues(7, 7))).toMatchObject({ tone: "flat" });
    expect(describeComparison(compareValues(25, 20)).text).toMatch(/vs semaine dernière$/);
  });

  it("Taux de transformation : l'écart s'exprime en points", () => {
    expect(describePoints(5)).toEqual({ text: "+5 pts vs semaine dernière", tone: "up" });
    expect(describePoints(-3)).toEqual({ text: "−3 pts vs semaine dernière", tone: "down" });
    expect(describePoints(0)).toEqual({ text: "0 pts vs semaine dernière", tone: "flat" });
  });
});
