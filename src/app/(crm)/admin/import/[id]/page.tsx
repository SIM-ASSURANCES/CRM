import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { cancelAction, importAction } from "@/app/(crm)/admin/import/actions";
import { InventoryPanel } from "@/app/(crm)/admin/import/_components/inventory-panel";
import { MappingForm } from "@/app/(crm)/admin/import/_components/mapping-form";
import { ReconciliationPanel } from "@/app/(crm)/admin/import/_components/reconciliation-panel";
import { ValueMapPanel } from "@/app/(crm)/admin/import/_components/value-map-panel";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ACCOUNT_STATUSES, CONTACT_STATUSES, COUNTRIES } from "@/features/accounts/config";
import { listAssignableOwners } from "@/features/accounts/service";
import { BATCH_STATUS_LABELS, IMPORT_ENTITY_LABELS, IMPORT_FIELDS, PILOT_SIZE } from "@/features/imports/config";
import { getReconciliation, type Reconciliation } from "@/features/imports/migration";
import { getBatch, listProductOptions, type BatchDetail } from "@/features/imports/service";
import { SECTORS } from "@/features/leads/config";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Import de données" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FLASH: Record<string, string> = {
  analyzed: "Analyse terminée : relisez le rapport de qualité avant d'importer.",
  mapped: "Correspondances enregistrées et lot ré-analysé : relisez le rapport.",
  pilot: `Import pilote terminé (${PILOT_SIZE} lignes au plus). Vérifiez les fiches créées, puis importez le reste.`,
  imported: "Import terminé : contrôlez le rapprochement ci-dessous, puis validez-le.",
  validated: "Rapprochement validé : la source a été effacée.",
};

const ERRORS: Record<string, string> = {
  confirmation: "Cochez la case de confirmation pour lancer l'import.",
  import: "L'import n'a pas pu être lancé : le lot n'est plus prêt (déjà importé ou annulé).",
  annulation: "Ce lot ne peut plus être annulé.",
  correspondances: "Les correspondances n'ont pas pu être appliquées : relancez l'analyse après avoir vérifié l'association des colonnes.",
  acquittement: "Confirmez avoir pris connaissance du rapport d'anomalies avant de valider.",
  validation: "Le rapprochement n'a pas pu être validé : un contrôle est en échec, ou le lot n'est pas entièrement importé.",
};

/** Ce que crée un import, au pluriel, et l'écran où le retrouver. */
const CREATED: Record<BatchDetail["entity"], { noun: string; href: string }> = {
  accounts: { noun: "compte(s) créé(s)", href: "/comptes" },
  contacts: { noun: "contact(s) créé(s)", href: "/contacts" },
  leads: { noun: "prospect(s) créé(s)", href: "/prospects" },
};

export default function ImportBatchPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportBatchContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "good" && "text-emerald-700",
          tone === "bad" && "text-danger",
          tone === "warn" && "text-amber-700",
          !tone && "text-ink",
        )}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}

async function ImportBatchContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const actor = await requirePermissionOrNotFound("import:run");
  const query = await searchParams;
  const ok = typeof query.ok === "string" ? FLASH[query.ok] : undefined;
  const error = typeof query.erreur === "string" ? ERRORS[query.erreur] : undefined;

  let batch: BatchDetail;
  try {
    batch = await getBatch(actor, id);
  } catch (caught) {
    if (caught instanceof AppError && caught.code === "NOT_FOUND") notFound();
    throw caught;
  }

  const canMap = batch.status === "uploaded" || batch.status === "analyzed";
  const owners = canMap ? await listAssignableOwners(actor) : [];
  // Rapprochement : dès qu'une ligne est importée (pilote compris) et jusqu'à la validation.
  const reconciliation: Reconciliation | null =
    batch.status === "imported" || batch.status === "importing" || batch.status === "validated" ? await getReconciliation(actor, batch.id) : null;
  const unrecognized = canMap && batch.status === "analyzed" ? (batch.report?.unrecognized ?? []) : [];
  const productOptions = unrecognized.some((item) => item.field === "product") ? await listProductOptions(actor) : [];
  const fields = IMPORT_FIELDS[batch.entity];
  const duplicates = (batch.report?.duplicatesInDatabase ?? 0) + (batch.report?.duplicatesInFile ?? 0);
  const mappingForm = canMap && (
    <MappingForm
      batchId={batch.id}
      entity={batch.entity}
      headers={batch.headers}
      fields={fields.map((field) => ({ key: field.key, label: field.label, required: field.required, hint: field.hint }))}
      initialMapping={batch.suggestedMapping}
      initialDefaults={batch.defaults ?? {}}
      owners={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
      sectors={SECTORS.map((sector) => ({ value: sector, label: sector }))}
      statuses={(batch.entity === "accounts" ? ACCOUNT_STATUSES : batch.entity === "contacts" ? CONTACT_STATUSES : []).map((status) => ({ value: status.code, label: status.label }))}
      countries={COUNTRIES.map((country) => ({ value: country.code, label: country.label }))}
      submitLabel={batch.status === "uploaded" ? "Analyser le fichier" : "Relancer l'analyse"}
    />
  );

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={batch.filename}
        description={`${IMPORT_ENTITY_LABELS[batch.entity]} · ${formatNumber(batch.totalRows)} lignes · ${BATCH_STATUS_LABELS[batch.status] ?? batch.status} · déposé par ${batch.creatorName} le ${formatDateTime(batch.createdAt)}`}
        actions={
          <Link href="/admin/import" className={buttonClasses("secondary")}>
            Tous les imports
          </Link>
        }
      />

      {ok && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {ok}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {batch.status === "cancelled" && (
        <p role="status" className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          Cet import a été annulé : les lignes du fichier ont été supprimées.
        </p>
      )}

      {batch.profile && batch.status !== "cancelled" && <InventoryPanel profile={batch.profile} open={batch.status === "uploaded"} />}

      {batch.status === "uploaded" && (
        <section aria-labelledby="association" className="rounded-2xl border border-line bg-white p-6 md:p-8">
          <h2 id="association" className="mb-5 text-lg font-semibold text-ink">2. Associer les colonnes</h2>
          {mappingForm}
        </section>
      )}

      {batch.report && (
        <section aria-labelledby="rapport" className="space-y-5">
          <h2 id="rapport" className="text-lg font-semibold text-ink">Rapport de qualité</h2>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Lignes du fichier" value={batch.report.total} />
            <Kpi label={batch.status === "imported" ? "Importées" : "Prêtes à importer"} value={batch.status === "imported" ? batch.importedRows : batch.report.valid} tone="good" />
            <Kpi label="Rejetées" value={batch.rejectedRows} tone={batch.rejectedRows > 0 ? "bad" : undefined} />
            <Kpi label="Doublons ignorés" value={duplicates} tone={duplicates > 0 ? "warn" : undefined} />
          </div>
          {duplicates > 0 && (
            <p className="text-sm text-ink-soft">
              Dont {formatNumber(batch.report.duplicatesInDatabase)} déjà présent(s) dans le CRM et {formatNumber(batch.report.duplicatesInFile)} en double dans
              le fichier.
            </p>
          )}

          {batch.report.reasons.length > 0 && (
            <div className="rounded-2xl border border-line bg-white p-5">
              <h3 className="mb-3 text-base font-semibold text-ink">Motifs de rejet les plus fréquents</h3>
              <ul className="space-y-1.5 text-sm">
                {batch.report.reasons.map((reason) => (
                  <li key={reason.reason} className="flex justify-between gap-4">
                    <span className="text-ink-soft">{reason.reason}</span>
                    <span className="shrink-0 font-semibold text-ink">{formatNumber(reason.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {batch.report.missing.length > 0 && (
            <div className="rounded-2xl border border-line bg-white p-5">
              <h3 className="mb-1 text-base font-semibold text-ink">Champs recommandés manquants</h3>
              <p className="mb-3 text-sm text-muted">Parmi les lignes valides : ils pourront être complétés sur les fiches.</p>
              <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                {batch.report.missing.map((entry) => (
                  <li key={entry.label} className="flex justify-between gap-4">
                    <span className="text-ink-soft">{entry.label}</span>
                    <span className="font-semibold text-ink">{formatNumber(entry.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {batch.report.warningRows > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
              <h3 className="mb-1 text-base font-semibold text-ink">Avertissements ({formatNumber(batch.report.warningRows)} ligne(s))</h3>
              <p className="mb-3 text-sm text-ink-soft">
                Ces lignes sont importées, mais une valeur est ignorée (numéro de téléphone illisible, produit inconnu avant la qualification…). Le rapport
                d&apos;anomalies donne la valeur d&apos;origine à corriger dans la source.
              </p>
              <ul className="space-y-1.5 text-sm">
                {batch.report.warnings.map((warning) => (
                  <li key={warning.reason} className="flex justify-between gap-4">
                    <span className="text-ink-soft">{warning.reason}</span>
                    <span className="shrink-0 font-semibold text-ink">{formatNumber(warning.count)}</span>
                  </li>
                ))}
              </ul>
              <a href={`/api/import/${batch.id}/rejects`} className={cn(buttonClasses("secondary"), "mt-4")} download>
                <Download className="size-4" aria-hidden="true" />
                Télécharger le rapport d&apos;anomalies (CSV)
              </a>
            </div>
          )}

          {unrecognized.length > 0 && (
            <ValueMapPanel
              batchId={batch.id}
              unrecognized={unrecognized}
              sectors={SECTORS.map((sector) => ({ value: sector, label: sector }))}
              products={productOptions.map((product) => ({ value: product.code, label: product.label }))}
            />
          )}

          {batch.report.unmappedHeaders.length > 0 && (
            <p className="text-sm text-ink-soft">
              <strong>Colonnes ignorées :</strong> {batch.report.unmappedHeaders.join(", ")}.
            </p>
          )}

          {batch.problems.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-ink">Lignes à corriger</h3>
                <a href={`/api/import/${batch.id}/rejects`} className={buttonClasses("secondary")} download>
                  <Download className="size-4" aria-hidden="true" />
                  Télécharger le rapport (CSV)
                </a>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <caption className="sr-only">Lignes rejetées et doublons</caption>
                  <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Ligne</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Résultat</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Contenu</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Motif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {batch.problems.map((problem) => (
                      <tr key={problem.rowNumber} className="align-top">
                        <td className="px-4 py-3 font-medium text-ink">{problem.rowNumber}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              problem.status === "rejected" ? "bg-red-50 text-danger" : "bg-amber-50 text-amber-800",
                            )}
                          >
                            {problem.status === "rejected" ? "Rejetée" : "Doublon"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{problem.preview.join(" · ") || "—"}</td>
                        <td className="px-4 py-3 text-ink-soft">
                          <ul className="space-y-0.5">
                            {problem.messages.map((message) => (
                              <li key={message}>{message}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {batch.problemsTruncated && (
                <p className="text-sm text-muted">Seules les 100 premières lignes sont affichées : téléchargez le rapport pour les voir toutes.</p>
              )}
            </div>
          )}
        </section>
      )}

      {(batch.status === "analyzed" || batch.status === "importing") && (
        <section aria-labelledby="import" className="rounded-2xl border border-line bg-white p-6 md:p-8">
          <h2 id="import" className="mb-2 text-lg font-semibold text-ink">3. Importer</h2>
          {batch.status === "importing" && (
            <p className="mb-3 text-sm text-ink-soft">
              Import en cours (pilote ou import interrompu) : {formatNumber(batch.importedRows)} ligne(s) déjà importée(s). Vérifiez les fiches créées, puis
              importez le reste.
            </p>
          )}
          {batch.status === "analyzed" && batch.validRows > PILOT_SIZE && (
            <p className="mb-3 text-sm text-ink-soft">
              Conseil : lancez d&apos;abord un <strong>import pilote</strong> de {PILOT_SIZE} lignes, contrôlez les fiches, puis importez le reste.
            </p>
          )}
          <p className="mb-4 text-sm text-ink-soft">
            <strong>{formatNumber(batch.validRows)}</strong> ligne(s) valide(s) seront créée(s). Les lignes rejetées et les doublons ne sont pas importés.
            L&apos;opération est journalisée.
          </p>
          <form action={importAction} className="space-y-4">
            <input type="hidden" name="id" value={batch.id} />
            <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
              <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-brand-700" />
              <span>J&apos;ai relu le rapport de qualité et je confirme l&apos;import de ces lignes.</span>
            </label>
            <div className="flex flex-wrap gap-3">
              {/* Import pilote : un petit nombre de fiches, à vérifier avant d'importer le reste (le lot reste « en cours »). */}
              {batch.validRows > PILOT_SIZE && (
                <Button type="submit" name="pilot" value="1" variant="secondary">
                  Import pilote ({PILOT_SIZE} premières lignes)
                </Button>
              )}
              <Button type="submit" disabled={batch.validRows === 0}>
                {batch.status === "importing" ? "Importer le reste" : `Importer ${formatNumber(batch.validRows)} ligne(s)`}
              </Button>
            </div>
          </form>
        </section>
      )}

      {batch.status === "analyzed" && mappingForm && (
        <details className="rounded-2xl border border-line bg-white p-6">
          <summary className="cursor-pointer text-base font-semibold text-ink">Modifier l&apos;association des colonnes et relancer l&apos;analyse</summary>
          <div className="mt-5">{mappingForm}</div>
        </details>
      )}

      {(batch.status === "imported" || batch.status === "importing" || batch.status === "validated") && batch.importedRows > 0 && (
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-sm text-emerald-900">
          <p className="font-semibold">
            {formatNumber(batch.importedRows)} {CREATED[batch.entity].noun}
            {batch.importedAt ? ` le ${formatDateTime(batch.importedAt)}` : ""}.
          </p>
          <p className="mt-2">
            <Link href={CREATED[batch.entity].href} className="font-medium underline">
              Voir les fiches créées
            </Link>
            {batch.entity === "accounts" && " · puis importez les contacts de ces comptes."}
          </p>
        </section>
      )}

      {reconciliation && <ReconciliationPanel reconciliation={reconciliation} batchId={batch.id} />}

      {canMap && (
        <form action={cancelAction} className="pt-2">
          <input type="hidden" name="id" value={batch.id} />
          <Button type="submit" variant="ghost">
            Annuler cet import et supprimer le fichier
          </Button>
        </form>
      )}
    </div>
  );
}
