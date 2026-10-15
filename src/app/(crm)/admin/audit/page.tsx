import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { auditFacets, auditFiltersSchema, EXPORT_LIMIT, listAuditLogs } from "@/features/audit/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDateTime, toDateInputValue } from "@/lib/format";

export const metadata: Metadata = { title: "Journal d'audit" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Familles d'actions : le premier segment du code (« account.merged » → « account »).
const FAMILY_LABELS: Record<string, string> = {
  auth: "Authentification",
  user: "Utilisateurs",
  team: "Équipes",
  lead: "Prospects",
  account: "Comptes",
  contact: "Contacts",
  opportunity: "Opportunités",
  activity: "Activités",
  task: "Tâches",
  automation: "Automatisations",
  import: "Import de données",
  audit: "Journal d'audit",
};
const familyLabel = (family: string) => FAMILY_LABELS[family] ?? family;

export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("audit:read");
  const params = await searchParams;

  // Un filtre invalide (adresse modifiée à la main) est ignoré : le journal s'affiche sans filtre.
  const parsed = auditFiltersSchema.safeParse({
    action: first(params.action),
    entityType: first(params.objet),
    actorId: first(params.auteur),
    from: first(params.du),
    to: first(params.au),
  });
  const filters = parsed.success ? parsed.data : {};
  const page = Math.max(Number(first(params.page)) || 1, 1);

  const [{ rows, total, pageSize }, facets] = await Promise.all([listAuditLogs(user, filters, { page }), auditFacets(user)]);

  // Les actions regroupées par famille pour la liste déroulante.
  const families = new Map<string, string[]>();
  for (const action of facets.actions) {
    const family = action.split(".")[0];
    families.set(family, [...(families.get(family) ?? []), action]);
  }

  const query = new URLSearchParams();
  const keep: [string, string | undefined][] = [
    ["action", filters.action],
    ["objet", filters.entityType],
    ["auteur", filters.actorId],
    ["du", filters.from ? toDateInputValue(filters.from) : undefined],
    ["au", filters.to ? toDateInputValue(filters.to) : undefined],
  ];
  for (const [key, value] of keep) if (value) query.set(key, value);
  const exportHref = `/api/audit/export${query.size > 0 ? `?${query.toString()}` : ""}`;

  const select = "h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journal d'audit"
        description="Traces des connexions, changements de responsable, fusions, imports, exports et réglages. Le journal est en ajout seul : rien ne peut y être modifié ni effacé."
        actions={
          can(user.role, "audit:export") ? (
            <a href={exportHref} className={buttonClasses("secondary")} download>
              <Download className="size-4" aria-hidden="true" />
              Exporter en CSV
            </a>
          ) : undefined
        }
      />

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="action" className="mb-1.5 block text-sm font-medium text-ink">Action</label>
          <select id="action" name="action" defaultValue={filters.action ?? ""} className={select}>
            <option value="">Toutes</option>
            {[...families].map(([family, actions]) => (
              <optgroup key={family} label={familyLabel(family)}>
                <option value={`${family}.*`}>Toute la famille « {familyLabel(family)} »</option>
                {actions.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="objet" className="mb-1.5 block text-sm font-medium text-ink">Objet</label>
          <select id="objet" name="objet" defaultValue={filters.entityType ?? ""} className={select}>
            <option value="">Tous</option>
            {facets.entityTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auteur" className="mb-1.5 block text-sm font-medium text-ink">Auteur</label>
          <select id="auteur" name="auteur" defaultValue={filters.actorId ?? ""} className={select}>
            <option value="">Tous</option>
            <option value="system">Système (automatismes)</option>
            {facets.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="du" className="mb-1.5 block text-sm font-medium text-ink">Du</label>
          <input id="du" name="du" type="date" defaultValue={filters.from ? toDateInputValue(filters.from) : ""} className={select} />
        </div>
        <div>
          <label htmlFor="au" className="mb-1.5 block text-sm font-medium text-ink">Au</label>
          <input id="au" name="au" type="date" defaultValue={filters.to ? toDateInputValue(filters.to) : ""} className={select} />
        </div>
        <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
        {query.size > 0 && (
          <Link href="/admin/audit" className="pb-2 text-sm font-medium text-brand-700 hover:underline">
            Réinitialiser
          </Link>
        )}
      </form>

      {can(user.role, "audit:export") && total > EXPORT_LIMIT && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-ink">
          {total} lignes correspondent : l&apos;export est limité aux {EXPORT_LIMIT} plus récentes. Affinez les filtres pour exporter le reste.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          Aucune trace ne correspond à ces filtres.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Journal d&apos;audit</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Date (UTC)</th>
                <th scope="col" className="px-4 py-3 font-semibold">Auteur</th>
                <th scope="col" className="px-4 py-3 font-semibold">Action</th>
                <th scope="col" className="px-4 py-3 font-semibold">Objet</th>
                <th scope="col" className="px-4 py-3 font-semibold">Adresse IP</th>
                <th scope="col" className="px-4 py-3 font-semibold">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-surface/60">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDateTime(row.occurredAt)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{row.actorName}</p>
                    {row.actorEmail && <p className="text-xs text-muted">{row.actorEmail}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-ink">{row.action}</code>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {row.entityType}
                    {row.entityId && <span className="block max-w-[10rem] truncate text-xs text-muted" title={row.entityId}>{row.entityId}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{row.ipAddress ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.metadata === null ? (
                      "—"
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-brand-700">Voir</summary>
                        <pre className="mt-2 max-w-sm overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface p-2 text-xs text-ink">
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/audit"
        params={Object.fromEntries(keep)}
      />
    </div>
  );
}
