import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function ComptesLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="comptes">{children}</FeatureGate>;
}
