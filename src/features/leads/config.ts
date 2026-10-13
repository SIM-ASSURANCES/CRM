// Constantes métier des prospects, issues du parcours Excel (feuille « Reporting prospect ») et du CDC 5.2.
// Les seuils de bascule entre écrans sont des PARAMÈTRES (table settings), pas des valeurs codées en dur :
// les questions I1, I2 et I4 du plan (section 12) sont encore à arbitrer avec le métier.

export const PROGRESS_STEPS = [10, 20, 40, 60, 80, 90, 100] as const;
export type Progress = (typeof PROGRESS_STEPS)[number];

export function isProgress(value: number): value is Progress {
  return (PROGRESS_STEPS as readonly number[]).includes(value);
}

export const STAGE_LABELS: Record<Progress, string> = {
  10: "Identification / prospection",
  20: "Qualification",
  40: "Découverte approfondie",
  60: "Présentation de l'offre",
  80: "Négociation / finalisation",
  90: "Closing / signature",
  100: "Gagné",
};

// Critères de sortie (texte de la règle de gestion de l'Excel).
export const STAGE_CRITERIA: Record<Progress, string> = {
  10: "Prospect identifié, premier contact initié (e-mail, LinkedIn).",
  20: "Le besoin et le budget global sont validés. Interlocuteur identifié.",
  40: "Réunion de cadrage effectuée. Le prospect partage ses données et ses points de douleur clés.",
  60: "Offre sur mesure présentée et proposition commerciale (devis) envoyée.",
  80: "L'offre est acceptée sur le principe. Discussion sur les clauses contractuelles ou le prix final.",
  90: "Contrat envoyé pour signature juridique ou électronique.",
  100: "Contrat signé par les deux parties et premier paiement validé.",
};

export function stageLabel(progress: number): string {
  return isProgress(progress) ? STAGE_LABELS[progress] : `${progress} %`;
}

export type LeadThresholds = {
  /** Au-dessus de ce pourcentage (strictement), le prospect passe dans « Prospects qualifiés ». */
  qualifiedAbove: number;
  /** Au-dessus de ce pourcentage (strictement), il passe dans « Propositions envoyées ». */
  proposalAbove: number;
  /** À partir de ce pourcentage (inclus, et sous 100), il compte dans « Valeur du pipeline ». */
  pipelineMin: number;
};

// Valeurs de l'Excel : « > 40 % » qualifié, « > 60 % » proposition envoyée, offres à 80 % et 90 % pour le pipeline.
export const DEFAULT_THRESHOLDS: LeadThresholds = { qualifiedAbove: 40, proposalAbove: 60, pipelineMin: 80 };
export const THRESHOLDS_SETTING_KEY = "leads.thresholds";

// Motifs de perte (CDC 5.4).
export const LOSS_REASONS = [
  { code: "price", label: "Prix" },
  { code: "guarantees", label: "Garanties" },
  { code: "competition", label: "Concurrence" },
  { code: "no_budget", label: "Absence de budget" },
  { code: "no_decision", label: "Absence de décision" },
  { code: "timing", label: "Timing" },
  { code: "existing_relationship", label: "Relation existante" },
  { code: "abandoned", label: "Dossier abandonné" },
  { code: "other", label: "Autre" },
] as const;

export type LossReasonCode = (typeof LOSS_REASONS)[number]["code"];
export const LOSS_REASON_CODES = LOSS_REASONS.map((r) => r.code) as [LossReasonCode, ...LossReasonCode[]];

export function lossReasonLabel(code: string | null): string {
  return LOSS_REASONS.find((r) => r.code === code)?.label ?? "—";
}

// Liste contrôlée de secteurs (CDC 3.1) ; à valider avec le métier.
export const SECTORS = [
  "Mine et énergie",
  "Agriculture et agro-industrie",
  "Commerce et distribution",
  "Transport et logistique",
  "Banque et finance",
  "Assurance",
  "BTP et immobilier",
  "Santé",
  "Éducation",
  "Télécommunications et numérique",
  "Industrie",
  "Services aux entreprises",
  "Hôtellerie et restauration",
  "Administration et ONG",
  "Autre",
] as const;

export const CURRENCY = "XOF";
