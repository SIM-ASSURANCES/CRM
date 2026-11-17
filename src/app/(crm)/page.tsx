import { CalendarCheck, FileText, Percent, UserPlus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { MemberSwitcher } from "@/components/dashboard/member-switcher";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ConversionPie } from "@/components/dashboard/conversion-pie";
import { KpiCard, describeComparison, describePoints } from "@/components/dashboard/kpi-card";
import { PipelineBars } from "@/components/dashboard/pipeline-bars";
import { PageHeader } from "@/components/ui/page-header";
import { getDashboardKpis } from "@/features/leads/kpi";
import { getMemberView, listTeamMembers, type TeamMember } from "@/features/leads/team-view";
import { requirePermission } from "@/lib/auth/session";
import { formatFcfa, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("dashboard:read");
  const requested = first((await searchParams).membre);

  // Un manager consulte le tableau de bord individuel de chacun de ses commerciaux (`?membre=`). Un identifiant mal formé,
  // d'un autre rôle ou hors de son équipe n'affiche rien : page introuvable.
  const members = await listTeamMembers(user);
  let scopeUser = user;
  let viewed: TeamMember | null = null;
  if (requested) {
    if (!z.uuid().safeParse(requested).success) notFound();
    const view = await getMemberView(user, requested);
    if (!view) notFound();
    scopeUser = view.scope;
    viewed = view.member;
  }

  const kpis = await getDashboardKpis(scopeUser);
  const { conversion, pipeline } = kpis;

  return (
    <div>
      <PageHeader
        title={viewed ? `Tableau de bord — ${viewed.name}` : "Tableau de bord"}
        description={
          viewed
            ? `Activité individuelle de ${viewed.name}, semaine ${kpis.weekLabel}, comparée à la semaine précédente.`
            : `Bienvenue, ${user.name}. Activité de la semaine ${kpis.weekLabel}, comparée à la semaine précédente.`
        }
      />
      {members.length > 0 && <MemberSwitcher members={members} selectedId={viewed?.id} />}

      <section aria-label="Indicateurs commerciaux" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Nouveaux prospects"
          value={formatNumber(kpis.newProspects.current)}
          delta={describeComparison(kpis.newProspects)}
          icon={UserPlus}
        />
        <KpiCard
          label="RDV obtenus"
          value={formatNumber(kpis.appointments.current)}
          note="Prospects ayant atteint « Découverte approfondie »"
          delta={describeComparison(kpis.appointments)}
          icon={CalendarCheck}
        />
        <KpiCard
          label="Propositions envoyées"
          value={formatNumber(kpis.proposals.current)}
          delta={describeComparison(kpis.proposals)}
          icon={FileText}
        />
        <KpiCard
          label="Taux de transformation"
          value={conversion.rate === null ? "—" : `${Math.round(conversion.rate)} %`}
          note={`${conversion.won} gagnée(s) · ${conversion.lost} perdue(s) cette semaine`}
          delta={describePoints(conversion.pointsDiff)}
          icon={Percent}
        />
        <KpiCard
          label="Valeur du pipeline commercial"
          value={formatFcfa(pipeline.current.gross)}
          note={`Montant pondéré : ${formatFcfa(pipeline.current.weighted)}`}
          delta={describeComparison(pipeline.comparison)}
          icon={Wallet}
          className="sm:col-span-2 xl:col-span-2"
        />
      </section>

      <section aria-label="Graphiques" className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-base font-semibold text-ink">Taux de transformation</h2>
          <ConversionPie won={conversion.won} lost={conversion.lost} />
        </article>
        <article className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-base font-semibold text-ink">Valeur du pipeline — 4 dernières semaines</h2>
          <PipelineBars data={kpis.pipelineHistory} />
        </article>
      </section>
    </div>
  );
}
