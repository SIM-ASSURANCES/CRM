"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { dismissResetRequest } from "@/features/users/service";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

/** Ignore une demande de réinitialisation (compte inconnu, demande abusive…). Tracé dans l'audit. */
export async function dismissRequestAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  if (!can(actor.role, "user:manage")) redirect("/");

  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/admin/demandes?erreur=invalide");

  try {
    await dismissResetRequest(actor, id.data);
  } catch (error) {
    if (error instanceof AppError) redirect("/admin/demandes?erreur=introuvable");
    throw error;
  }
  redirect("/admin/demandes?ok=dismissed");
}
