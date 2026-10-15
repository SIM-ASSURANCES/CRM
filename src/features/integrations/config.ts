// Constantes de l'intégration Microsoft 365 (CDC 7.3). Aucune dépendance serveur : importable par l'interface.
// Importé par connection.ts, sync.ts, la page /integrations et les tests ; aucune donnée, uniquement des constantes.
// Instruction de l'utilisateur : « Passe à la phase 5 : intégrations ».

export const PROVIDER_MICROSOFT = "microsoft";

export const CONNECTION_STATUSES = ["active", "needs_reconnect", "revoked"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  active: "Connectée",
  needs_reconnect: "À reconnecter",
  revoked: "Déconnectée",
};

export const SYNC_KIND_LABELS: Record<string, string> = {
  mail_sync: "Synchronisation des e-mails",
  connected: "Connexion",
  disconnected: "Déconnexion",
  token_refresh: "Renouvellement de l'accès",
  webhook: "Notification Microsoft",
  subscription: "Abonnement aux notifications",
};

export const SYNC_TRIGGER_LABELS: Record<string, string> = {
  manual: "Manuel",
  schedule: "Planifié",
  webhook: "Notification",
  system: "Système",
};

export const SYNC_STATUS_LABELS: Record<string, string> = {
  running: "En cours",
  success: "Réussie",
  partial: "Partielle",
  error: "En échec",
};

/** Première synchronisation : on remonte de 30 jours seulement (pas tout l'historique de la boîte). */
export const INITIAL_SYNC_DAYS = 30;

/** Délai d'expiration de la demande de connexion (le temps de passer par la page de consentement). */
export const OAUTH_STATE_TTL_MINUTES = 10;

/** Un verrou de synchronisation plus ancien est considéré comme orphelin (processus interrompu) et peut être repris. */
export const SYNC_LOCK_TIMEOUT_MINUTES = 10;

/** Intervalle minimal entre deux synchronisations planifiées d'une même connexion. */
export const SYNC_INTERVAL_MINUTES = 15;

/** Pages lues au plus par dossier et par exécution (50 messages par page) : borne la durée d'un appel planifié. */
export const MAX_PAGES_PER_FOLDER = 20;

/** Nombre de connexions traitées au plus par exécution planifiée. */
export const MAX_CONNECTIONS_PER_RUN = 25;

/** Durée demandée pour un abonnement aux notifications (Microsoft plafonne les messages Outlook à 4 230 minutes). */
export const SUBSCRIPTION_LIFETIME_MINUTES = 4200;

/** Un abonnement est renouvelé quand il expire dans moins de 12 heures. */
export const SUBSCRIPTION_RENEW_BEFORE_MINUTES = 12 * 60;

/** Un échec d'abonnement n'est inscrit au journal qu'une fois par période : le repli par lecture régulière fonctionne. */
export const SUBSCRIPTION_ERROR_LOG_HOURS = 6;

/** Un jeton d'accès est renouvelé quand il expire dans moins de 2 minutes. */
export const TOKEN_REFRESH_MARGIN_SECONDS = 120;

/** Nombre d'événements du journal affichés sur la page de l'utilisateur. */
export const SYNC_EVENTS_SHOWN = 15;

/** Clé du paramètre (table settings) : domaines dont les échanges ne sont jamais importés (liste personnelle, CDC 7.1). */
export const EXCLUDED_DOMAINS_SETTING_KEY = "integrations.mail.excluded_domains";
