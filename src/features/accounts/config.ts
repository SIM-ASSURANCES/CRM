// Listes contrôlées des comptes et contacts (CDC 3.1 et 3.3). Les valeurs sont stockées sous forme de codes
// (contraintes CHECK en base) et affichées avec leur libellé. Listes à valider avec le métier.

type Item = { readonly code: string; readonly label: string };

/** Libellé d'un code ; le code lui-même si inconnu (donnée ancienne ou importée). */
export function labelOf(list: readonly Item[], code: string | null | undefined): string {
  if (!code) return "—";
  return list.find((item) => item.code === code)?.label ?? code;
}

function codesOf<const T extends readonly Item[]>(list: T) {
  return list.map((item) => item.code) as unknown as readonly [T[number]["code"], ...T[number]["code"][]];
}

export const ACCOUNT_STATUSES = [
  { code: "prospect", label: "Prospect" },
  { code: "client", label: "Client" },
  { code: "inactive", label: "Inactif" },
  { code: "partner", label: "Partenaire" },
] as const;
export const ACCOUNT_STATUS_CODES = codesOf(ACCOUNT_STATUSES);

export const ACCOUNT_SOURCES = [
  { code: "event", label: "Événement" },
  { code: "referral", label: "Recommandation" },
  { code: "campaign", label: "Campagne" },
  { code: "prospecting", label: "Prospection" },
  { code: "other", label: "Autre" },
] as const;
export const ACCOUNT_SOURCE_CODES = codesOf(ACCOUNT_SOURCES);

export const COUNTRIES = [
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "SN", label: "Sénégal" },
  { code: "BF", label: "Burkina Faso" },
  { code: "ML", label: "Mali" },
  { code: "GN", label: "Guinée" },
  { code: "TG", label: "Togo" },
  { code: "BJ", label: "Bénin" },
  { code: "NE", label: "Niger" },
  { code: "CM", label: "Cameroun" },
  { code: "GA", label: "Gabon" },
  { code: "FR", label: "France" },
  { code: "BE", label: "Belgique" },
] as const;
export const COUNTRY_CODES = codesOf(COUNTRIES);

export const CONTACT_STATUSES = [
  { code: "active", label: "Actif" },
  { code: "to_confirm", label: "À confirmer" },
  { code: "left", label: "Parti" },
] as const;
export const CONTACT_STATUS_CODES = codesOf(CONTACT_STATUSES);

export const PREFERRED_CHANNELS = [
  { code: "email", label: "E-mail" },
  { code: "phone", label: "Téléphone" },
  { code: "whatsapp", label: "WhatsApp" },
  { code: "in_person", label: "En personne" },
] as const;
export const PREFERRED_CHANNEL_CODES = codesOf(PREFERRED_CHANNELS);

// Rôles d'achat (CDC 3.3).
export const ROLE_TYPES = [
  { code: "decision_maker", label: "Décideur" },
  { code: "validator", label: "Validateur" },
  { code: "buyer", label: "Acheteur" },
  { code: "prescriber", label: "Prescripteur" },
  { code: "user", label: "Utilisateur" },
  { code: "other", label: "Autre" },
] as const;
export const ROLE_TYPE_CODES = codesOf(ROLE_TYPES);

export const INFLUENCE_LEVELS = [
  { code: "high", label: "Fort" },
  { code: "medium", label: "Moyen" },
  { code: "low", label: "Faible" },
] as const;
export const INFLUENCE_CODES = codesOf(INFLUENCE_LEVELS);
