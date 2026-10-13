import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { OpportunityForm } from "@/app/(crm)/opportunites/_components/opportunity-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAccountOptions, listAssignableOwners } from "@/features/accounts/service";
import { listActiveProducts } from "@/features/leads/service";
import { getOpportunity, type OpportunityDetail } from "@/features/opportunities/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { toDateInputValue } from "@/lib/format";

export const metadata: Metadata = { title: "Modifier une opportunité" };

export default function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditOpportunityContent params={params} />
    </Suspense>
  );
}

async function EditOpportunityContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("opportunity:write");

  let opportunity: OpportunityDetail;
  try {
    opportunity = await getOpportunity(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // Une opportunité clôturée (gagnée ou perdue) est en lecture seule.
  if (opportunity.status !== "open") redirect(`/opportunites/${id}`);

  const [accounts, products, owners] = await Promise.all([
    listAccountOptions(user),
    listActiveProducts(),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Modifier ${opportunity.name}`} />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <OpportunityForm
          mode="update"
          opportunityId={opportunity.id}
          version={opportunity.version}
          accounts={accounts}
          products={products}
          owners={owners}
          initial={{
            accountId: opportunity.accountId,
            name: opportunity.name,
            productId: opportunity.productId ?? "",
            amount: String(opportunity.amount),
            revenuePeriod: opportunity.revenuePeriod,
            estimationMethod: opportunity.estimationMethod ?? "",
            expectedCloseDate: opportunity.expectedCloseDate ? toDateInputValue(opportunity.expectedCloseDate) : "",
            nextAction: opportunity.nextAction ?? "",
            nextActionDate: opportunity.nextActionDate ? toDateInputValue(opportunity.nextActionDate) : "",
            competitor: opportunity.competitor ?? "",
            currentSolution: opportunity.currentSolution ?? "",
            ownerUserId: opportunity.ownerUserId,
          }}
        />
      </div>
    </div>
  );
}
