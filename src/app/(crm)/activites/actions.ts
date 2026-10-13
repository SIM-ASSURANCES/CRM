"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createActivitySchema, updateActivitySchema } from "@/features/activities/schemas";
import { createActivity, updateActivity } from "@/features/activities/service";
import { failureState, type AdminFormState } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { formDataToObject, submittedValues } from "@/lib/forms";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Server Actions des activités : identité relue côté serveur, validation Zod, puis délégation au service
// (permission, périmètre, règles métier, audit). `returnTo` (chemin interne uniquement) ramène à l'écran d'origine.

export type ActivityFormState = AdminFormState;

function invalid(error: z.ZodError, values: Record<string, string>): ActivityFormState {
  return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(error).fieldErrors, values };
}

/** Ajoute le message de confirmation au chemin de retour, qu'il porte déjà une requête ou non. */
function withFlash(path: string, ok: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}ok=${ok}`;
}

export async function createActivityAction(_previous: ActivityFormState, formData: FormData): Promise<ActivityFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = createActivitySchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await createActivity(user, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(withFlash(safeRedirectPath(formData.get("returnTo"), `/comptes/${parsed.data.accountId}`), "activity_added"));
}

export async function updateActivityAction(_previous: ActivityFormState, formData: FormData): Promise<ActivityFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = updateActivitySchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await updateActivity(user, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  redirect(withFlash(safeRedirectPath(formData.get("returnTo"), "/activites"), "activity_updated"));
}
