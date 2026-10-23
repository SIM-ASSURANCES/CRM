"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setFeatureEnabled } from "@/features/modules/service";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";

// Interrupteur global des fonctionnalités : réservé à `settings:manage`, revérifié ici ET dans le service
// (jamais seulement dans l'interface).

export async function setFeatureAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  if (!can(actor.role, "settings:manage")) redirect("/admin/fonctionnalites?erreur=1");

  const enabled = formData.get("enabled") === "true";
  let outcome: string;
  try {
    const result = await setFeatureEnabled(actor, { key: formData.get("key"), enabled });
    outcome = !result.changed ? "inchange" : enabled ? "active" : "desactive";
  } catch {
    redirect("/admin/fonctionnalites?erreur=1");
  }

  // Le menu de tous les écrans dépend de ce réglage : on invalide le cache du routeur.
  revalidatePath("/", "layout");
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(`/admin/fonctionnalites?ok=${outcome}`);
}
