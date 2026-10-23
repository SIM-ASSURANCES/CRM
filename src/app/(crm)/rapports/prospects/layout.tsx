import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function HistoriqueProspectsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="historique_prospects">{children}</FeatureGate>;
}
