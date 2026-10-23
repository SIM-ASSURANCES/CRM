import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function ProspectsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="prospects">{children}</FeatureGate>;
}
