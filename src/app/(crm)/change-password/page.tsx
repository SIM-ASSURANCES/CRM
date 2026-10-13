import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ChangePasswordForm } from "@/app/(crm)/change-password/change-password-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Changer mon mot de passe" };

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChangePasswordContent />
    </Suspense>
  );
}

async function ChangePasswordContent() {
  const user = await requireUser({ allowPasswordChange: true });

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-bold text-ink">Changer mon mot de passe</h1>

      {user.mustChangePassword ? (
        <p role="status" className="mt-4 rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-sm text-ink">
          Votre mot de passe a été réinitialisé par un administrateur. Vous devez en choisir un nouveau avant de
          continuer.
        </p>
      ) : (
        <p className="mt-1 text-muted">Vos autres sessions seront déconnectées après le changement.</p>
      )}

      <div className="mt-8 rounded-2xl border border-line bg-white p-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
