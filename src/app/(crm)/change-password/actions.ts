"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { auth } from "@/lib/auth/auth";
import { passwordSchema } from "@/lib/auth/password-policy";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export type ChangePasswordState = {
  error?: string;
  fieldErrors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string[]>>;
};

const schema = z
  .object({
    currentPassword: z.string().min(1, "Le mot de passe actuel est obligatoire."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
  });

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  // Identité relue côté serveur : on ne fait jamais confiance au client.
  const user = await requireUser({ allowPasswordChange: true });

  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const limit = rateLimit(`change-password:${user.id}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!limit.ok) {
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const { currentPassword, newPassword } = parsed.data;

  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      return { fieldErrors: { currentPassword: ["Le mot de passe actuel est incorrect."] } };
    }
    logger.error({ err: error }, "Erreur inattendue pendant le changement de mot de passe");
    return { error: "Le service est momentanément indisponible. Réessayez dans un instant." };
  }

  await db.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
  await writeAudit({
    actorUserId: user.id,
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    metadata: { forced: user.mustChangePassword },
  });

  redirect("/");
}
