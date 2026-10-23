import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function ActivitesLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="activites">{children}</FeatureGate>;
}
