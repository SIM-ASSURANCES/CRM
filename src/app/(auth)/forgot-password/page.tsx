import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "@/app/(auth)/forgot-password/forgot-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { BrandLogo } from "@/components/brand/brand-logo";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <BrandLogo />
      <h1 className="mt-8 text-2xl font-bold text-ink">Mot de passe oublié</h1>
      <p className="mt-1 text-sm text-muted">
        La réinitialisation est effectuée par votre administrateur CRM. Saisissez votre adresse e-mail pour lui
        transmettre une demande, ou contactez-le directement.
      </p>
      <ForgotForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </AuthShell>
  );
}
