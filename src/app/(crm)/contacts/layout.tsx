import type { ReactNode } from "react";
import { FeatureGate } from "@/components/feature-gate";

export default function ContactsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="contacts">{children}</FeatureGate>;
}
