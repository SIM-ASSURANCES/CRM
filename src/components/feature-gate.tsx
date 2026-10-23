import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import type { FeatureKey } from "@/features/modules/config";
import { isFeatureEnabled } from "@/features/modules/service";

// Garde d'une fonctionnalité activable par l'administrateur (voir features/modules). Placée dans le `layout.tsx` du segment :
// si la fonctionnalité est désactivée, TOUS les écrans du segment répondent « page introuvable », pour tous les rôles.
// La lecture de l'état est une donnée de requête : avec cacheComponents elle doit rester derrière un <Suspense>.

async function Gate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  if (!(await isFeatureEnabled(feature))) notFound();
  return children;
}

export function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gate feature={feature}>{children}</Gate>
    </Suspense>
  );
}
