import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { LeadForm } from "@/app/(crm)/prospects/_components/lead-form";
import { LostDialog } from "@/app/(crm)/prospects/_components/lost-dialog";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { lossReasonLabel, stageLabel } from "@/features/leads/config";
import { getLead, getThresholds, listActiveProducts, type LeadDetail } from "@/features/leads/service";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate, formatFcfa, toDateInputValue } from "@/lib/format";

export const metadata: Metadata = { title: "Fiche prospect" };

function ReadOnlySummary({ lead }: { lead: LeadDetail }) {
  const rows: [string, string][] = [
    ["Entreprise", lead.companyName],
    ["Secteur d'activité", lead.sector],
    ["Contact", `${lead.contactName} — ${lead.jobTitle}`],
    ["Téléphone", lead.phone],
    ["Adresse e-mail", lead.email],
    ["Date d'insertion", formatDate(lead.insertedOn)],
    ["Process de vente", `${lead.progress} % — ${stageLabel(lead.progress)}`],
    ["Produit proposé", lead.productLabel ?? "—"],
    ["Chiffre d'affaires", lead.expectedRevenue === null ? "—" : formatFcfa(lead.expectedRevenue)],
    ["Responsable", lead.ownerName],
  ];
  if (lead.status === "lost") {
    rows.push(["Motif de perte", lossReasonLabel(lead.lossReason)]);
    if (lead.lossComment) rows.push(["Commentaire", lead.lossComment]);
  }

  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
          <dd className="mt-1 text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeadContent params={params} />
    </Suspense>
  );
}

async function LeadContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Un identifiant mal formé n'atteint jamais la base : 404 directement.
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermission("prospect:read");

  let lead: LeadDetail;
  try {
    lead = await getLead(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const converted = Boolean(lead.convertedAt);
  const editable = lead.status === "open" && can(user.role, "prospect:write");
  const convertible =
    editable &&
    !converted &&
    can(user.role, "account:write") &&
    can(user.role, "contact:write") &&
    can(user.role, "opportunity:write");
  const opportunityLink = lead.convertedOpportunityId && can(user.role, "opportunity:read") && (
    <Link href={`/opportunites/${lead.convertedOpportunityId}`} className={buttonClasses("secondary")}>
      Voir l&apos;opportunité
    </Link>
  );

  if (!editable) {
    return (
      <div className="max-w-4xl">
        <PageHeader
          title={lead.companyName}
          description={
            converted
              ? "Prospect converti en compte, contact et opportunité."
              : lead.status === "won"
                ? "Affaire gagnée : le prospect est clôturé."
                : lead.status === "lost"
                  ? "Prospect perdu : clôturé."
                  : "Consultation en lecture seule."
          }
          actions={opportunityLink || undefined}
        />
        <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
          <ReadOnlySummary lead={lead} />
        </div>
      </div>
    );
  }

  const [products, thresholds] = await Promise.all([listActiveProducts(), getThresholds()]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={lead.companyName}
        description="Modifiez les informations ou faites avancer le process de vente."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {opportunityLink}
            {convertible && (
              <Link href={`/prospects/${lead.id}/convertir`} className={buttonClasses("primary")}>
                Convertir
              </Link>
            )}
            <LostDialog leadId={lead.id} version={lead.version} companyName={lead.companyName} />
          </div>
        }
      />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <LeadForm
          mode="update"
          leadId={lead.id}
          version={lead.version}
          products={products}
          thresholds={thresholds}
          today={toDateInputValue(new Date())}
          initial={{
            companyName: lead.companyName,
            sector: lead.sector,
            contactLastName: lead.contactLastName,
            contactFirstName: lead.contactFirstName,
            jobTitle: lead.jobTitle,
            phone: lead.phone,
            email: lead.email,
            insertedOn: toDateInputValue(lead.insertedOn),
            progress: String(lead.progress),
            productId: lead.productId ?? "",
            expectedRevenue: lead.expectedRevenue === null ? "" : String(lead.expectedRevenue),
          }}
        />
      </div>
    </div>
  );
}
