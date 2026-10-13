import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { LeadForm } from "@/app/(crm)/prospects/_components/lead-form";
import { PageHeader } from "@/components/ui/page-header";
import { getThresholds, listActiveProducts } from "@/features/leads/service";
import { requirePermission } from "@/lib/auth/session";
import { toDateInputValue } from "@/lib/format";

export const metadata: Metadata = { title: "Nouveau prospect" };

export default function NewLeadPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewLeadContent />
    </Suspense>
  );
}

async function NewLeadContent() {
  await requirePermission("prospect:write");
  const [products, thresholds] = await Promise.all([listActiveProducts(), getThresholds()]);
  const today = toDateInputValue(new Date());

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Enregistrer un nouveau prospect"
        description="Tous les champs sont obligatoires. Le prospect est rattaché à votre portefeuille."
      />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <LeadForm
          mode="create"
          products={products}
          thresholds={thresholds}
          today={today}
          initial={{ insertedOn: today, progress: "10" }}
        />
      </div>
    </div>
  );
}
