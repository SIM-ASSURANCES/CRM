import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ComponentProps } from "react";
import { ForecastChart } from "@/app/(crm)/rapports/_components/forecast-chart";
import { ExportLinks, GapCells, KpiDictionary, rateLabel, ReportFilters, TH, Tile as ReportTile } from "@/app/(crm)/rapports/_components/report-ui";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { SelectField } from "@/components/ui/select";
import { listActiveProducts } from "@/features/leads/service";
import { GRANULARITIES, SEGMENTS } from "@/features/reporting/config";
import { periodLabel, type Totals } from "@/features/reporting/rules";
import { defaultRange, parseForecastParams } from "@/features/reporting/schemas";
import { getForecast, listReportOwners } from "@/features/reporting/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatFcfa, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Prévisions" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ForecastPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ForecastContent searchParams={searchParams} />
    </Suspense>
  );
}

/** Cartes d'indicateurs de la page : chiffres à 14 px. */
function Tile(props: Omit<ComponentProps<typeof ReportTile>, "compact">) {
  return <ReportTile compact {...props} />;
}

function TotalsCells({ totals }: { totals: Totals }) {
  return (
    <>
      <td className="px-4 py-3 text-right text-ink-soft">{formatNumber(totals.openCount)}</td>
      <td className="px-4 py-3 text-right text-ink-soft">{formatFcfa(totals.gross)}</td>
      <td className="px-4 py-3 text-right text-ink-soft">{formatFcfa(totals.weighted)}</td>
      <td className="px-4 py-3 text-right text-ink-soft">{formatNumber(totals.wonCount)}</td>
      <td className="px-4 py-3 text-right text-ink-soft">{formatFcfa(totals.signed)}</td>
      <td className="px-4 py-3 text-right font-semibold text-ink">{formatFcfa(totals.forecast)}</td>
    </>
  );
}

const TABLE_HEAD = (
  <>
    <th scope="col" className={`${TH} text-right`}>Ouvertes</th>
    <th scope="col" className={`${TH} text-right`}>Pipeline brut</th>
    <th scope="col" className={`${TH} text-right`}>Pipeline pondéré</th>
    <th scope="col" className={`${TH} text-right`}>Gagnées</th>
    <th scope="col" className={`${TH} text-right`}>Revenu signé</th>
    <th scope="col" className={`${TH} text-right`}>Forecast</th>
    <th scope="col" className={`${TH} text-right`}>Objectif</th>
    <th scope="col" className={`${TH} text-right`}>Écart</th>
    <th scope="col" className={`${TH} text-right`}>Taux</th>
  </>
);

async function ForecastContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("report:read");
  const params = await searchParams;
  const parsed = parseForecastParams(params);
  const [products, owners] = await Promise.all([listActiveProducts(), listReportOwners(user)]);

  const fallback = defaultRange();
  const filters = parsed.success ? parsed.data : null;
  const view = filters ? await getForecast(user, filters) : null;

  const query = new URLSearchParams();
  if (filters) {
    query.set("du", filters.from);
    query.set("au", filters.to);
    query.set("periode", filters.granularity);
    query.set("segment", filters.segment);
    if (filters.productId) query.set("produit", filters.productId);
    if (filters.ownerId) query.set("commercial", filters.ownerId);
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Prévisions de chiffre d'affaires"
        description="Pipeline brut, pipeline pondéré, opportunités gagnées et revenu signé, par mois, trimestre ou année, comparés aux objectifs. Montants annualisés."
        actions={filters && can(user.role, "report:export") ? <ExportLinks report="forecast" query={query} /> : undefined}
      />

      <ReportFilters action="/rapports/previsions" from={filters?.from ?? fallback.from} to={filters?.to ?? fallback.to}>
        <SelectField label="Regrouper par" name="periode" defaultValue={filters?.granularity ?? "month"} options={GRANULARITIES.map((g) => ({ value: g.code, label: g.label }))} />
        <SelectField label="Segmenter par" name="segment" defaultValue={filters?.segment ?? "none"} options={SEGMENTS.map((s) => ({ value: s.code, label: s.label }))} />
        <SelectField label="Produit / risque" name="produit" defaultValue={filters?.productId ?? ""} placeholder="Tous les produits" options={products.map((p) => ({ value: p.id, label: p.label }))} />
        {user.role !== "commercial" && (
          <SelectField label="Commercial" name="commercial" defaultValue={filters?.ownerId ?? ""} placeholder="Tous les commerciaux" options={owners.map((o) => ({ value: o.id, label: o.name }))} />
        )}
      </ReportFilters>

      {!view || !filters ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          Les filtres demandés sont invalides ({parsed.success ? "" : parsed.error.issues[0]?.message}). Corrigez-les ou réinitialisez le rapport.
        </p>
      ) : (
        <>
          <section aria-label="Indicateurs de la période" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Pipeline brut" value={formatFcfa(view.report.total.gross)} note={`${formatNumber(view.report.total.openCount)} opportunité(s) ouverte(s)`} />
            <Tile label="Pipeline pondéré" value={formatFcfa(view.report.total.weighted)} note="Montant × probabilité de l'étape" />
            <Tile label="Revenu signé" value={formatFcfa(view.report.total.signed)} note={`${formatNumber(view.report.total.wonCount)} opportunité(s) gagnée(s)`} />
            <Tile label="Forecast" value={formatFcfa(view.report.total.forecast)} note="Signé + pondéré" />
            {view.targets ? (
              <Tile
                label="Objectif"
                value={formatFcfa(view.targets.total.target)}
                note={`Atteinte : ${rateLabel(view.targets.total.rate)}`}
                tone={view.targets.total.rate === null ? "default" : view.targets.total.gap >= 0 ? "good" : "bad"}
              />
            ) : (
              <Tile
                label="Objectif"
                value="Non comparé"
                note={filters.productId ? "Les objectifs sont fixés par commercial, tous produits." : "Aucun objectif configuré sur cette période."}
              />
            )}
          </section>

          {view.report.periods.length > 0 && (
            <section aria-labelledby="graphique" className="rounded-2xl border border-line bg-white p-5">
              <h2 id="graphique" className="mb-3 text-lg font-semibold text-ink">
                Forecast par période
              </h2>
              <ForecastChart
                hasTarget={view.targets !== null}
                data={view.report.periods.map((period) => ({
                  label: periodLabel(period),
                  signed: view.report.periodTotals[period].signed,
                  weighted: view.report.periodTotals[period].weighted,
                  target: view.targets?.byPeriod[period]?.target ?? null,
                }))}
              />
            </section>
          )}

          <section aria-labelledby="par-periode" className="space-y-3">
            <h2 id="par-periode" className="text-lg font-semibold text-ink">
              Détail par période
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[60rem] text-left text-sm">
                <caption className="sr-only">Pipeline, revenu signé, forecast et objectif par période, tous segments confondus</caption>
                <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className={TH}>Période</th>
                    {TABLE_HEAD}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {view.report.periods.map((period) => (
                    <tr key={period}>
                      <th scope="row" className="px-4 py-3 font-medium text-ink">{periodLabel(period)}</th>
                      <TotalsCells totals={view.report.periodTotals[period]} />
                      <GapCells attainment={view.targets?.byPeriod[period]} />
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line bg-surface font-semibold">
                  <tr>
                    <th scope="row" className="px-4 py-3 text-ink">Total</th>
                    <TotalsCells totals={view.report.total} />
                    <GapCells attainment={view.targets?.total} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {filters.segment !== "none" && (
            <section aria-labelledby="par-segment" className="space-y-3">
              <h2 id="par-segment" className="text-lg font-semibold text-ink">
                Par {SEGMENTS.find((s) => s.code === filters.segment)?.label.toLowerCase()}
              </h2>
              <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="w-full min-w-[60rem] text-left text-sm">
                  <caption className="sr-only">Pipeline, revenu signé, forecast et objectif par segment, sur toute la période</caption>
                  <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className={TH}>Segment</th>
                      {TABLE_HEAD}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {view.report.segments.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-muted">Aucune opportunité sur cette période.</td>
                      </tr>
                    ) : (
                      view.report.segments.map((segment) => (
                        <tr key={segment.key}>
                          <th scope="row" className="px-4 py-3 font-medium text-ink">{segment.label}</th>
                          <TotalsCells totals={segment.total} />
                          <GapCells attainment={view.targets?.bySegment?.[segment.key]?.total} />
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">Le détail de chaque segment, période par période, figure dans l&apos;export.</p>
            </section>
          )}

          <KpiDictionary only={["annualized", "gross", "weighted", "won", "signed", "forecast", "target", "attainment"]} />
          {can(user.role, "target:manage") && (
            <p className="text-sm text-muted">
              Les objectifs se saisissent dans{" "}
              <Link href="/admin/objectifs" className="font-medium text-brand-700 underline">
                Objectifs commerciaux
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
