"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { markAllRead, markRead, openNotification } from "@/features/notifications/service";
import { requireUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Server Actions du centre de notifications. Le destinataire est toujours l'utilisateur de la session : un
// identifiant de notification d'un autre utilisateur n'a aucun effet (le service filtre sur `userId`).

const idSchema = z.object({ id: z.uuid() });

/** Ouvre le dossier concerné et marque la notification comme lue. */
export async function openNotificationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) redirect("/notifications");

  const href = await openNotification(user, parsed.data.id);
  redirect(href ?? "/notifications");
}

export async function markReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (parsed.success) await markRead(user, parsed.data.id);
  redirect(safeRedirectPath(formData.get("returnTo"), "/notifications"));
}

export async function markAllReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await markAllRead(user);
  redirect(safeRedirectPath(formData.get("returnTo"), "/notifications"));
}
