import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { normalizePhonesAction } from "@/app/(crm)/admin/import/actions";
import { UploadForm } from "@/app/(crm)/admin/import/_components/upload-form";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { BATCH_STATUS_LABELS, IMPORT_ENTITY_LABELS, MAX_IMPORT_ROWS, SOURCE_RETENTION_DAYS } from "@/features/imports/config";
import { previewStoredPhones, type StoredPhoneReport } from "@/features/imports/migration";
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
  const query = await searchParams;
  const ok = query.ok;
  const batches = await listBatches(actor);
  // La simulation parcourt toutes les fiches ayant un téléphone : elle n'est calculée qu'à la demande.
  const phoneReport: StoredPhoneReport[] | null = query.telephones === "simulation" ? await previewStoredPhones(actor) : null;
  const phonesToFix = phoneReport?.reduce((sum, entry) => sum + entry.toNormalize, 0) ?? 0;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Import de données"
        description="Migrez vos comptes, contacts et prospects depuis un fichier Excel ou CSV. Rien n'est créé avant que vous ayez relu le rapport de qualité et confirmé ; un import pilote et un rapprochement avec la source vérifient la migration."
      />

      {ok === "cancelled" && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Import annulé : les lignes du fichier ont été supprimées.
        </p>
      )}
      {ok === "phones" && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Numéros de téléphone normalisés au format +225…
        </p>
      )}
      {query.erreur === "confirmation" && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          Cochez la case de confirmation pour normaliser les numéros.
        </p>
      )}

      <section aria-labelledby="deposer" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="deposer" className="mb-2 text-lg font-semibold text-ink">1. Déposer un fichier</h2>
        <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>
            Importez <strong>les comptes d&apos;abord</strong>, puis les contacts (qui sont rattachés à un compte existant). Les prospects sont indépendants.
          </li>
          <li>
            Les numéros de téléphone sont enregistrés au format <strong>+225…</strong> (10 chiffres). Un numéro à 8 chiffres d&apos;avant 2021 est signalé,
            jamais deviné.
          </li>
          <li>
            La source (cellules du fichier) est conservée jusqu&apos;à la <strong>validation du rapprochement</strong>, puis effacée ; sans validation, elle est
            effacée d&apos;office après {SOURCE_RETENTION_DAYS} jours.
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
            </a>{" "}
            ·{" "}
            <a href="/api/import/template?entite=leads" className="font-medium text-brand-700 underline" download>
              prospects
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

      <section aria-labelledby="telephones" className="space-y-3 rounded-2xl border border-line bg-white p-6">
        <h2 id="telephones" className="text-lg font-semibold text-ink">Téléphones déjà enregistrés</h2>
        <p className="text-sm text-ink-soft">
          Les fiches saisies avant la migration peuvent porter des numéros écrits de plusieurs façons. La normalisation les ramène au format unique
          <strong> +225…</strong> sans jamais modifier un numéro illisible (à corriger à la main).
        </p>
        {!phoneReport ? (
          <Link href="/admin/import?telephones=simulation" className={buttonClasses("secondary")}>
            Simuler la normalisation
          </Link>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Simulation de la normalisation des téléphones</caption>
                <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-semibold">Fiches</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Avec numéro</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Déjà au format</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">À normaliser</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">À corriger à la main</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {phoneReport.map((entry) => (
                    <tr key={entry.entity}>
                      <th scope="row" className="px-4 py-2 font-medium text-ink">{IMPORT_ENTITY_LABELS[entry.entity]}</th>
                      <td className="px-4 py-2 text-right text-ink-soft">{formatNumber(entry.withPhone)}</td>
                      <td className="px-4 py-2 text-right text-ink-soft">{formatNumber(entry.alreadyNormalized)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-ink">{formatNumber(entry.toNormalize)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-amber-700">{formatNumber(entry.unresolved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {phoneReport.some((entry) => entry.samples.length > 0) && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-ink">Exemples de numéros à corriger à la main</summary>
                <ul className="mt-2 space-y-1 text-ink-soft">
                  {phoneReport.flatMap((entry) => entry.samples.slice(0, 5).map((sample) => (
                    <li key={`${entry.entity}-${sample.id}`}>
                      {IMPORT_ENTITY_LABELS[entry.entity]} · {sample.label} : « {sample.phone} »
                    </li>
                  )))}
                </ul>
              </details>
            )}

            <form action={normalizePhonesAction} className="space-y-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-brand-700" />
                <span>Je confirme la normalisation de {formatNumber(phonesToFix)} numéro(s) (l&apos;opération est journalisée, sans les numéros).</span>
              </label>
              <Button type="submit" disabled={phonesToFix === 0}>
                Normaliser {formatNumber(phonesToFix)} numéro(s)
              </Button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
