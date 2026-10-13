import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { countPendingResetRequests } from "@/features/users/service";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";

// La lecture de la session est une donnée de requête : avec cacheComponents elle doit rester derrière
// un <Suspense>, jamais au premier niveau du layout (guide Next.js « Authentication with Cache Components »).
export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: ReactNode }) {
  // Le layout accepte un utilisateur dont le mot de passe doit être changé (pour afficher le gabarit) ;
  // chaque page appelle requireUser() sans cette option et redirige alors vers /change-password.
  const user = await requireUser({ allowPasswordChange: true });
  // Les administrateurs voient sur la cloche les demandes de réinitialisation de mot de passe en attente.
  const pendingResetRequests = can(user.role, "user:manage") ? await countPendingResetRequests() : 0;
  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role }} pendingResetRequests={pendingResetRequests}>
      {children}
    </AppShell>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh bg-surface" aria-hidden="true">
      <div className="w-64 border-r border-line bg-white max-md:w-[72px]">
        <div className="h-16 bg-brand-700" />
      </div>
      <div className="flex-1">
        <div className="h-16 border-b border-line bg-white" />
      </div>
    </div>
  );
}
