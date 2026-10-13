import { describe, expect, it } from "vitest";
import {
  createUserSchema,
  setActiveSchema,
  teamSchema,
  updateUserSchema,
} from "@/features/users/schemas";
import { formDataToObject, optional, submittedValues } from "@/lib/forms";
import { z } from "zod";

const UUID = "4f5b1c0e-6c2e-4b3f-9c61-0f9a3b7e2d11";

describe("createUserSchema", () => {
  it("normalise l'e-mail et accepte une équipe vide", () => {
    const result = createUserSchema.safeParse({ name: "  Awa Traoré ", email: " Awa.Traore@SIM.CI ", role: "manager", teamId: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ name: "Awa Traoré", email: "awa.traore@sim.ci", role: "manager", teamId: undefined });
  });

  it("refuse un rôle inconnu, un nom trop court et un e-mail invalide", () => {
    const messages = (input: unknown) => {
      const result = createUserSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((i) => i.message);
    };
    const valid = { name: "Awa Traoré", email: "awa@sim.ci", role: "commercial" };

    expect(messages({ ...valid, role: "superadmin" })).toContain("Rôle invalide.");
    expect(messages({ ...valid, name: "A" })).toContain("Le nom est obligatoire (2 caractères minimum).");
    expect(messages({ ...valid, email: "pas-un-mail" })).toContain("Adresse e-mail invalide.");
    expect(messages({ ...valid, teamId: "pas-un-uuid" })).toContain("Équipe invalide.");
  });

  it("accepte les cinq rôles du cahier des charges", () => {
    for (const role of ["admin", "direction", "manager", "commercial", "audit"]) {
      expect(createUserSchema.safeParse({ name: "Test Rôle", email: "t@sim.ci", role }).success).toBe(true);
    }
  });
});

describe("updateUserSchema", () => {
  it("n'accepte pas de modification d'e-mail (non listé dans le schéma)", () => {
    const result = updateUserSchema.safeParse({ id: UUID, name: "Awa Traoré", role: "audit", email: "autre@sim.ci" });
    expect(result.success).toBe(true);
    expect(result.success && "email" in result.data).toBe(false);
  });
});

describe("setActiveSchema", () => {
  it("lit la valeur textuelle d'un champ caché", () => {
    expect(setActiveSchema.parse({ id: UUID, active: "true" }).active).toBe(true);
    expect(setActiveSchema.parse({ id: UUID, active: "false" }).active).toBe(false);
    expect(setActiveSchema.parse({ id: UUID, active: "n'importe quoi" }).active).toBe(false);
  });
});

describe("teamSchema", () => {
  it("accepte une équipe sans responsable", () => {
    expect(teamSchema.parse({ name: "Équipe Abidjan Nord", managerUserId: "" })).toEqual({
      name: "Équipe Abidjan Nord",
      managerUserId: undefined,
    });
  });

  it("refuse un nom trop court et un responsable invalide", () => {
    expect(teamSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(teamSchema.safeParse({ name: "Équipe Sud", managerUserId: "x" }).success).toBe(false);
  });
});

describe("lib/forms", () => {
  it("optional traite « » comme absent", () => {
    const schema = z.object({ value: optional(z.string().min(3)) });
    expect(schema.parse({ value: "" })).toEqual({ value: undefined });
    expect(schema.safeParse({ value: "ab" }).success).toBe(false);
  });

  it("formDataToObject et submittedValues ignorent les champs techniques de React", () => {
    const formData = new FormData();
    formData.set("$ACTION_ID_x", "1");
    formData.set("name", "Awa");
    expect(formDataToObject(formData)).toEqual({ name: "Awa" });
    expect(submittedValues(formData)).toEqual({ name: "Awa" });
  });
});
