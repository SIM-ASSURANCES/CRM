// Import initial de données (CDC 11, 14 et 16) : champs importables, synonymes d'en-têtes et limites.

export const IMPORT_ENTITIES = ["accounts", "contacts"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_ENTITY_LABELS: Record<ImportEntity, string> = {
  accounts: "Comptes (entreprises)",
  contacts: "Contacts",
};

/** Un import traite un fichier en une seule requête : au-delà, le fichier doit être découpé (limite documentée). */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Une cellule plus longue est tronquée : le lot garde une taille bornée en base. */
export const MAX_CELL_LENGTH = 2000;

export const BATCH_STATUS_LABELS: Record<string, string> = {
  uploaded: "Fichier déposé",
  analyzed: "Analysé",
  importing: "Import en cours",
  imported: "Importé",
  cancelled: "Annulé",
};

export type ImportField = {
  key: string;
  label: string;
  /** Obligatoire : la colonne doit être associée (ou, pour le secteur, une valeur par défaut fournie). */
  required: boolean;
  /** Intitulés de colonne usuels, pour proposer l'association automatiquement. */
  aliases: string[];
  hint?: string;
  /** Champ recommandé : compté dans le rapport de qualité quand il est vide. */
  recommended?: boolean;
};

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  accounts: [
    { key: "legalName", label: "Raison sociale", required: true, aliases: ["entreprise", "societe", "denomination", "nom entreprise", "company", "nom de la societe"] },
    { key: "tradeName", label: "Nom commercial", required: false, aliases: ["enseigne", "marque", "trade name"] },
    {
      key: "legalIdentifier",
      label: "Identifiant légal",
      required: false,
      recommended: true,
      aliases: ["rccm", "ncc", "numero contribuable", "compte contribuable", "identifiant", "siret", "registre de commerce"],
      hint: "RCCM, numéro de compte contribuable… : sert à détecter les doublons.",
    },
    { key: "sector", label: "Secteur d'activité", required: true, aliases: ["secteur", "activite", "domaine d activite", "industry"], hint: "Valeur de la liste du CRM, ou secteur par défaut." },
    { key: "status", label: "Statut", required: false, aliases: ["type", "statut du compte", "client prospect"], hint: "Prospect, Client, Inactif ou Partenaire." },
    { key: "source", label: "Source d'acquisition", required: false, aliases: ["origine", "provenance", "canal d acquisition"] },
    { key: "employeeCount", label: "Effectif", required: false, recommended: true, aliases: ["nombre de salaries", "salaries", "employes", "employees", "taille"] },
    { key: "revenueAmount", label: "Chiffre d'affaires (FCFA)", required: false, recommended: true, aliases: ["ca", "chiffre d affaires", "revenue", "ca annuel"] },
    { key: "revenueYear", label: "Année du chiffre d'affaires", required: false, aliases: ["annee ca", "annee de reference", "exercice"] },
    { key: "phone", label: "Téléphone", required: false, recommended: true, aliases: ["telephone", "tel", "standard", "numero de telephone", "mobile"] },
    { key: "emailDomain", label: "Domaine e-mail", required: false, recommended: true, aliases: ["domaine", "site web", "site", "domain"], hint: "Exemple : client.ci" },
    { key: "addressLine", label: "Adresse", required: false, aliases: ["adresse postale", "rue", "address"] },
    { key: "city", label: "Ville", required: false, recommended: true, aliases: ["commune", "localite", "city"] },
    { key: "country", label: "Pays", required: false, aliases: ["code pays", "country"], hint: "Libellé ou code (CI, SN…)." },
    { key: "collectiveAgreement", label: "Convention collective", required: false, aliases: ["convention", "cc"] },
    { key: "ownerEmail", label: "E-mail du responsable commercial", required: false, aliases: ["responsable", "commercial", "proprietaire", "owner", "email commercial"], hint: "Sinon, le responsable par défaut." },
  ],
  contacts: [
    { key: "firstName", label: "Prénom", required: true, aliases: ["prenoms", "first name", "firstname"] },
    { key: "lastName", label: "Nom", required: true, aliases: ["nom de famille", "last name", "lastname", "surname"] },
    {
      key: "accountRef",
      label: "Compte (raison sociale ou identifiant légal)",
      required: true,
      aliases: ["entreprise", "societe", "raison sociale", "compte", "company", "rccm"],
      hint: "Le compte doit déjà exister : importez d'abord les comptes.",
    },
    { key: "jobTitle", label: "Fonction", required: false, recommended: true, aliases: ["poste", "titre", "job title", "role"] },
    { key: "department", label: "Service", required: false, aliases: ["departement", "direction"] },
    { key: "email", label: "E-mail", required: false, recommended: true, aliases: ["adresse e mail", "mail", "courriel", "email professionnel", "e mail"] },
    { key: "phone", label: "Téléphone", required: false, recommended: true, aliases: ["telephone", "tel", "mobile", "portable", "numero de telephone"] },
    { key: "status", label: "Statut", required: false, aliases: ["etat", "statut du contact"], hint: "Actif, À confirmer ou Parti." },
    { key: "ownerEmail", label: "E-mail du responsable commercial", required: false, aliases: ["responsable", "commercial", "proprietaire", "owner"] },
  ],
};

/** Valeurs par défaut choisies à l'étape d'association des colonnes. */
export type ImportDefaults = {
  ownerUserId: string;
  sector?: string;
  status?: string;
  country?: string;
};

/** Fichier modèle téléchargeable : en-têtes exacts et une ligne d'exemple. */
export function templateRows(entity: ImportEntity): string[][] {
  const fields = IMPORT_FIELDS[entity];
  const example: Record<ImportEntity, Record<string, string>> = {
    accounts: {
      legalName: "Société Exemple SARL",
      legalIdentifier: "CI-ABJ-2020-B-12345",
      sector: "Commerce et distribution",
      status: "Prospect",
      employeeCount: "120",
      phone: "0102030405",
      emailDomain: "exemple.ci",
      city: "Abidjan",
      country: "Côte d'Ivoire",
    },
    contacts: {
      firstName: "Awa",
      lastName: "Koné",
      accountRef: "Société Exemple SARL",
      jobTitle: "Directrice financière",
      email: "awa.kone@exemple.ci",
      phone: "0102030405",
      status: "Actif",
    },
  };
  return [fields.map((field) => field.label), fields.map((field) => example[entity][field.key] ?? "")];
}

export function isImportEntity(value: string): value is ImportEntity {
  return (IMPORT_ENTITIES as readonly string[]).includes(value);
}
