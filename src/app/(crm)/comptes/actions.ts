"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAccountSchema, mergeAccountsSchema, updateAccountSchema } from "@/features/accounts/schemas";
import {
  createAccount,
  mergeAccounts,
  updateAccount,
  type AccountDuplicate,
} from "@/features/accounts/service";
import type { AdminFormState } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formDataToObject, submittedValues, type FieldErrors } from "@/lib/forms";
import { logger } from "@/lib/logger";

// Server Actions des comptes : identité relue côté serveur, validation Zod, puis délégation au service
// (permission, périmètre, règles métier, audit).

export type AccountFormState = AdminFormState & { duplicates?: AccountDuplicate[] };

function failure(error: unknown, values?: Record<string, string>): AccountFormState {
  if (error instanceof AppError) {
    const details = error.details as { fieldErrors?: FieldErrors; duplicates?: AccountDuplicate[] } | undefined;
    return { error: error.message, fieldErrors: details?.fieldErrors, duplicates: details?.duplicates, values };
  }
  logger.error({ err: error }, "Erreur inattendue dans une action comptes");
  return { error: "Une erreur est survenue. Réessayez dans un instant.", values };
}

function invalid(error: z.ZodError, values: Record<string, string>): AccountFormState {
  return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(error).fieldErrors, values };
}

export async function createAccountAction(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = createAccountSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  let id: string;
  try {
    ({ id } = await createAccount(user, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(`/comptes/${id}?ok=created`);
}

export async function updateAccountAction(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = updateAccountSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await updateAccount(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/comptes/${parsed.data.id}?ok=updated`);
}

export async function mergeAccountsAction(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();

  const parsed = mergeAccountsSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, submittedValues(formData));

  try {
    await mergeAccounts(user, parsed.data);
  } catch (error) {
    return failure(error);
  }
  redirect(`/comptes/${parsed.data.targetId}?ok=merged`);
}
