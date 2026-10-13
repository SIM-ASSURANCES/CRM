"use server";

import { z } from "zod";
import { getRequestContext, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export type ForgotState = {
  submitted?: boolean;
  error?: string;
  fieldError?: string;
  email?: string;
};

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
});

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Réinitialisation par l'ADMINISTRATEUR (décision validée) : cette action ne change aucun mot de passe.
 * Elle enregistre une demande visible dans l'administration. La réponse est identique que le compte
 * existe ou non, pour ne pas révéler quelles adresses sont enregistrées.
 */
export async function requestPasswordResetAction(_previous: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      email: typeof formData.get("email") === "string" ? String(formData.get("email")) : "",
      fieldError: z.flattenError(parsed.error).fieldErrors.email?.[0],
    };
  }

  const { email } = parsed.data;
  const { ipAddress } = await getRequestContext();
  const limit = rateLimit(`reset:${ipAddress ?? "inconnue"}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!limit.ok) {
    return { email, error: "Trop de demandes. Réessayez dans quelques minutes." };
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const alreadyPending = await db.passwordResetRequest.findFirst({
      where: { email, status: "pending", createdAt: { gt: new Date(Date.now() - ONE_HOUR_MS) } },
      select: { id: true },
    });
    if (!alreadyPending) {
      await db.passwordResetRequest.create({ data: { email } });
      await writeAudit({ action: "auth.reset_requested", entityType: "user", entityId: user.id });
    }
  }

  return { submitted: true };
}
