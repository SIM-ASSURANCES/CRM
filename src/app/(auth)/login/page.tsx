import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { BrandLogo } from "@/components/brand/brand-logo";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <AuthShell>
      <BrandLogo />
      <h1 className="mt-8 text-2xl font-bold text-ink">Connexion</h1>
      <p className="mt-1 text-sm text-muted">CRM Commercial</p>
      {/* useSearchParams (paramètre « next ») exige une frontière Suspense avec cacheComponents. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
