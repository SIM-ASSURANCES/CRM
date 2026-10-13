"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createLeadSchema,
  formDataToObject,
  markLostSchema,
  updateLeadSchema,
} from "@/features/leads/schemas";
import {
  createLead,
  markLost,
  updateLead,
  type DuplicateMatch,
  type FieldErrors,
  type LeadMutationResult,
} from "@/features/leads/service";
import { VIEW_META } from "@/features/leads/views";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Server Actions des prospects. Chacune relit l'identité côté serveur, valide l'entrée (Zod) puis délègue au
// service métier, qui contrôle la permission, le périmètre et les règles. L'interface ne fait confiance à rien.

export type LeadFormState = {
  error?: string;
  fieldErrors?: FieldErrors;
  duplicates?: DuplicateMatch[];
  /** Valeurs saisies, renvoyées pour que le formulaire ne se vide pas après une erreur. */
  values?: Record<string, string>;
};

function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}

function failure(error: unknown, values: Record<string, string>): LeadFormState {
  if (error instanceof AppError) {
    const details = error.details as { fieldErrors?: FieldErrors; duplicates?: DuplicateMatch[] } | undefined;
    return { error: error.message, fieldErrors: details?.fieldErrors, duplicates: details?.duplicates, values };
  }
  logger.error({ err: error }, "Erreur inattendue dans une action prospects");
  return { error: "Une erreur est survenue. Réessayez dans un instant.", values };
}

/** Après enregistrement : retour à l'écran où le prospect apparaît, avec un message de confirmation. */
function afterSaveUrl(kind: "created" | "updated" | "lost", result: LeadMutationResult): string {
  const first = result.destinations[0];
  const path = first ? VIEW_META[first].href : "/prospects";
  const to = result.destinations.length > 0 ? `&to=${result.destinations.join(",")}` : "";
  return `${path}?ok=${kind}${to}`;
}

export async function createLeadAction(_previous: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = createLeadSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  let result: LeadMutationResult;
  try {
    result = await createLead(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(afterSaveUrl("created", result));
}

export async function updateLeadAction(_previous: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = updateLeadSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  let result: LeadMutationResult;
  try {
    result = await updateLead(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(afterSaveUrl("updated", result));
}

export async function markLostAction(_previous: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = markLostSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  let result: LeadMutationResult;
  try {
    result = await markLost(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(afterSaveUrl("lost", result));
}
