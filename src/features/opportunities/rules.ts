import { STAGE_LABELS } from "@/features/leads/config";
import type { FieldErrors } from "@/lib/forms";

// Règles métier pures des opportunités (sans accès base) : testables sans environnement.

/** Montant pondéré = montant × probabilité de l'étape (CDC 5.3). Calculé côté serveur, jamais fourni par le navigateur. */
export function weightedAmount(amount: number, stage: number): number {
  return Math.round(amount * stage) / 100;
}

export type StageMoveInput = {
  from: number;
  to: number;
  productId?: string | null;
  amount: number;
  /** Case « le critère de l'étape est rempli » (obligatoire pour avancer). */
  criteriaConfirmed: boolean;
  /** Case « contrat signé et premier paiement validé » (obligatoire pour gagner). */
  wonConfirmed: boolean;
};

/**
 * Changement d'étape (CDC 5.1 : « chaque changement d'étape peut déclencher une checklist ou des champs obligatoires ») :
 * - avancer exige la confirmation du critère de l'étape visée ;
 * - au-delà du seuil de qualification, le produit et un montant sont obligatoires ;
 * - passer à 100 % (gagné) exige la confirmation du contrat signé et du premier paiement (CDC 14) ;
 * - reculer est possible sans confirmation (et tracé dans l'historique).
 */
export function validateStageMove(input: StageMoveInput, qualifiedAbove = 40): FieldErrors | null {
  const errors: FieldErrors = {};

  if (input.to === input.from) errors.targetStage = ["L'opportunité est déjà à cette étape."];

  if (input.to > qualifiedAbove) {
    if (!input.productId) errors.productId = ["Le produit est obligatoire à cette étape : complétez la fiche."];
    if (!(input.amount > 0)) errors.amount = ["Le montant estimé est obligatoire à cette étape : complétez la fiche."];
  }

  if (input.to === 100) {
    if (!input.wonConfirmed) {
      errors.wonConfirmed = ["Confirmez que le contrat est signé et que le premier paiement est validé."];
    }
  } else if (input.to > input.from && !input.criteriaConfirmed) {
    errors.criteriaConfirmed = [`Confirmez que le critère de l'étape « ${STAGE_LABELS[input.to as keyof typeof STAGE_LABELS] ?? input.to} » est rempli.`];
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/** « Groupe Ouattara – RELAX Auto – 11/2026 » : nom explicite compte – produit/risque – échéance (CDC 5.1). */
export function defaultOpportunityName(accountName: string, productLabel: string | null, closeDate: Date | null): string {
  const month = closeDate ? `${String(closeDate.getUTCMonth() + 1).padStart(2, "0")}/${closeDate.getUTCFullYear()}` : null;
  return [accountName, productLabel ?? "Opportunité", month].filter(Boolean).join(" – ");
}

function startOfDayUtc(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Une prochaine action est en retard si sa date est antérieure à aujourd'hui (le jour même n'est pas en retard). */
export function isOverdue(date: Date | null, now: Date = new Date()): boolean {
  return date !== null && date.getTime() < startOfDayUtc(now);
}

export type Summarizable = { amount: number; stage: number };

/** Total d'une colonne ou d'un portefeuille : nombre, montant brut et montant pondéré. */
export function summarize(items: readonly Summarizable[]): { count: number; gross: number; weighted: number } {
  let gross = 0;
  let weighted = 0;
  for (const item of items) {
    gross += item.amount;
    weighted += weightedAmount(item.amount, item.stage);
  }
  return { count: items.length, gross: Math.round(gross * 100) / 100, weighted: Math.round(weighted * 100) / 100 };
}
