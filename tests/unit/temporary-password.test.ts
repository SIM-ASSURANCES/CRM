import { describe, expect, it } from "vitest";
import { passwordSchema } from "@/lib/auth/password-policy";
import { generateTemporaryPassword, TEMPORARY_PASSWORD_LENGTH } from "@/lib/auth/temporary-password";

describe("generateTemporaryPassword", () => {
  it("produit un mot de passe de la longueur prévue", () => {
    expect(generateTemporaryPassword()).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
    expect(generateTemporaryPassword(20)).toHaveLength(20);
  });

  it("contient toujours une majuscule, une minuscule, un chiffre et un caractère spécial", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("respecte la politique de mot de passe de l'application", () => {
    for (let i = 0; i < 200; i++) {
      expect(passwordSchema.safeParse(generateTemporaryPassword()).success).toBe(true);
    }
  });

  it("exclut les caractères ambigus à la dictée (0, O, 1, l, I)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTemporaryPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it("ne produit pas deux fois la même valeur", () => {
    const generated = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(generated.size).toBe(500);
  });

  it("refuse une longueur trop faible", () => {
    expect(() => generateTemporaryPassword(8)).toThrow();
  });
});
