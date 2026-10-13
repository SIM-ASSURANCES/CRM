"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createTaskSchema, setTaskStatusSchema, updateTaskSchema } from "@/features/tasks/schemas";
import { createTask, setTaskStatus, updateTask } from "@/features/tasks/service";
import { failureState, type AdminFormState } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formDataToObject, submittedValues } from "@/lib/forms";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Server Actions des tâches : identité relue côté serveur, validation Zod, puis délégation au service
// (permission, périmètre, règles métier, audit). `returnTo` (chemin interne uniquement) ramène à l'écran d'origine.

export type TaskFormState = AdminFormState;

function invalid(error: z.ZodError, values: Record<string, string>): TaskFormState {
  return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(error).fieldErrors, values };
}

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${value}`;
}

export async function createTaskAction(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = createTaskSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await createTask(user, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(withParam(safeRedirectPath(formData.get("returnTo"), "/taches"), "ok", "task_created"));
}

export async function updateTaskAction(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = updateTaskSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await updateTask(user, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  redirect(withParam(safeRedirectPath(formData.get("returnTo"), "/taches"), "ok", "task_updated"));
}

/** Terminer, annuler ou rouvrir : un simple bouton de formulaire, sans état à afficher. */
export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const returnTo = safeRedirectPath(formData.get("returnTo"), "/taches");

  const parsed = setTaskStatusSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) redirect(withParam(returnTo, "erreur", "1"));

  let flash: string;
  try {
    const result = await setTaskStatus(user, parsed.data);
    flash = `task_${result.status}`;
  } catch (error) {
    if (error instanceof AppError) redirect(withParam(returnTo, "erreur", "1"));
    throw error;
  }
  redirect(withParam(returnTo, "ok", flash));
}
