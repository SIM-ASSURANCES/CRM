import { normalizeName } from "@/features/accounts/rules";
import { matchOption } from "@/features/imports/rules";
import { SECTORS } from "@/features/leads/config";

// Reconnaissance des valeurs d'un fichier de migration (phase 7) : secteurs, produits, dates, pourcentages, statuts.
// Un fichier réel contient des variantes (« Assurances », « BTP », « 40 % », « 13/10/2026 »). Ce module les ramène aux
// valeurs du CRM SANS rien deviner : une valeur inconnue reste inconnue, et l'administrateur la rapproche lui-même
// (table de correspondance du lot), plutôt que de la voir rejetée ou, pire, mal classée.

/** Correspondances choisies par l'administrateur : valeur du fichier (clé normalisée) → valeur du CRM. */
export type ValueMap = { sector?: Record<string, string>; product?: Record<string, string> };

export type UnrecognizedField = "sector" | "product";

// --- Secteurs ----------------------------------------------------------------------------------------------------

const SECTOR_OPTIONS = SECTORS.map((sector) => ({ code: sector, label: sector }));

/**
 * Variantes courantes → secteur du CRM (clés passées par `normalizeName` : sans accent, espace ni ponctuation).
 * Liste de départ à compléter avec le métier : toute variante absente est signalée à l'analyse, jamais devinée.
 */
export const SECTOR_ALIASES: Record<string, (typeof SECTORS)[number]> = {
  mine: "Mine et énergie",
  mines: "Mine et énergie",
  energie: "Mine et énergie",
  petrole: "Mine et énergie",
  petroleetgaz: "Mine et énergie",
  agriculture: "Agriculture et agro-industrie",
  agro: "Agriculture et agro-industrie",
  agroindustrie: "Agriculture et agro-industrie",
  agroalimentaire: "Agriculture et agro-industrie",
  commerce: "Commerce et distribution",
  distribution: "Commerce et distribution",
  negoce: "Commerce et distribution",
  grandedistribution: "Commerce et distribution",
  transport: "Transport et logistique",
  transports: "Transport et logistique",
  logistique: "Transport et logistique",
  transit: "Transport et logistique",
  banque: "Banque et finance",
  banques: "Banque et finance",
  finance: "Banque et finance",
  microfinance: "Banque et finance",
  banqueetfinance: "Banque et finance",
  assurances: "Assurance",
  courtage: "Assurance",
  btp: "BTP et immobilier",
  batiment: "BTP et immobilier",
  construction: "BTP et immobilier",
  immobilier: "BTP et immobilier",
  travauxpublics: "BTP et immobilier",
  sante: "Santé",
  pharmacie: "Santé",
  clinique: "Santé",
  hopital: "Santé",
  medical: "Santé",
  education: "Éducation",
  enseignement: "Éducation",
  formation: "Éducation",
  ecole: "Éducation",
  universite: "Éducation",
  telecom: "Télécommunications et numérique",
  telecoms: "Télécommunications et numérique",
  telecommunications: "Télécommunications et numérique",
  numerique: "Télécommunications et numérique",
  informatique: "Télécommunications et numérique",
  it: "Télécommunications et numérique",
  tic: "Télécommunications et numérique",
  industries: "Industrie",
  manufacture: "Industrie",
  services: "Services aux entreprises",
  conseil: "Services aux entreprises",
  audit: "Services aux entreprises",
  hotellerie: "Hôtellerie et restauration",
  restauration: "Hôtellerie et restauration",
  hotel: "Hôtellerie et restauration",
  restaurant: "Hôtellerie et restauration",
  tourisme: "Hôtellerie et restauration",
  administration: "Administration et ONG",
  administrationpublique: "Administration et ONG",
  ong: "Administration et ONG",
  association: "Administration et ONG",
  associations: "Administration et ONG",
  autres: "Autre",
  divers: "Autre",
};

/** Secteur du CRM correspondant à une valeur du fichier : correspondance du lot, puis libellé exact, puis variante connue. */
export function resolveSector(raw: string, map?: ValueMap["sector"]): string | null {
  const key = normalizeName(raw);
  if (key === "") return null;
  const mapped = map?.[key];
  if (mapped && (SECTORS as readonly string[]).includes(mapped)) return mapped;
  return matchOption(raw, SECTOR_OPTIONS) ?? SECTOR_ALIASES[key] ?? null;
}

// --- Produits ----------------------------------------------------------------------------------------------------

export type ProductRef = { id: string; code: string; label: string };

/**
 * Clé de comparaison d'un produit. Contrairement à `normalizeName`, « + » devient « plus » : « SECUR Maison » et
 * « SECUR Maison+ » sont deux produits distincts, qu'une clé purement alphanumérique confondrait.
 */
export function productKey(value: string): string {
  return normalizeName(value.replace(/\+/g, " plus "));
}

/** Produit du catalogue correspondant à une valeur du fichier : correspondance du lot (par code), puis code ou libellé. */
export function resolveProduct(raw: string, products: readonly ProductRef[], map?: ValueMap["product"]): ProductRef | null {
  const key = productKey(raw);
  if (key === "") return null;
  const mappedCode = map?.[key];
  if (mappedCode) {
    const mapped = products.find((product) => product.code === mappedCode);
    if (mapped) return mapped;
  }
  return products.find((product) => productKey(product.code) === key || productKey(product.label) === key) ?? null;
}

// --- Dates, pourcentages, statuts --------------------------------------------------------------------------------

/**
 * Date d'un fichier → « AAAA-MM-JJ », ou null si elle n'existe pas au calendrier.
 * Formats lus : AAAA-MM-JJ (avec heure éventuelle), JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA ; une année à deux chiffres vaut 20AA.
 */
export function parseSourceDate(raw: string): string | null {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (french) {
    [day, month] = [Number(french[1]), Number(french[2])];
    year = french[3].length === 2 ? 2000 + Number(french[3]) : Number(french[3]);
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date.toISOString().slice(0, 10) : null;
}

/**
 * « 40 », « 40 % », « 40% », « 0,4 » (cellule en pourcentage d'un tableur) → 40. Le contrôle des paliers autorisés
 * (10, 20, 40, 60, 80, 90, 100) reste celui du schéma des prospects : ce module ne fait que lire le nombre.
 */
export function parseProgressValue(raw: string): number | null {
  const cleaned = raw.replace(/[\s  %]/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 && value < 1 ? Math.round(value * 100) : value;
}

export const LEAD_STATUS_OPTIONS = [
  { code: "open", label: "Ouvert" },
  { code: "won", label: "Gagné" },
  { code: "lost", label: "Perdu" },
] as const;

const LEAD_STATUS_ALIASES: Record<string, "open" | "won" | "lost"> = {
  encours: "open",
  ouverte: "open",
  actif: "open",
  active: "open",
  gagnee: "won",
  signe: "won",
  signee: "won",
  perdue: "lost",
  abandonne: "lost",
  abandonnee: "lost",
};

export function resolveLeadStatus(raw: string): "open" | "won" | "lost" | null {
  const key = normalizeName(raw);
  if (key === "") return null;
  return (matchOption(raw, LEAD_STATUS_OPTIONS) as "open" | "won" | "lost" | null) ?? LEAD_STATUS_ALIASES[key] ?? null;
}
