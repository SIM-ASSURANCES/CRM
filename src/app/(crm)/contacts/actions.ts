"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  addRoleSchema,
  createContactSchema,
  linkContactSchema,
  removeRoleSchema,
  unlinkContactSchema,
  updateContactSchema,
} from "@/features/contacts/schemas";
import {
  addRole,
  createContact,
  linkContact,
  removeRole,
  unlinkContact,
  updateContact,
  type ContactDuplicate,
} from "@/features/contacts/service";
import type { AdminFormState } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formDataToObject, submittedValues, type FieldErrors } from "@/lib/forms";
import { logger } from "@/lib/logger";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Server Actions des contacts. Chacune relit l'identité côté serveur, valide l'entrée (Zod) puis délègue au service,
// qui contrôle la permission, le périmètre et les règles. `returnTo` (chemin interne uniquement) ramène l'utilisateur
// à l'écran d'où il vient.

export type ContactFormState = AdminFormState & { duplicates?: ContactDuplicate[] };

function failure(error: unknown, values?: Record<string, string>): ContactFormState {
  if (error instanceof AppError) {
    const details = error.details as { fieldErrors?: FieldErrors; duplicates?: ContactDuplicate[] } | undefined;
    return { error: error.message, fieldErrors: details?.fieldErrors, duplicates: details?.duplicates, values };
  }
  logger.error({ err: error }, "Erreur inattendue dans une action contacts");
  return { error: "Une erreur est survenue. Réessayez dans un instant.", values };
}

function invalid(error: z.ZodError, values: Record<string, string>): ContactFormState {
  return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(error).fieldErrors, values };
}

export async function createContactAction(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = createContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  let id: string;
  try {
    ({ id } = await createContact(user, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(parsed.data.accountId ? `/comptes/${parsed.data.accountId}?ok=contact_added` : `/contacts/${id}?ok=created`);
}

export async function updateContactAction(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = updateContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await updateContact(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/contacts/${parsed.data.id}?ok=updated`);
}

export async function linkContactAction(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = linkContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await linkContact(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(`${safeRedirectPath(formData.get("returnTo"), `/contacts/${parsed.data.contactId}`)}?ok=linked`);
}

export async function unlinkContactAction(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireUser();

  const parsed = unlinkContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Demande invalide." };

  try {
    await unlinkContact(user, parsed.data);
  } catch (error) {
    return failure(error);
  }
  redirect(`${safeRedirectPath(formData.get("returnTo"), `/contacts/${parsed.data.contactId}`)}?ok=unlinked`);
}

export async function addRoleAction(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = addRoleSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await addRole(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/contacts/${parsed.data.contactId}?ok=role_added`);
}

/** Suppression d'un rôle depuis un simple bouton de formulaire (pas d'état à afficher). */
export async function removeRoleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const returnTo = safeRedirectPath(formData.get("returnTo"), "/contacts");

  const parsed = removeRoleSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) redirect(`${returnTo}?erreur=invalide`);

  try {
    await removeRole(user, parsed.data.roleId);
  } catch (error) {
    if (error instanceof AppError) redirect(`${returnTo}?erreur=introuvable`);
    throw error;
  }
  redirect(`${returnTo}?ok=role_removed`);
}
