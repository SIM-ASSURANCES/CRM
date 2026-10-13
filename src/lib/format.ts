// Formats d'affichage (fr, Côte d'Ivoire). Les dates sont traitées en UTC : la Côte d'Ivoire est à UTC+0 toute l'année.

const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** 34534725 → « 34 534 725 FCFA » (espaces insécables : pas de retour à la ligne au milieu d'un montant). */
export function formatFcfa(value: number): string {
  return `${integer.format(Math.round(value))} FCFA`.replace(/[  ]/g, " ");
}

export function formatNumber(value: number): string {
  return integer.format(value).replace(/[  ]/g, " ");
}

/** Date → « 13/10/2026 ». */
export function formatDate(value: Date): string {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${value.getUTCFullYear()}`;
}

/** Date et heure UTC → « 13/10/2026 à 14:05 ». */
export function formatDateTime(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(value)} à ${hours}:${minutes}`;
}

/** Date → « 2026-10-13 » (valeur d'un champ <input type="date">). */
export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** 15 → « +15 % », -5 → « −5 % », 0 → « 0 % ». */
export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0 %";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} %`;
}
