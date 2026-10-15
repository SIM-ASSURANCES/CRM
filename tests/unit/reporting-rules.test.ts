import { describe, expect, it } from "vitest";
import { parseForecastParams, parseLossParams } from "@/features/reporting/schemas";
import {
  annualize,
  attainment,
  bucketKey,
  buildForecast,
  buildLossMatrix,
  emptySegment,
  monthsBetween,
  monthsOfPeriod,
  periodKeyOf,
  periodLabel,
  periodsBetween,
  sizeBandOf,
  targetOfPeriod,
  type ReportOpportunity,
} from "@/features/reporting/rules";

// Règles pures du reporting avancé (CDC 8.2, 5.3 et 5.4) : montants annualisés, périodes, forecast, objectifs, motifs de perte.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const opp = (over: Partial<ReportOpportunity> = {}): ReportOpportunity => ({
  status: "open",
  amount: 1_000_000,
  revenuePeriod: "annual",
  stage: 40,
  expectedCloseDate: day("2026-10-15"),
  closedAt: null,
  lossReason: null,
  segmentKey: "all",
  segmentLabel: "Toutes",
  ...over,
});

describe("montants annualisés (décision du 15/10/2026)", () => {
  it("multiplie le mensuel par 12 et laisse l'annuel et l'unique tels quels", () => {
    expect(annualize(100_000, "monthly")).toBe(1_200_000);
    expect(annualize(1_200_000, "annual")).toBe(1_200_000);
    expect(annualize(500_000, "one_time")).toBe(500_000);
    expect(annualize(333.335, "monthly")).toBe(4000.02);
  });
});

describe("périodes", () => {
  it("donne la clé et le libellé d'un mois, d'un trimestre et d'une année", () => {
    const date = day("2026-11-03");
    expect(periodKeyOf(date, "month")).toBe("2026-11");
    expect(periodKeyOf(date, "quarter")).toBe("2026-T4");
    expect(periodKeyOf(day("2026-03-31"), "quarter")).toBe("2026-T1");
    expect(periodKeyOf(day("2026-04-01"), "quarter")).toBe("2026-T2");
    expect(periodKeyOf(date, "year")).toBe("2026");
    expect(periodLabel("2026-11")).toBe("nov. 2026");
    expect(periodLabel("2026-T4")).toBe("T4 2026");
    expect(periodLabel("2026")).toBe("2026");
  });

  it("décompose une période en mois (un objectif trimestriel ou annuel est la somme de ses mois)", () => {
    expect(monthsOfPeriod("2026-05")).toEqual(["2026-05"]);
    expect(monthsOfPeriod("2026-T4")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthsOfPeriod("2026")).toHaveLength(12);
    expect(monthsOfPeriod("2026")[11]).toBe("2026-12");
  });

  it("énumère les mois et les périodes d'une plage, à cheval sur deux années", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-05", "2026-04")).toEqual([]);
    expect(periodsBetween("2026-02", "2026-11", "quarter")).toEqual(["2026-T1", "2026-T2", "2026-T3", "2026-T4"]);
    expect(periodsBetween("2026-11", "2027-02", "year")).toEqual(["2026", "2027"]);
    expect(periodsBetween("2026-01", "2026-03", "month")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

describe("forecast par période et par segment (CDC 8.2)", () => {
  const periods = periodsBetween("2026-10", "2026-12", "month");

  it("sépare pipeline brut, pipeline pondéré, gagnées et revenu signé ; le forecast = signé + pondéré", () => {
    const report = buildForecast(
      [
        opp({ amount: 1_000_000, stage: 40 }),
        opp({ amount: 100_000, revenuePeriod: "monthly", stage: 60 }),
        opp({ status: "won", amount: 2_000_000, stage: 100, closedAt: new Date("2026-10-20T09:00:00Z"), expectedCloseDate: day("2026-10-25") }),
      ],
      { granularity: "month", periods },
    );
    const october = report.periodTotals["2026-10"];
    expect(october).toMatchObject({ openCount: 2, gross: 2_200_000, wonCount: 1, signed: 2_000_000 });
    // 1 000 000 × 40 % + 1 200 000 × 60 % = 400 000 + 720 000
    expect(october.weighted).toBe(1_120_000);
    expect(october.forecast).toBe(3_120_000);
    expect(report.total).toEqual(october);
  });

  it("place chaque opportunité dans la période de SA date : prévisionnelle si ouverte, de clôture si gagnée", () => {
    const report = buildForecast(
      [
        opp({ expectedCloseDate: day("2026-11-30") }),
        opp({ status: "won", stage: 100, closedAt: new Date("2026-12-01T00:30:00Z"), expectedCloseDate: day("2026-10-01") }),
      ],
      { granularity: "month", periods },
    );
    expect(report.periodTotals["2026-11"].openCount).toBe(1);
    expect(report.periodTotals["2026-12"].wonCount).toBe(1);
    expect(report.periodTotals["2026-10"].wonCount).toBe(0);
  });

  it("ignore les perdues, les opportunités hors période et les gagnées sans date de clôture", () => {
    const report = buildForecast(
      [
        opp({ status: "lost", stage: 20, closedAt: new Date("2026-10-10T00:00:00Z"), lossReason: "price" }),
        opp({ expectedCloseDate: day("2027-03-01") }),
        opp({ status: "won", stage: 100, closedAt: null }),
      ],
      { granularity: "month", periods },
    );
    expect(report.total).toMatchObject({ openCount: 0, wonCount: 0, gross: 0, signed: 0, forecast: 0 });
    expect(report.segments).toHaveLength(0);
  });

  it("ne place nulle part une opportunité sans date (la base l'interdit, mais le calcul ne doit pas la compter au hasard)", () => {
    const report = buildForecast([opp({ expectedCloseDate: null, amount: 500_000, stage: 20 })], { granularity: "month", periods });
    expect(report.total).toMatchObject({ openCount: 0, gross: 0, forecast: 0 });
    expect(report.segments).toHaveLength(0);
    expect(bucketKey(opp({ expectedCloseDate: null }), "month")).toBeNull();
  });

  it("agrège par segment, du plus gros forecast au plus petit, et le total des segments égale le total général", () => {
    const report = buildForecast(
      [
        opp({ segmentKey: "a", segmentLabel: "Auto", amount: 1_000_000, stage: 20 }),
        opp({ segmentKey: "b", segmentLabel: "Santé", amount: 5_000_000, stage: 80 }),
        opp({ segmentKey: "a", segmentLabel: "Auto", amount: 3_000_000, stage: 10, expectedCloseDate: day("2026-12-31") }),
      ],
      { granularity: "month", periods },
    );
    expect(report.segments.map((segment) => segment.label)).toEqual(["Santé", "Auto"]);
    expect(report.segments.reduce((sum, segment) => sum + segment.total.forecast, 0)).toBe(report.total.forecast);
    expect(report.segments.reduce((sum, segment) => sum + segment.total.gross, 0)).toBe(report.total.gross);
    expect(report.total.gross).toBe(9_000_000);
  });

  it("regroupe par trimestre et par année", () => {
    const list = [opp({ expectedCloseDate: day("2026-02-10") }), opp({ expectedCloseDate: day("2026-05-10") }), opp({ expectedCloseDate: day("2027-01-10") })];
    const quarters = buildForecast(list, { granularity: "quarter", periods: periodsBetween("2026-01", "2026-12", "quarter") });
    expect(quarters.periodTotals["2026-T1"].openCount).toBe(1);
    expect(quarters.periodTotals["2026-T2"].openCount).toBe(1);
    expect(quarters.total.openCount).toBe(2);
    const years = buildForecast(list, { granularity: "year", periods: periodsBetween("2026-01", "2027-12", "year") });
    expect(years.periodTotals["2026"].openCount).toBe(2);
    expect(years.periodTotals["2027"].openCount).toBe(1);
  });

  it("peut représenter un segment sans opportunité, à zéro", () => {
    const segment = emptySegment("u1", "Awa Koné", periods);
    expect(segment.total).toMatchObject({ forecast: 0, gross: 0, openCount: 0 });
    expect(Object.keys(segment.periods)).toEqual(periods);
  });
});

describe("écart à l'objectif (CDC 8.1 et 8.2)", () => {
  it("calcule l'écart et le taux, et refuse un pourcentage trompeur quand l'objectif est nul", () => {
    expect(attainment(8_000_000, 10_000_000)).toEqual({ target: 10_000_000, forecast: 8_000_000, gap: -2_000_000, rate: 80 });
    expect(attainment(12_500_000, 10_000_000)).toMatchObject({ gap: 2_500_000, rate: 125 });
    expect(attainment(1_234_567, 3_000_000).rate).toBe(41.2);
    expect(attainment(5_000_000, 0)).toMatchObject({ gap: 5_000_000, rate: null });
    expect(attainment(0, 0)).toMatchObject({ gap: 0, rate: null });
  });

  it("additionne les objectifs mensuels d'un trimestre ou d'une année", () => {
    const targets = new Map([
      ["2026-10", 1_000_000],
      ["2026-11", 2_000_000],
      ["2026-12", 3_000_000],
      ["2026-01", 500_000],
    ]);
    expect(targetOfPeriod("2026-11", targets)).toBe(2_000_000);
    expect(targetOfPeriod("2026-T4", targets)).toBe(6_000_000);
    expect(targetOfPeriod("2026", targets)).toBe(6_500_000);
    expect(targetOfPeriod("2025", targets)).toBe(0);
  });
});

describe("motifs de perte croisés (CDC 5.4)", () => {
  const lost = (over: Partial<ReportOpportunity>) => opp({ status: "lost", closedAt: new Date("2026-10-10T00:00:00Z"), ...over });

  it("croise motifs et segments : nombre et montant annualisé, avec les totaux", () => {
    const matrix = buildLossMatrix([
      lost({ segmentKey: "a", segmentLabel: "Auto", lossReason: "price", amount: 1_000_000 }),
      lost({ segmentKey: "a", segmentLabel: "Auto", lossReason: "price", amount: 100_000, revenuePeriod: "monthly" }),
      lost({ segmentKey: "a", segmentLabel: "Auto", lossReason: "timing", amount: 500_000 }),
      lost({ segmentKey: "b", segmentLabel: "Santé", lossReason: "competition", amount: 4_000_000 }),
      opp({ status: "won", segmentKey: "a", segmentLabel: "Auto" }),
    ]);

    expect(matrix.rows.map((row) => row.label)).toEqual(["Santé", "Auto"]);
    const auto = matrix.rows[1];
    expect(auto.byReason.price).toEqual({ count: 2, amount: 2_200_000 });
    expect(auto.byReason.timing).toEqual({ count: 1, amount: 500_000 });
    expect(auto.total).toEqual({ count: 3, amount: 2_700_000 });
    expect(matrix.total.total).toEqual({ count: 4, amount: 6_700_000 });
    expect(matrix.total.byReason.competition).toEqual({ count: 1, amount: 4_000_000 });
    // La somme des lignes est égale au total, pour chaque motif.
    for (const reason of matrix.reasons) {
      expect(matrix.rows.reduce((sum, row) => sum + row.byReason[reason.code].amount, 0)).toBe(matrix.total.byReason[reason.code].amount);
    }
    expect(matrix.reasons.map((reason) => reason.code)).not.toContain("unknown");
  });

  it("isole les pertes sans motif connu dans une colonne « Non renseigné »", () => {
    const matrix = buildLossMatrix([lost({ lossReason: null }), lost({ lossReason: "motif-inconnu" }), lost({ lossReason: "price" })]);
    expect(matrix.reasons.at(-1)).toEqual({ code: "unknown", label: "Non renseigné" });
    expect(matrix.total.byReason.unknown.count).toBe(2);
    expect(matrix.total.total.count).toBe(3);
  });

  it("classe la taille d'un compte d'après son effectif", () => {
    expect(sizeBandOf(null).key).toBe("unknown");
    expect(sizeBandOf(0).key).toBe("unknown");
    expect(sizeBandOf(49).key).toBe("small");
    expect(sizeBandOf(50).key).toBe("medium");
    expect(sizeBandOf(249).key).toBe("medium");
    expect(sizeBandOf(250).key).toBe("large");
    expect(sizeBandOf(1000).key).toBe("xlarge");
  });
});

describe("filtres des rapports", () => {
  const now = new Date("2026-10-15T10:00:00Z");

  it("applique l'année en cours, le mois et l'absence de segmentation quand aucun paramètre n'est fourni", () => {
    const parsed = parseForecastParams(new URLSearchParams(), now);
    expect(parsed.success && parsed.data).toMatchObject({ from: "2026-01", to: "2026-12", granularity: "month", segment: "none" });
    const losses = parseLossParams({}, now);
    expect(losses.success && losses.data).toMatchObject({ from: "2026-01", to: "2026-12", dimension: "product" });
  });

  it("lit les paramètres d'adresse et ignore les chaînes vides", () => {
    const parsed = parseForecastParams(new URLSearchParams("du=2026-04&au=2026-09&periode=quarter&segment=owner&produit=&commercial="), now);
    expect(parsed.success && parsed.data).toMatchObject({ from: "2026-04", to: "2026-09", granularity: "quarter", segment: "owner" });
    expect(parsed.success && parsed.data.productId).toBeUndefined();
  });

  it("REFUSE un paramètre présent mais invalide, plutôt que de l'ignorer", () => {
    for (const query of ["segment=pays", "periode=semaine", "du=2026-13", "du=n-importe-quoi", "produit=pas-un-uuid", "du=2026-10&au=2026-03"]) {
      expect(parseForecastParams(new URLSearchParams(query), now).success, query).toBe(false);
    }
    expect(parseLossParams(new URLSearchParams("axe=couleur"), now).success).toBe(false);
  });

  it("borne le nombre de périodes", () => {
    expect(parseForecastParams(new URLSearchParams("du=2020-01&au=2026-12&periode=month"), now).success).toBe(false);
    expect(parseForecastParams(new URLSearchParams("du=2020-01&au=2026-12&periode=quarter"), now).success).toBe(true);
    expect(parseForecastParams(new URLSearchParams("du=2000-01&au=2026-12&periode=year"), now).success).toBe(true);
    expect(parseLossParams(new URLSearchParams("du=2015-01&au=2026-12"), now).success).toBe(false);
  });
});
