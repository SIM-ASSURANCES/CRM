import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function MotifsPerteLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="motifs_perte">{children}</FeatureGate>;
}
