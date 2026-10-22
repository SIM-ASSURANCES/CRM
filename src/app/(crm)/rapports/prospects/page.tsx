import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareChart, StageChart } from "@/app/(crm)/rapports/_components/prospect-history-charts";
import { TH, Tile } from "@/app/(crm)/rapports/_components/report-ui";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { SelectField } from "@/components/ui/select";
import { getProspectHistory } from "@/features/leads/history";
import { DAY_CHOICES, HISTORY_STAGES, parseHistoryParams, WEEK_CHOICES, type StageCounts } from "@/features/leads/history-math";
import { STAGE_LABELS } from "@/features/leads/config";
import type { Comparison } from "@/features/leads/kpi-math";
import { listReportOwners } from "@/features/reporting/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDate, formatNumber, formatSignedPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Historique des prospects" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ProspectHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProspectHistoryContent searchParams={searchParams} />
    </Suspense>
  );
}

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const shortDay = (iso: string) => asDate(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dayMonth = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

/** « +3 », « −1 » ou « = » : l'écart en nombre de prospects, vert s'il y en a plus, rouge s'il y en a moins. */
function Gap({ diff }: { diff: number }) {
  if (diff === 0) return <span className="text-muted">=</span>;
  return <span className={diff > 0 ? "font-medium text-emerald-700" : "font-medium text-danger"}>{`${diff > 0 ? "+" : "−"}${Math.abs(diff)}`}</span>;
}

/** Variation en % ; « non calculable » quand la période de comparaison est vide (CDC 8.1), jamais un pourcentage trompeur. */
function Rate({ comparison }: { comparison: Comparison }) {
  if (comparison.pct === null) return <span className="text-muted">non calculable</span>;
  return <span className={comparison.pct > 0 ? "text-emerald-700" : comparison.pct < 0 ? "text-danger" : "text-muted"}>{formatSignedPercent(comparison.pct)}</span>;
}

type DeltaTone = "neutral" | "good-up" | "bad-up";

/**
 * Effectif avec, en petit, l'écart par rapport à la période précédente de la liste. Les étapes ouvertes sont NEUTRES (plus
 * de prospects à 10 % n'est ni bon ni mauvais) ; seuls les gagnés (bon s'ils augmentent) et les perdus (mauvais) portent un jugement.
 */
function CountCell({ value, previous, tone = "neutral" }: { value: number; previous: number | null; tone?: DeltaTone }) {
  const diff = previous === null ? 0 : value - previous;
  const color =
    tone === "neutral" ? "text-muted" : (tone === "good-up") === diff > 0 ? "text-emerald-700" : "text-danger";
  return (
    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
      {formatNumber(value)}
      {previous !== null && diff !== 0 && <span className={`ml-1 text-xs ${color}`}>{`${diff > 0 ? "+" : "−"}${Math.abs(diff)}`}</span>}
    </td>
  );
}

function StageHeads() {
  return (
    <>
      {HISTORY_STAGES.map((stage) => (
        <th key={stage} scope="col" title={STAGE_LABELS[stage]} className={`${TH} px-3 text-right`}>
          {stage} %
        </th>
      ))}
      <th scope="col" className={`${TH} px-3 text-right`}>Ouverts</th>
      <th scope="col" className={`${TH} px-3 text-right`}>Gagnés</th>
      <th scope="col" className={`${TH} px-3 text-right`}>Perdus</th>
    </>
  );
}

function StageCells({ counts, previous }: { counts: StageCounts; previous: StageCounts | null }) {
  return (
    <>
      {HISTORY_STAGES.map((stage) => (
        <CountCell key={stage} value={counts.stages[stage]} previous={previous ? previous.stages[stage] : null} />
      ))}
      <CountCell value={counts.open} previous={previous ? previous.open : null} />
      <CountCell value={counts.won} previous={previous ? previous.won : null} tone="good-up" />
      <CountCell value={counts.lost} previous={previous ? previous.lost : null} tone="bad-up" />
    </>
  );
}

const STAGE_NAMES = HISTORY_STAGES.map((stage) => ({ stage, name: STAGE_LABELS[stage] }));

async function ProspectHistoryContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("report:read");
  const params = parseHistoryParams(await searchParams);
  const [history, owners] = await Promise.all([
    getProspectHistory(user, params),
    user.role === "commercial" ? Promise.resolve([]) : listReportOwners(user),
  ]);

  const { weeks, days, summary } = history;
  const currentWeek = weeks[weeks.length - 1];
  const todayPoint = days[days.length - 1];
  // Tableaux : du plus récent au plus ancien ; graphiques : du plus ancien au plus récent (lecture de gauche à droite).
  const weeksDesc = [...weeks].reverse();
  const daysDesc = [...days].reverse();

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Historique des prospects"
        description="Nombre de nouveaux prospects par jour et par semaine, comparé aux semaines passées, et nombre de prospects à chaque étape du process de vente."
      />

      <form method="get" action="/rapports/prospects" className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Semaines affichées" name="semaines" defaultValue={String(params.weeks)} options={WEEK_CHOICES.map((n) => ({ value: n, label: `${n} semaines` }))} />
        <SelectField label="Jours affichés" name="jours" defaultValue={String(params.days)} options={DAY_CHOICES.map((n) => ({ value: n, label: `${n} jours` }))} />
        {user.role !== "commercial" && (
          <SelectField label="Commercial" name="commercial" defaultValue={params.ownerId ?? ""} placeholder="Tous les commerciaux" options={owners.map((o) => ({ value: o.id, label: o.name }))} />
        )}
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonClasses("primary")}>Appliquer</button>
          <a href="/rapports/prospects" className={buttonClasses("secondary")}>Réinitialiser</a>
        </div>
      </form>

      <section aria-label="Indicateurs de la semaine" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={`Nouveaux prospects, ${currentWeek.label} (en cours)`}
          value={formatNumber(currentWeek.newProspects)}
          note={
            summary.thisWeek.pct === null
              ? `${currentWeek.comparison.previous} la semaine précédente (variation non calculable)`
              : `${formatSignedPercent(summary.thisWeek.pct)} vs semaine précédente (${currentWeek.comparison.previous})`
          }
          tone={summary.thisWeek.diff > 0 ? "good" : summary.thisWeek.diff < 0 ? "bad" : "default"}
        />
        <Tile
          label="Moyenne des semaines précédentes"
          value={summary.averagePrevious === null ? "—" : summary.averagePrevious.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
          note={
            summary.vsAverage === null
              ? "Aucune semaine complète à comparer"
              : summary.vsAverage.pct === null
                ? "Variation non calculable"
                : `Cette semaine : ${formatSignedPercent(summary.vsAverage.pct)} vs la moyenne`
          }
        />
        <Tile
          label="Nouveaux prospects aujourd'hui"
          value={formatNumber(summary.today)}
          note={`Même jour la semaine passée : ${formatNumber(todayPoint.sameDayLastWeek)}`}
        />
        <Tile
          label="Prospects ouverts"
          value={formatNumber(summary.current.open)}
          note={`${formatNumber(summary.current.won)} gagné(s) · ${formatNumber(summary.current.lost)} perdu(s)`}
        />
      </section>

      <section aria-labelledby="h-semaines" className="space-y-3">
        <h2 id="h-semaines" className="text-lg font-semibold text-ink">Nouveaux prospects par semaine</h2>
        <div className="rounded-2xl border border-line bg-white p-5">
          <CompareChart
            title="Nouveaux prospects par semaine"
            previousLabel="Semaine précédente"
            data={weeks.map((week) => ({ label: week.label, current: week.newProspects, previous: week.comparison.previous }))}
          />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Nouveaux prospects par semaine, comparés à la semaine précédente</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className={TH}>Semaine</th>
                <th scope="col" className={`${TH} text-right`}>Nouveaux</th>
                <th scope="col" className={`${TH} text-right`}>Semaine précédente</th>
                <th scope="col" className={`${TH} text-right`}>Écart</th>
                <th scope="col" className={`${TH} text-right`}>Variation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {weeksDesc.map((week) => (
                <tr key={week.start} className={week.current ? "bg-brand-50/40" : undefined}>
                  <th scope="row" className="px-4 py-3 font-medium text-ink">
                    {week.label}
                    {week.current && <span className="ml-2 text-xs font-normal text-muted">(en cours)</span>}
                    <span className="block text-xs font-normal text-muted">{formatDate(asDate(week.start))} – {formatDate(asDate(week.end))}</span>
                  </th>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{formatNumber(week.newProspects)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-soft">{formatNumber(week.comparison.previous)}</td>
                  <td className="px-4 py-3 text-right tabular-nums"><Gap diff={week.comparison.diff} /></td>
                  <td className="px-4 py-3 text-right"><Rate comparison={week.comparison} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-etapes-semaines" className="space-y-3">
        <h2 id="h-etapes-semaines" className="text-lg font-semibold text-ink">Prospects par étape, à la fin de chaque semaine</h2>
        <div className="rounded-2xl border border-line bg-white p-5">
          <StageChart
            title="Prospects ouverts par étape, à la fin de chaque semaine"
            stages={STAGE_NAMES}
            data={weeks.map((week) => ({ label: week.label, ...Object.fromEntries(HISTORY_STAGES.map((stage) => [`s${stage}`, week.stages.stages[stage]])) }))}
          />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Nombre de prospects à chaque étape à la fin de chaque semaine, avec l&apos;écart par rapport à la semaine précédente</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className={TH}>Semaine</th>
                <StageHeads />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {weeksDesc.map((week, index) => (
                <tr key={week.start} className={week.current ? "bg-brand-50/40" : undefined}>
                  <th scope="row" className="px-4 py-3 font-medium text-ink">
                    {week.label}
                    {week.current && <span className="ml-2 text-xs font-normal text-muted">(en cours)</span>}
                  </th>
                  <StageCells counts={week.stages} previous={weeksDesc[index + 1]?.stages ?? null} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Chaque ligne montre la situation à la fin de la semaine (maintenant pour la semaine en cours) ; le petit chiffre est l&apos;écart avec la
          semaine précédente (vert pour les gagnés en hausse, rouge pour les perdus en hausse, gris pour les étapes ouvertes). Un prospect gagné ou
          perdu quitte les étapes ouvertes et passe dans « Gagnés » ou « Perdus ».
        </p>
      </section>

      <section aria-labelledby="h-jours" className="space-y-3">
        <h2 id="h-jours" className="text-lg font-semibold text-ink">Par jour</h2>
        <div className="rounded-2xl border border-line bg-white p-5">
          <CompareChart
            title="Nouveaux prospects par jour"
            previousLabel="Même jour la semaine passée"
            data={days.map((day) => ({ label: dayMonth(day.date), current: day.newProspects, previous: day.sameDayLastWeek }))}
          />
        </div>
        <div className="max-h-[32rem] overflow-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Nouveaux prospects par jour comparés au même jour de la semaine précédente, et nombre de prospects à chaque étape à la fin du jour</caption>
            <thead className="sticky top-0 border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className={TH}>Jour</th>
                <th scope="col" className={`${TH} px-3 text-right`}>Nouveaux</th>
                <th scope="col" className={`${TH} px-3 text-right`}>Même jour S−1</th>
                <th scope="col" className={`${TH} px-3 text-right`}>Écart</th>
                <StageHeads />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {daysDesc.map((day, index) => (
                <tr key={day.date}>
                  <th scope="row" className="px-4 py-3 font-medium capitalize text-ink">{shortDay(day.date)}</th>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{formatNumber(day.newProspects)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatNumber(day.sameDayLastWeek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums"><Gap diff={day.comparison.diff} /></td>
                  <StageCells counts={day.stages} previous={daysDesc[index + 1]?.stages ?? null} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="rounded-2xl border border-line bg-white p-5 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">Définitions</summary>
        <dl className="mt-3 space-y-3">
          <div>
            <dt className="font-medium text-ink">Nouveau prospect</dt>
            <dd className="text-ink-soft">Prospect dont la date d&apos;insertion tombe dans le jour ou la semaine (du lundi au dimanche).</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Prospects par étape</dt>
            <dd className="text-ink-soft">
              Situation reconstituée à partir de l&apos;historique daté de chaque prospect : l&apos;étape qu&apos;il avait à la fin du jour ou de la
              semaine. Elle existe donc aussi pour le passé, y compris pour les prospects importés.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Variation</dt>
            <dd className="text-ink-soft">(période − période de comparaison) / période de comparaison ; « non calculable » quand celle-ci vaut zéro.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Périmètre</dt>
            <dd className="text-ink-soft">Commercial : ses prospects ; manager : son équipe ; direction, administrateur et audit : tous.</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
