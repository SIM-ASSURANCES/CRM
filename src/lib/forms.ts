import { z } from "zod";

// Utilitaires partagés par les formulaires (validation Zod, Server Actions).

export type FieldErrors = Record<string, string[]>;

/** Les formulaires envoient « » pour un champ vide : on le traite comme absent. */
export function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());
}

/** FormData → objet simple, sans les champs techniques ajoutés par React (« $ACTION_… »). */
export function formDataToObject(formData: FormData): Record<string, FormDataEntryValue> {
  const entries = Array.from(formData.entries()).filter(([key]) => !key.startsWith("$ACTION"));
  return Object.fromEntries(entries);
}

/** Valeurs textuelles saisies, renvoyées au formulaire pour qu'il ne se vide pas après une erreur. */
export function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}
