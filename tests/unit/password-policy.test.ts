import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getPasswordIssues,
  passwordSchema,
} from "@/lib/auth/password-policy";

// Exemple volontairement robuste (majuscule, minuscule, chiffres, symbole) pour rester valide
// si la politique est durcie ultérieurement.
const STRONG = "Exemple-Robuste-2026-x9";

describe("politique de mot de passe", () => {
  it("accepte un mot de passe robuste", () => {
    expect(getPasswordIssues(STRONG)).toEqual([]);
    expect(passwordSchema.safeParse(STRONG).success).toBe(true);
  });

  it("refuse un mot de passe trop court", () => {
    const short = "Ab1".padEnd(PASSWORD_MIN_LENGTH - 1, "x");
    expect(getPasswordIssues(short).length).toBeGreaterThan(0);
  });

  it("refuse un mot de passe trop long", () => {
    const long = `A1${"x".repeat(PASSWORD_MAX_LENGTH)}`;
    expect(getPasswordIssues(long).length).toBeGreaterThan(0);
  });

  it("exige des lettres ET des chiffres (parcours Excel : code alphanumérique)", () => {
    expect(getPasswordIssues("uniquementdeslettres").length).toBeGreaterThan(0);
    expect(getPasswordIssues("12345678901234").length).toBeGreaterThan(0);
  });

  it("remonte chaque règle non respectée dans le schéma Zod", () => {
    const result = passwordSchema.safeParse("abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
