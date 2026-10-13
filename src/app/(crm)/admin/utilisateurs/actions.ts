"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createUserSchema,
  setActiveSchema,
  updateUserSchema,
  userIdSchema,
} from "@/features/users/schemas";
import { createUser, resetPassword, setUserActive, updateUser } from "@/features/users/service";
import { failureState, type AdminFormState } from "@/lib/action-result";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { formDataToObject, submittedValues } from "@/lib/forms";
import { rateLimit } from "@/lib/rate-limit";

// Server Actions d'administration des utilisateurs. Chacune relit l'identité côté serveur, vérifie le droit
// « user:manage », valide l'entrée (Zod) puis délègue au service, qui applique à son tour les règles et l'audit.

const DENIED: AdminFormState = { error: "Vous n'avez pas accès à cette action." };
const TOO_MANY: AdminFormState = { error: "Trop d'opérations sensibles en peu de temps. Réessayez dans quelques minutes." };

async function authorize() {
  const actor = await requireUser();
  return can(actor.role, "user:manage") ? actor : null;
}

/** Limite les créations de compte et réinitialisations (opérations qui produisent un secret). */
function credentialsRateLimited(actorId: string): boolean {
  return !rateLimit(`admin-credentials:${actorId}`, { limit: 20, windowMs: 15 * 60_000 }).ok;
}

export async function createUserAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  const parsed = createUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }
  if (credentialsRateLimited(actor.id)) return { ...TOO_MANY, values };

  try {
    return { credential: await createUser(actor, parsed.data) };
  } catch (error) {
    return failureState(error, values);
  }
}

export async function updateUserAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  const parsed = updateUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  try {
    await updateUser(actor, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(`/admin/utilisateurs/${parsed.data.id}?ok=updated`);
}

export async function resetPasswordAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;

  const parsed = userIdSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Identifiant invalide." };
  if (credentialsRateLimited(actor.id)) return TOO_MANY;

  try {
    return { credential: await resetPassword(actor, parsed.data.id) };
  } catch (error) {
    return failureState(error);
  }
}

export async function toggleActiveAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;

  const parsed = setActiveSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Demande invalide." };

  try {
    await setUserActive(actor, parsed.data.id, parsed.data.active);
  } catch (error) {
    return failureState(error);
  }
  redirect(`/admin/utilisateurs/${parsed.data.id}?ok=${parsed.data.active ? "reactivated" : "deactivated"}`);
}
