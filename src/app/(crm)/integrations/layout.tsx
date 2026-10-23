import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function MessagerieLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="messagerie">{children}</FeatureGate>;
}
