import { randomInt } from "node:crypto";

// Mot de passe temporaire remis par l'administrateur (réinitialisation ou création de compte).
// Généré avec un aléa cryptographique ; les caractères ambigus (0/O, 1/l/I) sont exclus pour faciliter la dictée.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "!#$%&*+-=?@";

export const TEMPORARY_PASSWORD_LENGTH = 16;

export function generateTemporaryPassword(length: number = TEMPORARY_PASSWORD_LENGTH): string {
  if (length < 12) throw new Error("Un mot de passe temporaire doit contenir au moins 12 caractères.");

  const pick = (set: string) => set[randomInt(set.length)];
  // Au moins un caractère de chaque famille : reste conforme si la politique de mot de passe est durcie.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGITS + SPECIAL;
  while (chars.length < length) chars.push(pick(all));

  // Mélange de Fisher-Yates avec un aléa cryptographique (les 4 premiers caractères ne restent pas en tête).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
