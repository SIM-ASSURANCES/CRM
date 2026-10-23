import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function PrevisionsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="previsions">{children}</FeatureGate>;
}
