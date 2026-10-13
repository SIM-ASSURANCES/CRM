"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { teamSchema, updateTeamSchema, userIdSchema } from "@/features/users/schemas";
import { createTeam, deleteTeam, updateTeam } from "@/features/users/teams";
import { failureState, type AdminFormState } from "@/lib/action-result";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { formDataToObject, submittedValues } from "@/lib/forms";

const DENIED: AdminFormState = { error: "Vous n'avez pas accès à cette action." };

async function authorize() {
  const actor = await requireUser();
  return can(actor.role, "user:manage") ? actor : null;
}

export async function createTeamAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  const parsed = teamSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  try {
    await createTeam(actor, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  redirect("/admin/equipes?ok=created");
}

export async function updateTeamAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  const parsed = updateTeamSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  try {
    await updateTeam(actor, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  redirect("/admin/equipes?ok=updated");
}

export async function deleteTeamAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;

  const parsed = userIdSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Identifiant invalide." };

  try {
    await deleteTeam(actor, parsed.data.id);
  } catch (error) {
    return failureState(error);
  }
  redirect("/admin/equipes?ok=deleted");
}
