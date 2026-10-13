import { PROGRESS_STEPS, STAGE_CRITERIA, STAGE_LABELS } from "@/features/leads/config";

// Étapes du pipeline des opportunités (CDC 5.2) : même échelle et mêmes critères que les prospects (Excel).
// Les probabilités sont celles du document source ; elles deviendront configurables avec une table dédiée.
export { PROGRESS_STEPS, STAGE_CRITERIA, STAGE_LABELS };

/** Étapes ouvertes (colonnes du Kanban). 100 % = gagné : ce n'est pas une colonne mais une clôture. */
export const OPEN_STAGES = [10, 20, 40, 60, 80, 90] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];

export function isOpenStage(value: number): value is OpenStage {
  return (OPEN_STAGES as readonly number[]).includes(value);
}

// Période de revenu du montant (CDC 5.1). La définition comptable du revenu (prime, commission, honoraires…)
// reste à confirmer avant exploitation des chiffres (plan, section 12, question 6).
export const REVENUE_PERIODS = [
  { code: "one_time", label: "Unique" },
  { code: "monthly", label: "Mensuel" },
  { code: "annual", label: "Annuel" },
] as const;
export const REVENUE_PERIOD_CODES = ["one_time", "monthly", "annual"] as const;
