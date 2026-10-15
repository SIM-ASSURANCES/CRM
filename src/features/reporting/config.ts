// Constantes du reporting avancé (CDC 8.2 et 8.3). Aucune dépendance serveur : importable par l'interface.

export const GRANULARITIES = [
  { code: "month", label: "Mois" },
  { code: "quarter", label: "Trimestre" },
  { code: "year", label: "Année" },
] as const;
export type Granularity = (typeof GRANULARITIES)[number]["code"];
export const GRANULARITY_CODES = ["month", "quarter", "year"] as const;

/** Axes de segmentation du forecast (CDC 8.2) : produit ou risque, équipe, commercial, secteur et groupe de comptes. */
export const SEGMENTS = [
  { code: "none", label: "Aucune segmentation" },
  { code: "product", label: "Produit / risque" },
  { code: "team", label: "Équipe" },
  { code: "owner", label: "Commercial" },
  { code: "sector", label: "Secteur" },
  { code: "group", label: "Groupe de comptes" },
] as const;
export type Segment = (typeof SEGMENTS)[number]["code"];
export const SEGMENT_CODES = ["none", "product", "team", "owner", "sector", "group"] as const;

/** Axes de croisement des motifs de perte (CDC 5.4) : produit, secteur, commercial, taille du compte (+ équipe). */
export const LOSS_DIMENSIONS = [
  { code: "product", label: "Produit / risque" },
  { code: "sector", label: "Secteur" },
  { code: "owner", label: "Commercial" },
  { code: "size", label: "Taille du compte" },
  { code: "team", label: "Équipe" },
] as const;
export type LossDimension = (typeof LOSS_DIMENSIONS)[number]["code"];
export const LOSS_DIMENSION_CODES = ["product", "sector", "owner", "size", "team"] as const;

/** Tranches de taille d'un compte, d'après son effectif (CDC 5.4 : « taille du compte »). */
export const SIZE_BANDS = [
  { code: "small", label: "Petite (moins de 50 salariés)" },
  { code: "medium", label: "Moyenne (50 à 249)" },
  { code: "large", label: "Grande (250 à 999)" },
  { code: "xlarge", label: "Très grande (1 000 et plus)" },
  { code: "unknown", label: "Taille inconnue" },
] as const;

/** Au plus 36 périodes par rapport : au-delà, le tableau et le graphique n'ont plus de sens. */
export const MAX_PERIODS = 36;

/** Plafond de lignes d'un export de détail ; un rapport agrégé est toujours bien en dessous. */
export const EXPORT_ROW_LIMIT = 5000;

export const REPORT_KINDS = [
  { code: "forecast", label: "Prévisions de chiffre d'affaires" },
  { code: "losses", label: "Motifs de perte" },
  { code: "opportunities", label: "Détail des opportunités" },
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number]["code"];
export const REPORT_KIND_CODES = ["forecast", "losses", "opportunities"] as const;

export const EXPORT_FORMATS = ["csv", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Dictionnaire des KPI (CDC 8.3 : « identiques dans les écrans et les exports », REC-10). Une seule source : affichée sur
 * les pages de rapport, et reproduite dans l'onglet « Définitions » de chaque export XLSX et à la fin de chaque CSV.
 */
export const KPI_DEFINITIONS = [
  {
    code: "annualized",
    label: "Montant annualisé",
    definition: "Montant d'une opportunité ramené à l'année : mensuel × 12 ; annuel et unique tels que saisis. Tous les totaux du reporting utilisent cette valeur.",
  },
  {
    code: "gross",
    label: "Pipeline brut",
    definition: "Somme des montants annualisés des opportunités OUVERTES dont la date de clôture prévisionnelle tombe dans la période.",
  },
  {
    code: "weighted",
    label: "Pipeline pondéré",
    definition: "Somme de (montant annualisé × probabilité de l'étape) pour les mêmes opportunités ouvertes.",
  },
  {
    code: "won",
    label: "Opportunités gagnées",
    definition: "Nombre d'opportunités gagnées dont la date de clôture réelle tombe dans la période.",
  },
  {
    code: "signed",
    label: "Revenu signé",
    definition: "Somme des montants annualisés des opportunités gagnées dans la période. La définition comptable du revenu (prime, commission, honoraires) reste à confirmer par le métier.",
  },
  {
    code: "forecast",
    label: "Forecast",
    definition: "Revenu signé + pipeline pondéré de la période : ce que l'on attend de réaliser, en comptant déjà ce qui est gagné.",
  },
  {
    code: "target",
    label: "Objectif",
    definition: "Somme des objectifs mensuels des commerciaux concernés, pour les mois de la période. Un objectif trimestriel ou annuel n'est jamais saisi : c'est la somme des mois.",
  },
  {
    code: "attainment",
    label: "Écart à l'objectif",
    definition: "Écart = forecast − objectif. Taux = forecast ÷ objectif ; « non calculable » quand l'objectif est nul ou absent, plutôt qu'un pourcentage trompeur.",
  },
  {
    code: "lost",
    label: "Opportunités perdues",
    definition: "Nombre et montant annualisé des opportunités perdues dont la date de clôture tombe dans la période. Elles ne comptent jamais dans le pipeline ni dans le forecast.",
  },
] as const;
