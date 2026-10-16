import { z } from "zod";

// Normalisation des numéros de téléphone (migration, phase 7) : un seul format enregistré, « +225 » suivi des 10 chiffres
// du plan de numérotation ivoirien en vigueur depuis janvier 2021 (mobiles 01, 05, 07 ; fixes 21, 25, 27). Pur : utilisable
// aussi bien par les schémas de saisie que par l'analyse des fichiers d'import.

export type PhoneResult =
  | { ok: true; value: string }
  | {
      ok: false;
      /**
       * `empty` : rien de saisi. `legacy` : numéro ivoirien à 8 chiffres (avant 2021) dont le préfixe d'opérateur est inconnu,
       * donc non convertible sans deviner. `invalid` : tout autre numéro inexploitable.
       */
      reason: "empty" | "legacy" | "invalid";
      message: string;
    };

const COUNTRY_CODE = "225";
const NATIONAL_LENGTH = 10;

export const PHONE_MESSAGES = {
  empty: "Numéro de téléphone obligatoire.",
  legacy:
    "Numéro à 8 chiffres (format antérieur à 2021) : ajoutez le préfixe de l'opérateur (01, 05 ou 07 pour un mobile ; 21, 25 ou 27 pour un fixe).",
  invalid: "Numéro de téléphone invalide : 10 chiffres pour la Côte d'Ivoire (exemple : 01 02 03 04 05), ou un numéro international en +.",
} as const;

const fail = (reason: "empty" | "legacy" | "invalid"): PhoneResult => ({ ok: false, reason, message: PHONE_MESSAGES[reason] });

/**
 * Ramène une saisie libre à un format unique.
 * - « 01 02 03 04 05 », « 01.02.03.04.05 », « (+225) 01 02 03 04 05 », « 00225 0102030405 », « 225 0102030405 » → « +2250102030405 »
 * - un numéro international d'un autre pays (« +221 77 123 45 67 ») est conservé tel quel, en « + » et chiffres (8 à 15) ;
 * - un numéro ivoirien à 8 chiffres est signalé (`legacy`), jamais converti au hasard.
 */
export function normalizePhone(raw: string | null | undefined): PhoneResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return fail("empty");

  // Espaces (dont insécables), points, tirets, parenthèses et barres sont des séparateurs de présentation.
  let value = trimmed.replace(/[\s.\-()/]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;

  if (value.startsWith("+")) {
    const digits = value.slice(1);
    if (!/^\d+$/.test(digits)) return fail("invalid");
    if (digits.startsWith(COUNTRY_CODE)) return ivorian(digits.slice(COUNTRY_CODE.length));
    return digits.length >= 8 && digits.length <= 15 ? { ok: true, value: `+${digits}` } : fail("invalid");
  }

  if (!/^\d+$/.test(value)) return fail("invalid");
  // « 225 0102030405 » sans « + » : le code pays est reconnu quand le reste forme un numéro complet.
  if (value.startsWith(COUNTRY_CODE) && value.length === COUNTRY_CODE.length + NATIONAL_LENGTH) return ivorian(value.slice(COUNTRY_CODE.length));
  return ivorian(value);
}

/** Numéro national ivoirien (sans le code pays). */
function ivorian(national: string): PhoneResult {
  if (national.length === NATIONAL_LENGTH && national.startsWith("0")) return { ok: true, value: `+${COUNTRY_CODE}${national}` };
  if (national.length === 8) return fail("legacy");
  return fail("invalid");
}

/**
 * Schéma Zod d'un numéro de téléphone : la valeur validée est le numéro NORMALISÉ (« +2250102030405 »). Les schémas qui
 * l'acceptent vide l'enveloppent dans leur propre « optional » ; un numéro obligatoire l'utilise tel quel.
 */
export const phoneSchema = z.string({ error: PHONE_MESSAGES.empty }).transform((value, context) => {
  const result = normalizePhone(value);
  if (!result.ok) {
    context.addIssue({ code: "custom", message: result.message });
    return z.NEVER;
  }
  return result.value;
});

/** « +2250102030405 » → « +225 01 02 03 04 05 » pour l'affichage ; tout autre format est rendu tel quel. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  return match ? `+225 ${match.slice(1).join(" ")}` : value;
}
