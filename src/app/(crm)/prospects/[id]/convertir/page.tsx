import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ConvertForm } from "@/app/(crm)/prospects/_components/convert-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAccountOptions } from "@/features/accounts/service";
import { stageLabel } from "@/features/leads/config";
import { getLead, type LeadDetail } from "@/features/leads/service";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";

export const metadata: Metadata = { title: "Convertir un prospect" };

export default function ConvertLeadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ConvertLeadContent params={params} />
    </Suspense>
  );
}

async function ConvertLeadContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermission("prospect:write");
  // La conversion crée un compte, un contact et une opportunité : toutes ces permissions sont nécessaires.
  if (!can(user.role, "account:write") || !can(user.role, "contact:write") || !can(user.role, "opportunity:write")) notFound();

  let lead: LeadDetail;
  try {
    lead = await getLead(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (lead.convertedOpportunityId) redirect(`/opportunites/${lead.convertedOpportunityId}`);
  if (lead.status !== "open") redirect(`/prospects/${id}`);

  const accounts = await listAccountOptions(user);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={`Convertir ${lead.companyName}`}
        description="Crée le compte, le contact et l'opportunité en une seule opération. Le prospect et son historique sont conservés."
      />

      <section aria-label="Récapitulatif du prospect" className="rounded-2xl border border-line bg-white p-6">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Contact</dt>
            <dd className="mt-1 text-ink">{lead.contactName} — {lead.jobTitle}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Étape reprise</dt>
            <dd className="mt-1 text-ink">{lead.progress} % — {stageLabel(lead.progress)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Produit</dt>
            <dd className="mt-1 text-ink">{lead.productLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Montant repris</dt>
            <dd className="mt-1 text-ink">{lead.expectedRevenue === null ? "—" : formatFcfa(lead.expectedRevenue)}</dd>
          </div>
        </dl>
      </section>

      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <ConvertForm leadId={lead.id} accounts={accounts} initial={{}} />
      </div>
    </div>
  );
}
