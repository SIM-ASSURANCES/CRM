import { CheckCircle2, Download, XCircle } from "lucide-react";
import { validateAction } from "@/app/(crm)/admin/import/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import type { Reconciliation } from "@/features/imports/migration";
import { formatDateTime, formatFcfa, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Rapprochement d'un lot (phase 7, « sortie : rapprochement accepté ») : le fichier d'origine, le sort de chaque ligne et
 * les fiches en base sont comparés. La validation, qui efface la source, n'est possible que si tous les contrôles passent.
 */
export function ReconciliationPanel({ reconciliation, batchId }: { reconciliation: Reconciliation; batchId: string }) {
  const { counts, checks, amounts } = reconciliation;
  const anomalies = counts.rejected + counts.duplicates + counts.withWarnings;
  const validated = reconciliation.status === "validated";

  return (
    <section aria-labelledby="rapprochement" className="space-y-5 rounded-2xl border border-line bg-white p-6 md:p-8">
      <div>
        <h2 id="rapprochement" className="text-lg font-semibold text-ink">
          Rapprochement avec la source
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {formatNumber(reconciliation.sourceRows)} ligne(s) dans le fichier : {formatNumber(counts.imported)} importée(s), {formatNumber(counts.rejected)} rejetée(s),{" "}
          {formatNumber(counts.duplicates)} doublon(s), {formatNumber(counts.pending)} en attente
          {counts.withWarnings > 0 && `, dont ${formatNumber(counts.withWarnings)} ligne(s) avec avertissement`}.
        </p>
      </div>

      <ul className="space-y-2">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2 text-sm">
            {check.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-label="Conforme" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Non conforme" />
            )}
            <span>
              <span className={cn("font-medium", check.ok ? "text-ink" : "text-danger")}>{check.label}</span>
              <span className="block text-ink-soft">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {amounts && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="bg-surface px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">{amounts.label}</caption>
            <tbody className="divide-y divide-line">
              <tr>
                <th scope="row" className="px-4 py-2 font-medium text-ink">Lignes importées, lues dans le fichier</th>
                <td className="px-4 py-2 text-right text-ink-soft">{formatFcfa(amounts.imported)}</td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2 font-medium text-ink">Fiches correspondantes, relues en base</th>
                <td className={cn("px-4 py-2 text-right font-semibold", Math.abs(amounts.imported - amounts.inCrm) < 0.01 ? "text-emerald-700" : "text-danger")}>
                  {formatFcfa(amounts.inCrm)}
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2 text-ink-soft">Lignes rejetées</th>
                <td className="px-4 py-2 text-right text-ink-soft">{formatFcfa(amounts.rejected)}</td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2 text-ink-soft">Doublons</th>
                <td className="px-4 py-2 text-right text-ink-soft">{formatFcfa(amounts.duplicates)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {validated ? (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>Rapprochement validé</strong>
          {reconciliation.validatedAt ? ` le ${formatDateTime(reconciliation.validatedAt)}` : ""} : la source (cellules d&apos;origine) a été effacée. Les fiches
          importées sont conservées.
        </p>
      ) : (
        <div className="space-y-4">
          {anomalies > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <a href={`/api/import/${batchId}/rejects`} className={buttonClasses("secondary")} download>
                <Download className="size-4" aria-hidden="true" />
                Télécharger le rapport d&apos;anomalies (CSV)
              </a>
              <span className="text-sm text-muted">À lire avant de valider : la validation efface la source.</span>
            </div>
          )}
          <form action={validateAction} className="space-y-3">
            <input type="hidden" name="id" value={batchId} />
            {anomalies > 0 && (
              <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                <input type="checkbox" name="acknowledged" className="mt-0.5 size-4 accent-brand-700" />
                <span>
                  J&apos;ai pris connaissance du rapport d&apos;anomalies ({formatNumber(counts.rejected)} rejet(s), {formatNumber(counts.duplicates)} doublon(s),{" "}
                  {formatNumber(counts.withWarnings)} avertissement(s)).
                </span>
              </label>
            )}
            <Button type="submit" disabled={!reconciliation.ready}>
              Valider le rapprochement et effacer la source
            </Button>
            {!reconciliation.ready && (
              <p className="text-sm text-muted">
                {reconciliation.status === "importing"
                  ? "Terminez d'abord l'import : le rapprochement porte sur le lot entier."
                  : "Un contrôle est en échec : corrigez-le avant de valider."}
              </p>
            )}
          </form>
          <p className="text-xs text-muted">
            La source est conservée jusqu&apos;à la validation, puis effacée d&apos;office après 90 jours sans validation.
          </p>
        </div>
      )}
    </section>
  );
}
