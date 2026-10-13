import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsViewPage } from "@/app/(crm)/prospects/_components/leads-view-page";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export const metadata: Metadata = { title: "Prospects qualifiés" };

export default function QualifiedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeadsViewPage view="qualifies" searchParams={searchParams} />
    </Suspense>
  );
}
