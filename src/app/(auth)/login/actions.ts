"use server";

import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getRequestContext, writeAudit } from "@/lib/audit";
import { auth } from "@/lib/auth/auth";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-redirect";

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  /** Renvoyé pour préremplir le champ : React vide les champs non contrôlés après une action. */
  email?: string;
};

// Message volontairement identique que l'e-mail existe ou non (pas d'énumération de comptes).
const GENERIC_ERROR = "Identifiants incorrects.";

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
  password: z.string().min(1, "Le mot de passe est obligatoire.").max(PASSWORD_MAX_LENGTH, "Mot de passe invalide."),
});

function hashForAudit(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      email: rawEmail,
      fieldErrors: { email: fieldErrors.email?.[0], password: fieldErrors.password?.[0] },
    };
  }

  const { email, password } = parsed.data;
  const rememberMe = formData.get("rememberMe") === "on";
  const destination = safeRedirectPath(formData.get("next"));

  // Limitation de débit : par adresse IP et par couple IP + compte (anti force brute).
  const { ipAddress } = await getRequestContext();
  const ipKey = ipAddress ?? "inconnue";
  const byIp = rateLimit(`login:ip:${ipKey}`, { limit: 20, windowMs: 60_000 });
  const byAttempt = rateLimit(`login:${ipKey}:${email}`, { limit: 5, windowMs: 60_000 });
  if (!byIp.ok || !byAttempt.ok) {
    return { email, error: "Trop de tentatives. Réessayez dans une minute." };
  }

  try {
    await auth.api.signInEmail({ body: { email, password, rememberMe }, headers: await headers() });
  } catch (error) {
    if (!(error instanceof APIError)) {
      logger.error({ err: error }, "Erreur inattendue pendant la connexion");
      return { email, error: "Le service est momentanément indisponible. Réessayez dans un instant." };
    }

    const banned = error.body?.code === "BANNED_USER";
    // L'e-mail n'est pas écrit en clair dans l'audit : une empreinte suffit à repérer une attaque ciblée.
    await writeAudit({
      action: banned ? "auth.login_blocked" : "auth.login_failed",
      entityType: "user",
      metadata: { emailHash: hashForAudit(email) },
    });
    return {
      email,
      error: banned ? "Ce compte est désactivé. Contactez votre administrateur CRM." : GENERIC_ERROR,
    };
  }

  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(destination);
}
