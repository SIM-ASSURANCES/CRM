import type { LeadThresholds } from "@/features/leads/config";

// Règles métier pures (sans accès base) : testables sans environnement.

export type FieldErrors = Record<string, string[]>;

/**
 * Règles de qualification et de gain (Excel : fenêtre « produit + chiffre d'affaires » ; CDC 14).
 * Retourne les erreurs par champ, ou null si tout est conforme.
 */
export function validateLeadRules(
  input: { progress: number; productId?: string; expectedRevenue?: number; wonConfirmed: boolean },
  thresholds: LeadThresholds,
): FieldErrors | null {
  const fieldErrors: FieldErrors = {};

  if (input.progress > thresholds.qualifiedAbove) {
    if (!input.productId) fieldErrors.productId = ["Le produit proposé est obligatoire à cette étape."];
    if (input.expectedRevenue === undefined) {
      fieldErrors.expectedRevenue = ["Le chiffre d'affaires attendu est obligatoire à cette étape."];
    }
  }
  if (input.progress === 100 && !input.wonConfirmed) {
    fieldErrors.wonConfirmed = ["Confirmez que le contrat est signé et que le premier paiement est validé."];
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}
