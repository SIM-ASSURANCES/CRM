import { PageSkeleton } from "@/components/ui/page-skeleton";

// Fallback Suspense des pages du groupe (crm), pour les pages qui n'ont pas leur propre frontière.
export default function CrmLoading() {
  return <PageSkeleton />;
}
