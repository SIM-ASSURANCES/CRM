import { Search } from "lucide-react";
import Link from "next/link";
import { LeadsTable } from "@/app/(crm)/prospects/_components/leads-table";
import { Pagination } from "@/components/ui/pagination";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { listLeads } from "@/features/leads/service";
import { VIEW_META, isLeadView, type LeadView } from "@/features/leads/views";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function flashMessage(ok: string | undefined, to: string | undefined): string | null {
  if (ok === "created") return "Prospect enregistré.";
  if (ok === "lost") return "Prospect marqué comme perdu.";
  if (ok === "updated") {
    const destinations = (to ?? "")
      .split(",")
      .filter(isLeadView)
      .map((view) => `« ${VIEW_META[view].title} »`);
    return destinations.length > 0
      ? `Prospect mis à jour. Il figure dans : ${destinations.join(" et ")}.`
      : "Prospect mis à jour.";
  }
  return null;
}

/**
 * Écran de reporting partagé : les 5 « onglets » de l'Excel sont la même liste, filtrée par vue.
 * Aucune donnée n'est copiée d'un écran à l'autre : un prospect apparaît selon son pourcentage d'avancement.
 */
export async function LeadsViewPage({ view, searchParams }: { view: LeadView; searchParams: SearchParams }) {
  const user = await requirePermission("prospect:read");
  const params = await searchParams;

  const q = first(params.q)?.trim() || undefined;
  const page = Math.max(Number(first(params.page)) || 1, 1);
  const lost = view === "prospects" && first(params.perdus) === "1";

  const { rows, total, pageSize } = await listLeads(user, { view: lost ? undefined : view, lost, q, page });
  const meta = VIEW_META[view];
  const canWrite = can(user.role, "prospect:write");
  const flash = flashMessage(first(params.ok), first(params.to));

  return (
    <div>
      <PageHeader
        title={lost ? "Prospects perdus" : meta.title}
        description={lost ? "Prospects clôturés en perte, avec leur motif." : meta.description}
        actions={
          view === "prospects" && canWrite && !lost ? (
            <Link href="/prospects/nouveau" className={buttonClasses("primary")}>
              Enregistrer un nouveau prospect
            </Link>
          ) : undefined
        }
      />

      {flash && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" role="search" className="flex items-center gap-2">
          {lost && <input type="hidden" name="perdus" value="1" />}
          <label htmlFor="q" className="sr-only">
            Rechercher un prospect
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Entreprise, contact, e-mail…"
              className="h-10 w-72 max-w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
            />
          </div>
          <button type="submit" className={buttonClasses("secondary")}>
            Rechercher
          </button>
        </form>

        {view === "prospects" && (
          <Link
            href={lost ? "/prospects" : "/prospects?perdus=1"}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            {lost ? "Retour aux prospects en cours" : "Voir les prospects perdus"}
          </Link>
        )}
      </div>

      <LeadsTable
        rows={rows}
        showOwner={user.role !== "commercial"}
        emptyMessage={q ? "Aucun résultat pour cette recherche." : lost ? "Aucun prospect perdu." : meta.empty}
        canWrite={canWrite}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={meta.href}
        params={{ q, perdus: lost ? "1" : undefined }}
      />
    </div>
  );
}
