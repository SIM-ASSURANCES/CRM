// Fonctionnalités que l'administrateur peut activer ou désactiver pour TOUS les utilisateurs (interrupteur global, pas par
// utilisateur : les droits de chacun restent ceux de son rôle). Une fonctionnalité désactivée disparaît du menu et ses
// écrans répondent « page introuvable ».
//
// Ne sont volontairement PAS désactivables : le tableau de bord et toute l'administration (utilisateurs, équipes, objectifs,
// automatisations, import, audit et cet écran lui-même), pour qu'un administrateur ne puisse jamais s'enfermer dehors.

export type FeatureGroup = "Clients" | "Suivi" | "Prospects" | "Reporting";

export type FeatureDefinition = {
  key: string;
  label: string;
  group: FeatureGroup;
  description: string;
  /** Écrans concernés (pour l'information de l'administrateur). */
  screens: string[];
};

export const FEATURES = [
  {
    key: "comptes",
    label: "Comptes",
    group: "Clients",
    description: "Fiches entreprises, groupes et filiales, détection des doublons et fusion.",
    screens: ["/comptes"],
  },
  {
    key: "contacts",
    label: "Contacts",
    group: "Clients",
    description: "Contacts des comptes, rôles d'achat et rattachements.",
    screens: ["/contacts"],
  },
  {
    key: "opportunites",
    label: "Opportunités",
    group: "Clients",
    description: "Pipeline Kanban, changements d'étape, clôture gagnée ou perdue et conversion des prospects.",
    screens: ["/opportunites"],
  },
  {
    key: "taches",
    label: "Tâches",
    group: "Suivi",
    description: "Tâches de suivi et de relance, avec leurs échéances.",
    screens: ["/taches"],
  },
  {
    key: "activites",
    label: "Activités",
    group: "Suivi",
    description: "Journal des appels, e-mails, rendez-vous et notes.",
    screens: ["/activites"],
  },
  {
    key: "messagerie",
    label: "Messagerie Microsoft 365",
    group: "Suivi",
    description: "Connexion de la messagerie et synchronisation des e-mails dans l'historique des comptes.",
    screens: ["/integrations"],
  },
  {
    key: "prospects",
    label: "Prospects",
    group: "Prospects",
    description: "Les cinq écrans : Reporting prospect (saisie), prospects qualifiés, propositions envoyées, valeur du pipeline et taux de transformation.",
    screens: ["/prospects", "/prospects/qualifies", "/prospects/propositions", "/prospects/pipeline", "/prospects/gagnes"],
  },
  {
    key: "previsions",
    label: "Prévisions",
    group: "Reporting",
    description: "Prévisions de chiffre d'affaires, objectifs et exports associés.",
    screens: ["/rapports/previsions"],
  },
  {
    key: "historique_prospects",
    label: "Historique des prospects",
    group: "Reporting",
    description: "Nouveaux prospects par jour et par semaine, et nombre de prospects à chaque étape.",
    screens: ["/rapports/prospects"],
  },
  {
    key: "motifs_perte",
    label: "Motifs de perte",
    group: "Reporting",
    description: "Analyse des opportunités perdues par motif, produit, secteur et commercial, avec leurs exports.",
    screens: ["/rapports/pertes"],
  },
] as const satisfies readonly FeatureDefinition[];

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const FEATURE_KEYS = FEATURES.map((feature) => feature.key) as [FeatureKey, ...FeatureKey[]];

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURE_KEYS as readonly string[]).includes(value);
}

// Stockage : UNE ligne de la table `settings` par fonctionnalité (`features.<clé>`, valeur `{ "enabled": false }`), jamais une
// liste commune : deux administrateurs qui basculent deux fonctionnalités en même temps ne peuvent pas s'écraser. Sans ligne,
// la fonctionnalité est active (comportement par défaut, y compris pour une nouvelle fonctionnalité ajoutée plus tard).
export const FEATURE_SETTING_PREFIX = "features.";

export function featureSettingKey(key: FeatureKey): string {
  return `${FEATURE_SETTING_PREFIX}${key}`;
}

/** Retrouve la fonctionnalité d'une clé de réglage (`features.taches` → `taches`) ; undefined si ce n'en est pas une. */
export function featureKeyFromSetting(settingKey: string): FeatureKey | undefined {
  const key = settingKey.startsWith(FEATURE_SETTING_PREFIX) ? settingKey.slice(FEATURE_SETTING_PREFIX.length) : "";
  return isFeatureKey(key) ? key : undefined;
}

/** Lecture tolérante de la valeur : seule la valeur explicite `{ "enabled": false }` désactive ; tout le reste = actif. */
export function isSettingEnabled(value: unknown): boolean {
  return !(typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === false);
}
