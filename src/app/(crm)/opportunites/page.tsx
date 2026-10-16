import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { KanbanBoard } from "@/app/(crm)/opportunites/_components/kanban-board";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { listAssignableOwners } from "@/features/accounts/service";
import { getThresholds, listActiveProducts } from "@/features/leads/service";
import { stageLabel } from "@/features/leads/config";
import { listBoard, listOpportunities } from "@/features/opportunities/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDate, formatFcfa } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Opportunités" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  moved: "Étape mise à jour.",
  won: "Félicitations : opportunité gagnée.",
  lost: "Opportunité clôturée comme perdue.",
};

export default function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpportunitiesContent searchParams={searchParams} />
    </Suspense>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

async function OpportunitiesContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("opportunity:read");
  const params = await searchParams;

  const q = first(params.q)?.trim() || undefined;
  const ownerId = first(params.proprietaire) || undefined;
  const productId = first(params.produit) || undefined;
  const listView = first(params.vue) === "liste";
  const page = Math.max(Number(first(params.page)) || 1, 1);
  const canWrite = can(user.role, "opportunity:write");

  const [thresholds, products, owners] = await Promise.all([
    getThresholds(),
    listActiveProducts(),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  // Le chemin de retour conserve les filtres actifs ; « t » (horodatage) est ajouté par les actions.
  const keep = new URLSearchParams();
  if (q) keep.set("q", q);
  if (ownerId) keep.set("proprietaire", ownerId);
  if (productId) keep.set("produit", productId);
  if (listView) keep.set("vue", "liste");
  const returnTo = keep.size > 0 ? `/opportunites?${keep.toString()}` : "/opportunites";

  const flashKey = first(params.ok);
  const flash = flashKey ? FLASH[flashKey] : undefined;

  const tabClass = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm font-medium",
      active ? "bg-brand-700 text-white" : "border border-line bg-white text-ink hover:bg-surface",
    );
  const tabHref = (vue?: string) => {
    const next = new URLSearchParams(keep);
    next.delete("vue");
    if (vue) next.set("vue", vue);
    return next.size > 0 ? `/opportunites?${next.toString()}` : "/opportunites";
  };

  const board = listView ? null : await listBoard(user, { ownerId, productId, q });
  const list = listView ? await listOpportunities(user, { status: "open", q, page }) : null;

  return (
    <div>
      <PageHeader
        title="Opportunités"
        description="Pipeline commercial : montant brut, montant pondéré par la probabilité de l'étape et revenu signé."
        actions={
          canWrite ? (
            <Link href="/opportunites/nouveau" className={buttonClasses("primary")}>
              Nouvelle opportunité
            </Link>
          ) : undefined
        }
      />

      {flash && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}

      {board && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Pipeline brut" value={formatFcfa(board.open.gross)} hint={`${board.open.count} opportunité(s) ouverte(s)`} />
          <Kpi label="Pipeline pondéré" value={formatFcfa(board.open.weighted)} hint="Montant × probabilité de l'étape" />
          <Kpi label="Revenu signé (année)" value={formatFcfa(board.signedThisYear.amount)} hint={`${board.signedThisYear.count} gagnée(s)`} />
          <Kpi label="Perdues (année)" value={String(board.lostThisYear)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          {listView && <input type="hidden" name="vue" value="liste" />}
          <div>
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">Rechercher</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Opportunité ou compte…"
                className="h-10 w-64 max-w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
              />
            </div>
          </div>
          {!listView && (
            <>
              <div>
                <label htmlFor="produit" className="mb-1.5 block text-sm font-medium text-ink">Produit</label>
                <select id="produit" name="produit" defaultValue={productId ?? ""} className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink">
                  <option value="">Tous</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              {owners && (
                <div>
                  <label htmlFor="proprietaire" className="mb-1.5 block text-sm font-medium text-ink">Propriétaire</label>
                  <select id="proprietaire" name="proprietaire" defaultValue={ownerId ?? ""} className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink">
                    <option value="">Tous</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
        </form>

        <nav aria-label="Mode d'affichage" className="flex gap-2">
          <Link href={tabHref()} className={tabClass(!listView)} aria-current={!listView ? "page" : undefined}>Kanban</Link>
          <Link href={tabHref("liste")} className={tabClass(listView)} aria-current={listView ? "page" : undefined}>Liste</Link>
        </nav>
      </div>

      {board && (
        <>
          {board.truncated && (
            <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-ink">
              Seules les 500 premières opportunités sont affichées : affinez les filtres.
            </p>
          )}
          {/* L'horodatage « t » recrée le tableau après chaque action : les boîtes de dialogue se referment. */}
          <KanbanBoard
            key={first(params.t) ?? "board"}
            board={board}
            canWrite={canWrite}
            canLogActivity={can(user.role, "activity:write")}
            canCreateTask={can(user.role, "task:write")}
            qualifiedAbove={thresholds.qualifiedAbove}
            returnTo={returnTo}
          />
        </>
      )}

      {list &&
        (list.rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
            {q ? "Aucune opportunité ne correspond à cette recherche." : "Aucune opportunité ouverte pour le moment."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <caption className="sr-only">Liste des opportunités ouvertes</caption>
                <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Opportunité</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Étape</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Montant</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Pondéré</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Clôture prévue</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Responsable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-surface/60">
                      <td className="px-4 py-3">
                        <Link href={`/opportunites/${row.id}`} className="font-semibold text-brand-700 hover:underline">{row.name}</Link>
                        <p className="text-xs text-muted">{row.accountName}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{row.stage} % — {stageLabel(row.stage)}</td>
                      <td className="px-4 py-3 text-right">{formatFcfa(row.amount)}</td>
                      <td className="px-4 py-3 text-right text-ink-soft">{formatFcfa(row.weighted)}</td>
                      <td className="px-4 py-3 text-ink-soft">{row.expectedCloseDate ? formatDate(row.expectedCloseDate) : "—"}</td>
                      <td className="px-4 py-3 text-ink-soft">{row.ownerName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/opportunites" params={{ q, vue: "liste" }} />
          </>
        ))}
    </div>
  );
}
