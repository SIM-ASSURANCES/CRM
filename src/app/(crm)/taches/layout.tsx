import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function TachesLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="taches">{children}</FeatureGate>;
}
