import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountStatusBadge } from "@/app/(crm)/comptes/_components/account-status-badge";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { ACCOUNT_STATUS_CODES, ACCOUNT_STATUSES } from "@/features/accounts/config";
import { listAccounts, type AccountRow } from "@/features/accounts/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Comptes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function Completeness({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2" title={`Complétude de la fiche : ${value} %`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <div className={cn("h-full rounded-full", value >= 80 ? "bg-emerald-500" : value >= 50 ? "bg-brand-500" : "bg-amber-500")} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-muted">{value} %</span>
    </div>
  );
}

export default function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("account:read");
  const params = await searchParams;

  const q = first(params.q)?.trim() || undefined;
  const statusParam = first(params.statut);
  const status = (ACCOUNT_STATUS_CODES as readonly string[]).includes(statusParam ?? "") ? statusParam : undefined;
  const page = Math.max(Number(first(params.page)) || 1, 1);

  const { rows, total, pageSize } = await listAccounts(user, { q, status, page });
  const canWrite = can(user.role, "account:write");

  return (
    <div>
      <PageHeader
        title="Comptes"
        description="Entreprises clientes, prospects et partenaires, avec leur groupe, leurs contacts et leurs rôles d'achat."
        actions={
          canWrite ? (
            <Link href="/comptes/nouveau" className={buttonClasses("primary")}>
              Nouveau compte
            </Link>
          ) : undefined
        }
      />

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">Rechercher</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Raison sociale, identifiant, ville…"
              className="h-10 w-72 max-w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
            />
          </div>
        </div>
        <div>
          <label htmlFor="statut" className="mb-1.5 block text-sm font-medium text-ink">Statut</label>
          <select id="statut" name="statut" defaultValue={status ?? ""} className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink">
            <option value="">Tous</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          {q || status ? "Aucun compte ne correspond à cette recherche." : "Aucun compte pour le moment. Créez votre premier compte."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Liste des comptes</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Compte</th>
                <th scope="col" className="px-4 py-3 font-semibold">Secteur</th>
                <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                <th scope="col" className="px-4 py-3 font-semibold">Groupe</th>
                {user.role !== "commercial" && <th scope="col" className="px-4 py-3 font-semibold">Propriétaire</th>}
                <th scope="col" className="px-4 py-3 text-right font-semibold">Contacts</th>
                <th scope="col" className="px-4 py-3 font-semibold">Complétude</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((account: AccountRow) => (
                <tr key={account.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{account.legalName}</p>
                    <p className="text-xs text-muted">{[account.tradeName, account.city].filter(Boolean).join(" · ") || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{account.sector ?? "—"}</td>
                  <td className="px-4 py-3"><AccountStatusBadge status={account.status} /></td>
                  <td className="px-4 py-3 text-ink-soft">{account.parentName ?? "—"}</td>
                  {user.role !== "commercial" && <td className="px-4 py-3 text-ink-soft">{account.ownerName}</td>}
                  <td className="px-4 py-3 text-right text-ink-soft">{account.contactCount}</td>
                  <td className="px-4 py-3"><Completeness value={account.completeness} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/comptes/${account.id}`} className="font-medium text-brand-700 hover:underline" aria-label={`Ouvrir ${account.legalName}`}>
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} basePath="/comptes" params={{ q, statut: status }} />
    </div>
  );
}
