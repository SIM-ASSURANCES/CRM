// Règles métier pures des comptes (sans accès base) : testables sans environnement.

/** « Société Générale d'Électricité » → « societegeneraledelectricite » : compare des noms malgré accents et ponctuation. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** « marie@Client.CI » → « client.ci » ; null si l'adresse est invalide. */
export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Rattacher `accountId` à `newParentId` créerait-il un cycle (un compte qui serait son propre ancêtre) ?
 * `parentOf` donne le parent direct d'un compte (null = racine). Le parcours est borné pour résister à des données
 * déjà corrompues.
 */
export function wouldCreateCycle(
  accountId: string,
  newParentId: string | null,
  parentOf: (id: string) => string | null | undefined,
): boolean {
  if (newParentId === null) return false;
  const seen = new Set<string>();
  let current: string | null | undefined = newParentId;
  while (current) {
    if (current === accountId) return true;
    if (seen.has(current)) return true; // boucle déjà présente en données : on refuse de l'aggraver
    seen.add(current);
    current = parentOf(current);
  }
  return false;
}

export type CompletenessInput = {
  legalName: string | null;
  sector: string | null;
  ownerUserId: string | null;
  legalIdentifier: string | null;
  city: string | null;
  phone: string | null;
  emailDomain: string | null;
  employeeCount: number | null;
  revenueAmount: number | null;
};

type Field = { key: keyof CompletenessInput; label: string };

// Obligatoires pour le reporting (CDC 3.1) : raison sociale, secteur, propriétaire commercial.
export const REQUIRED_FIELDS: readonly Field[] = [
  { key: "legalName", label: "Raison sociale" },
  { key: "sector", label: "Secteur d'activité" },
  { key: "ownerUserId", label: "Propriétaire commercial" },
];

// Recommandés : enrichissent la segmentation et la détection de doublons.
export const RECOMMENDED_FIELDS: readonly Field[] = [
  { key: "legalIdentifier", label: "Identifiant légal" },
  { key: "city", label: "Ville" },
  { key: "phone", label: "Téléphone" },
  { key: "emailDomain", label: "Domaine e-mail" },
  { key: "employeeCount", label: "Effectif" },
  { key: "revenueAmount", label: "Chiffre d'affaires" },
];

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/** Champs manquants, pour guider la saisie (parcours CDC 13.1 : « le système affiche les champs manquants »). */
export function missingAccountFields(account: CompletenessInput): { required: string[]; recommended: string[] } {
  return {
    required: REQUIRED_FIELDS.filter((f) => !isFilled(account[f.key])).map((f) => f.label),
    recommended: RECOMMENDED_FIELDS.filter((f) => !isFilled(account[f.key])).map((f) => f.label),
  };
}

/** Pourcentage de champs suivis renseignés (obligatoires + recommandés). */
export function completenessPercent(account: CompletenessInput): number {
  const all = [...REQUIRED_FIELDS, ...RECOMMENDED_FIELDS];
  const filled = all.filter((f) => isFilled(account[f.key])).length;
  return Math.round((filled / all.length) * 100);
}
