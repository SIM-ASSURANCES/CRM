"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runNow, updateRule, updateRuleSchema } from "@/features/automations/service";
import { failureState, type AdminFormState } from "@/lib/action-result";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { submittedValues } from "@/lib/forms";

// Server Actions d'administration des automatisations : réservées à `settings:manage`, revérifié ici ET dans le
// service (jamais seulement dans l'interface).

const DENIED: AdminFormState = { error: "Vous n'avez pas accès à cette action." };

async function authorize() {
  const actor = await requireUser();
  return can(actor.role, "settings:manage") ? actor : null;
}

export async function updateRuleAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  // Les paramètres arrivent sous la forme « p_<nom> » ; la validation fine (bornes entières) est celle de la règle.
  const params: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("p_") && typeof value === "string") params[key.slice(2)] = value;
  }
  const parsed = updateRuleSchema.safeParse({ code: formData.get("code"), enabled: formData.get("enabled") === "on", params });
  if (!parsed.success) return { error: "Règle invalide.", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };

  try {
    await updateRule(actor, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect("/admin/automatisations?ok=rule_updated");
}

export async function runNowAction(): Promise<void> {
  const actor = await authorize();
  if (!actor) redirect("/admin/automatisations?erreur=1");

  try {
    await runNow(actor);
  } catch {
    redirect("/admin/automatisations?erreur=1");
  }
  redirect("/admin/automatisations?ok=run");
}
