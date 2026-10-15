import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UploadForm } from "@/app/(crm)/admin/import/_components/upload-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { BATCH_STATUS_LABELS, IMPORT_ENTITY_LABELS, MAX_IMPORT_ROWS } from "@/features/imports/config";
import { listBatches } from "@/features/imports/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Import de données" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ImportContent({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePermissionOrNotFound("import:run");
  const ok = (await searchParams).ok;
  const batches = await listBatches(actor);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Import de données"
        description="Importez vos comptes puis vos contacts depuis un fichier Excel ou CSV. Rien n'est créé avant que vous ayez relu le rapport de qualité et confirmé."
      />

      {ok === "cancelled" && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Import annulé : les lignes du fichier ont été supprimées.
        </p>
      )}

      <section aria-labelledby="deposer" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="deposer" className="mb-2 text-lg font-semibold text-ink">1. Déposer un fichier</h2>
        <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>
            Importez <strong>les comptes d&apos;abord</strong>, puis les contacts (qui sont rattachés à un compte existant).
          </li>
          <li>
            La première ligne contient les en-têtes. Maximum {formatNumber(MAX_IMPORT_ROWS)} lignes et 5 Mo par fichier : découpez les fichiers plus
            gros.
          </li>
          <li>Dans Excel, enregistrez les numéros de téléphone en <strong>texte</strong> pour conserver le 0 initial.</li>
          <li>
            Modèles :{" "}
            <a href="/api/import/template?entite=accounts" className="font-medium text-brand-700 underline" download>
              comptes
            </a>{" "}
            ·{" "}
            <a href="/api/import/template?entite=contacts" className="font-medium text-brand-700 underline" download>
              contacts
            </a>
          </li>
        </ul>
        <UploadForm />
      </section>

      <section aria-labelledby="lots" className="space-y-3">
        <h2 id="lots" className="text-lg font-semibold text-ink">Imports récents</h2>
        {batches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
            Aucun import pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Imports récents</caption>
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Fichier</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Lignes</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Importées</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Par</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-surface/60">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDateTime(batch.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-ink">{batch.filename}</td>
                    <td className="px-4 py-3 text-ink-soft">{IMPORT_ENTITY_LABELS[batch.entity]}</td>
                    <td className="px-4 py-3 text-ink-soft">{BATCH_STATUS_LABELS[batch.status] ?? batch.status}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">{formatNumber(batch.totalRows)}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">{formatNumber(batch.importedRows)}</td>
                    <td className="px-4 py-3 text-ink-soft">{batch.creatorName}</td>
                    <td className="px-4 py-3 text-right">
                      {batch.status !== "cancelled" && (
                        <Link href={`/admin/import/${batch.id}`} className="font-medium text-brand-700 hover:underline" aria-label={`Ouvrir l'import ${batch.filename}`}>
                          Ouvrir
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
