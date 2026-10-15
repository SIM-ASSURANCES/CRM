import type { Metadata } from "next";
import { Suspense } from "react";
import { ExportLinks, KpiDictionary, ReportFilters, TH, Tile } from "@/app/(crm)/rapports/_components/report-ui";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { SelectField } from "@/components/ui/select";
import { listActiveProducts } from "@/features/leads/service";
import { LOSS_DIMENSIONS } from "@/features/reporting/config";
import { defaultRange, parseLossParams } from "@/features/reporting/schemas";
import { getLosses, listReportOwners } from "@/features/reporting/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatFcfa, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Motifs de perte" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function LossesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LossesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LossesContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("report:read");
  const params = await searchParams;
  const parsed = parseLossParams(params);
  const [products, owners] = await Promise.all([listActiveProducts(), listReportOwners(user)]);

  const fallback = defaultRange();
  const filters = parsed.success ? parsed.data : null;
  const view = filters ? await getLosses(user, filters) : null;

  const query = new URLSearchParams();
  if (filters) {
    query.set("du", filters.from);
    query.set("au", filters.to);
    query.set("axe", filters.dimension);
    if (filters.productId) query.set("produit", filters.productId);
    if (filters.ownerId) query.set("commercial", filters.ownerId);
  }
  const dimensionLabel = LOSS_DIMENSIONS.find((d) => d.code === filters?.dimension)?.label ?? "Axe";

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Motifs de perte"
        description="Pourquoi les affaires sont perdues, croisé avec le produit, le secteur, le commercial, la taille du compte ou l'équipe. Montants annualisés."
        actions={filters && can(user.role, "report:export") ? <ExportLinks report="losses" query={query} /> : undefined}
      />

      <ReportFilters action="/rapports/pertes" from={filters?.from ?? fallback.from} to={filters?.to ?? fallback.to}>
        <SelectField label="Croiser avec" name="axe" defaultValue={filters?.dimension ?? "product"} options={LOSS_DIMENSIONS.map((d) => ({ value: d.code, label: d.label }))} />
        <SelectField label="Produit / risque" name="produit" defaultValue={filters?.productId ?? ""} placeholder="Tous les produits" options={products.map((p) => ({ value: p.id, label: p.label }))} />
        {user.role !== "commercial" && (
          <SelectField label="Commercial" name="commercial" defaultValue={filters?.ownerId ?? ""} placeholder="Tous les commerciaux" options={owners.map((o) => ({ value: o.id, label: o.name }))} />
        )}
      </ReportFilters>

      {!view || !filters ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          Les filtres demandés sont invalides ({parsed.success ? "" : parsed.error.issues[0]?.message}). Corrigez-les ou réinitialisez le rapport.
        </p>
      ) : view.matrix.total.total.count === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">Aucune opportunité perdue sur cette période.</div>
      ) : (
        <>
          <section aria-label="Synthèse des pertes" className="grid gap-4 sm:grid-cols-2">
            <Tile label="Opportunités perdues" value={formatNumber(view.matrix.total.total.count)} />
            <Tile label="Montant perdu (annualisé)" value={formatFcfa(view.matrix.total.total.amount)} />
          </section>

          <section aria-labelledby="repartition" className="rounded-2xl border border-line bg-white p-5">
            <h2 id="repartition" className="mb-4 text-lg font-semibold text-ink">
              Répartition par motif
            </h2>
            <ul className="space-y-3">
              {view.matrix.reasons
                .map((reason) => ({ reason, cell: view.matrix.total.byReason[reason.code] }))
                .filter(({ cell }) => cell.count > 0)
                .sort((a, b) => b.cell.amount - a.cell.amount)
                .map(({ reason, cell }) => {
                  const share = view.matrix.total.total.amount > 0 ? (cell.amount / view.matrix.total.total.amount) * 100 : 0;
                  return (
                    <li key={reason.code} className="text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-ink">{reason.label}</span>
                        <span className="text-ink-soft">
                          {formatNumber(cell.count)} · {formatFcfa(cell.amount)} · {Math.round(share)} %
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface" role="presentation">
                        <div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.max(share, 1)}%` }} />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>

          <section aria-labelledby="matrice" className="space-y-3">
            <h2 id="matrice" className="text-lg font-semibold text-ink">
              Motifs × {dimensionLabel.toLowerCase()}
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <caption className="sr-only">Nombre et montant des opportunités perdues, par motif et par {dimensionLabel.toLowerCase()}</caption>
                <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className={TH}>{dimensionLabel}</th>
                    {view.matrix.reasons.map((reason) => (
                      <th key={reason.code} scope="col" className={`${TH} text-right`}>{reason.label}</th>
                    ))}
                    <th scope="col" className={`${TH} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {view.matrix.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="px-4 py-3 font-medium text-ink">{row.label}</th>
                      {view.matrix.reasons.map((reason) => {
                        const cell = row.byReason[reason.code];
                        return (
                          <td key={reason.code} className="px-4 py-3 text-right text-ink-soft">
                            {cell.count === 0 ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <>
                                {formatNumber(cell.count)}
                                <span className="block text-xs text-muted">{formatFcfa(cell.amount)}</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right font-semibold text-ink">
                        {formatNumber(row.total.count)}
                        <span className="block text-xs font-normal text-muted">{formatFcfa(row.total.amount)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line bg-surface font-semibold">
                  <tr>
                    <th scope="row" className="px-4 py-3 text-ink">Total</th>
                    {view.matrix.reasons.map((reason) => {
                      const cell = view.matrix.total.byReason[reason.code];
                      return (
                        <td key={reason.code} className="px-4 py-3 text-right text-ink">
                          {formatNumber(cell.count)}
                          <span className="block text-xs font-normal text-muted">{formatFcfa(cell.amount)}</span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right text-ink">
                      {formatNumber(view.matrix.total.total.count)}
                      <span className="block text-xs font-normal text-muted">{formatFcfa(view.matrix.total.total.amount)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}

      <KpiDictionary only={["annualized", "lost"]} />
    </div>
  );
}
