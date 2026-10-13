import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { CONTACT_STATUS_CODES, CONTACT_STATUSES, labelOf } from "@/features/accounts/config";
import { listContacts } from "@/features/contacts/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Contacts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContactsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ContactsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("contact:read");
  const params = await searchParams;

  const q = first(params.q)?.trim() || undefined;
  const statusParam = first(params.statut);
  const status = (CONTACT_STATUS_CODES as readonly string[]).includes(statusParam ?? "") ? statusParam : undefined;
  const page = Math.max(Number(first(params.page)) || 1, 1);

  const { rows, total, pageSize } = await listContacts(user, { q, status, page });
  const canWrite = can(user.role, "contact:write");

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Interlocuteurs de vos comptes. Un contact peut être rattaché à plusieurs comptes avec un rôle d'achat différent."
        actions={
          canWrite ? (
            <Link href="/contacts/nouveau" className={buttonClasses("primary")}>
              Nouveau contact
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
              placeholder="Nom, e-mail, téléphone, compte…"
              className="h-10 w-72 max-w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
            />
          </div>
        </div>
        <div>
          <label htmlFor="statut" className="mb-1.5 block text-sm font-medium text-ink">Statut</label>
          <select id="statut" name="statut" defaultValue={status ?? ""} className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink">
            <option value="">Tous</option>
            {CONTACT_STATUSES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          {q || status ? "Aucun contact ne correspond à cette recherche." : "Aucun contact pour le moment."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Liste des contacts</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Contact</th>
                <th scope="col" className="px-4 py-3 font-semibold">E-mail</th>
                <th scope="col" className="px-4 py-3 font-semibold">Téléphone</th>
                <th scope="col" className="px-4 py-3 font-semibold">Comptes</th>
                <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((contact) => (
                <tr key={contact.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{contact.name}</p>
                    <p className="text-xs text-muted">{contact.jobTitle ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{contact.email ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{contact.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    {contact.accounts.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <ul className="space-y-1">
                        {contact.accounts.map((account) => (
                          <li key={account.id}>
                            <Link href={`/comptes/${account.id}`} className="text-brand-700 hover:underline">
                              {account.legalName}
                            </Link>
                            {account.isPrimary && <span className="ml-1 text-xs text-muted">(principal)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{labelOf(CONTACT_STATUSES, contact.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/contacts/${contact.id}`} className="font-medium text-brand-700 hover:underline" aria-label={`Ouvrir ${contact.name}`}>
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} basePath="/contacts" params={{ q, statut: status }} />
    </div>
  );
}
