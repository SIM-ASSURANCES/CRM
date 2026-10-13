import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { OpportunityActions } from "@/app/(crm)/opportunites/_components/opportunity-actions";
import { OpportunityContacts } from "@/app/(crm)/opportunites/_components/opportunity-contacts";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { labelOf } from "@/features/accounts/config";
import { lossReasonLabel } from "@/features/leads/config";
import { getThresholds } from "@/features/leads/service";
import { OPEN_STAGES, REVENUE_PERIODS, STAGE_LABELS } from "@/features/opportunities/config";
import { getOpportunity, listContactCandidates, type OpportunityDetail } from "@/features/opportunities/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, formatFcfa } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Fiche opportunité" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FLASH: Record<string, string> = {
  created: "Opportunité créée.",
  updated: "Modifications enregistrées.",
  moved: "Étape mise à jour.",
  won: "Félicitations : opportunité gagnée.",
  lost: "Opportunité clôturée comme perdue.",
  converted: "Prospect converti : le compte, le contact et cette opportunité ont été créés.",
  contact_added: "Contact associé à l'opportunité.",
  contact_removed: "Contact retiré de l'opportunité.",
};

const EVENT_LABELS: Record<string, string> = {
  created: "Création",
  stage_changed: "Changement d'étape",
  updated: "Modification",
  won: "Gagnée",
  lost: "Perdue",
};

export default function OpportunityPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpportunityContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-ink">{value || "—"}</dd>
    </div>
  );
}

async function OpportunityContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("opportunity:read");
  const query = await searchParams;
  const flashKey = query.ok;
  const flash = typeof flashKey === "string" ? FLASH[flashKey] : undefined;

  let opportunity: OpportunityDetail;
  try {
    opportunity = await getOpportunity(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const open = opportunity.status === "open";
  const canWrite = can(user.role, "opportunity:write") && open;
  const [thresholds, candidates] = await Promise.all([
    getThresholds(),
    canWrite ? listContactCandidates(user, id) : [],
  ]);

  const statusLabel = open ? `${opportunity.stage} % — ${STAGE_LABELS[opportunity.stage as keyof typeof STAGE_LABELS]}` : opportunity.status === "won" ? "Gagnée" : "Perdue";
  const stageIndex = (OPEN_STAGES as readonly number[]).indexOf(opportunity.stage);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={opportunity.name}
        description={statusLabel}
        actions={
          canWrite ? (
            <Link href={`/opportunites/${id}/modifier`} className={buttonClasses("secondary")}>
              Modifier
            </Link>
          ) : undefined
        }
      />

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}
      {query.erreur && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          L&apos;opération n&apos;a pas pu être effectuée.
        </p>
      )}

      {!open && (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-4 py-3 text-sm text-ink",
            opportunity.status === "won" ? "border-emerald-300 bg-emerald-50" : "border-danger/30 bg-red-50",
          )}
        >
          {opportunity.status === "won" ? (
            <>Opportunité <strong>gagnée</strong> le {opportunity.closedAt ? formatDate(opportunity.closedAt) : "—"} : revenu signé de {formatFcfa(opportunity.amount)}.</>
          ) : (
            <>
              Opportunité <strong>perdue</strong> le {opportunity.closedAt ? formatDate(opportunity.closedAt) : "—"} — motif :{" "}
              {lossReasonLabel(opportunity.lossReason)}
              {opportunity.lossComment ? ` (${opportunity.lossComment})` : ""}.
            </>
          )}
        </p>
      )}

      {open && (
        <section aria-label="Progression" className="rounded-2xl border border-line bg-white p-5">
          <ol className="flex gap-1.5 overflow-x-auto">
            {OPEN_STAGES.map((stage, index) => (
              <li
                key={stage}
                aria-current={index === stageIndex ? "step" : undefined}
                className={cn(
                  "min-w-24 flex-1 rounded-lg px-2 py-2 text-center text-xs font-semibold",
                  index < stageIndex && "bg-brand-100 text-brand-800",
                  index === stageIndex && "bg-brand-700 text-white",
                  index > stageIndex && "bg-surface text-muted",
                )}
              >
                {STAGE_LABELS[stage]}
                <span className="block font-normal">{stage} %</span>
              </li>
            ))}
          </ol>
          {canWrite && (
            <div className="mt-5">
              <OpportunityActions
                opportunity={{
                  id: opportunity.id,
                  version: opportunity.version,
                  name: opportunity.name,
                  stage: opportunity.stage,
                  amount: opportunity.amount,
                  productLabel: opportunity.productLabel,
                }}
                qualifiedAbove={thresholds.qualifiedAbove}
                returnTo={`/opportunites/${id}`}
              />
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="infos" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="infos" className="mb-5 text-lg font-semibold text-ink">Informations</h2>
        <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Row
            label="Compte"
            value={
              <Link href={`/comptes/${opportunity.accountId}`} className="font-medium text-brand-700 hover:underline">
                {opportunity.accountName}
              </Link>
            }
          />
          <Row label="Produit" value={opportunity.productLabel} />
          <Row label="Responsable" value={opportunity.ownerName} />
          <Row label="Montant brut" value={`${formatFcfa(opportunity.amount)} (${labelOf(REVENUE_PERIODS, opportunity.revenuePeriod).toLowerCase()})`} />
          <Row label="Montant pondéré" value={formatFcfa(opportunity.weighted)} />
          <Row label="Méthode d'estimation" value={opportunity.estimationMethod} />
          <Row label="Clôture prévisionnelle" value={opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : null} />
          <Row
            label="Prochaine action"
            value={
              opportunity.nextAction && (
                <span className={cn(opportunity.overdue && "font-semibold text-danger")}>
                  {opportunity.nextAction}
                  {opportunity.nextActionDate && ` — ${formatDate(opportunity.nextActionDate)}`}
                  {opportunity.overdue && " (en retard)"}
                </span>
              )
            }
          />
          <Row label="Concurrent" value={opportunity.competitor} />
          <Row label="Solution actuelle" value={opportunity.currentSolution} />
          <Row label="Créée le" value={formatDateTime(opportunity.createdAt)} />
        </dl>
      </section>

      <section aria-labelledby="contacts" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="contacts" className="mb-5 text-lg font-semibold text-ink">Contacts impliqués</h2>
        <OpportunityContacts opportunityId={id} contacts={opportunity.contacts} candidates={candidates} editable={canWrite} />
      </section>

      <section aria-labelledby="historique" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="historique" className="mb-5 text-lg font-semibold text-ink">Historique</h2>
        <ol className="space-y-3 text-sm">
          {opportunity.events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3 last:border-0">
              <span className="text-ink">
                <strong>{EVENT_LABELS[event.type] ?? event.type}</strong>
                {event.type === "stage_changed" && event.fromStage !== null && ` : ${event.fromStage} % → ${event.toStage} %`}
                {event.type !== "stage_changed" && ` (${event.toStage} %)`}
                <span className="text-ink-soft"> — {formatFcfa(event.amount)}</span>
              </span>
              <span className="text-xs text-muted">
                {formatDateTime(event.occurredAt)}
                {event.actorName && ` · ${event.actorName}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
