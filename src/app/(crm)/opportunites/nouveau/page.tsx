import type { Metadata } from "next";
import { Suspense } from "react";
import { OpportunityForm } from "@/app/(crm)/opportunites/_components/opportunity-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAccountOptions, listAssignableOwners } from "@/features/accounts/service";
import { listActiveProducts } from "@/features/leads/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouvelle opportunité" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function NewOpportunityPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewOpportunityContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewOpportunityContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("opportunity:write");
  const accountParam = (await searchParams).compte;

  const [accounts, products, owners] = await Promise.all([
    listAccountOptions(user),
    listActiveProducts(),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  // « Nouvelle opportunité » depuis une fiche compte pré-sélectionne le compte (ignoré s'il est hors périmètre).
  const accountId = typeof accountParam === "string" && accounts.some((a) => a.id === accountParam) ? accountParam : "";

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Nouvelle opportunité"
        description="Une opportunité concerne un compte existant. Pour partir d'un prospect, utilisez « Convertir » sur sa fiche."
      />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <OpportunityForm
          mode="create"
          accounts={accounts}
          products={products}
          owners={owners}
          initial={{ accountId, stage: "10", revenuePeriod: "annual", ownerUserId: owners ? user.id : "" }}
        />
      </div>
    </div>
  );
}
