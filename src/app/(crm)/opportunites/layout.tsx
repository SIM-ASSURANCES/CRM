import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function OpportunitesLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="opportunites">{children}</FeatureGate>;
}
