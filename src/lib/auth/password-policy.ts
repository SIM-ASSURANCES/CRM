import { z } from "zod";

// Politique de mot de passe (parcours Excel : « code alphanumérique » ; CDC 2.1 et A.9).
// Appliquée côté serveur : création d'utilisateur, changement de mot de passe, mot de passe temporaire.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Retourne la liste des règles non respectées (vide = mot de passe accepté). */
export function getPasswordIssues(password: string): string[] {
  const issues: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`Au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push(`Au plus ${PASSWORD_MAX_LENGTH} caractères.`);
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    issues.push("Des lettres et des chiffres.");
  }

  // TODO(human): ajouter les règles de composition supplémentaires de votre politique
  // (majuscule + minuscule, caractère spécial, refus des mots de passe courants, etc.)
  // en poussant un message dans `issues` pour chaque règle non respectée.

  return issues;
}

export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const message of getPasswordIssues(value)) {
    ctx.addIssue({ code: "custom", message });
  }
});
