import type { Metadata } from "next";
import { Suspense } from "react";
import { runNowAction } from "@/app/(crm)/admin/automatisations/actions";
import { RuleForm } from "@/app/(crm)/admin/automatisations/_components/rule-form";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ruleLabel } from "@/features/automations/config";
import { listRules, listRuns } from "@/features/automations/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Automatisations" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  rule_updated: "Règle enregistrée.",
  run: "Exécution terminée : consultez le journal ci-dessous.",
};

const STATUS: Record<string, { label: string; className: string }> = {
  success: { label: "Réussie", className: "bg-emerald-50 text-emerald-800" },
  error: { label: "Erreur", className: "bg-red-50 text-danger" },
  running: { label: "En cours", className: "bg-amber-50 text-amber-800" },
};

export default function AutomationsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AutomationsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AutomationsContent({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePermissionOrNotFound("settings:manage");
  const params = await searchParams;
  const [rules, runs] = await Promise.all([listRules(actor), listRuns(actor, 30)]);

  const flashKey = first(params.ok);
  const flash = flashKey ? FLASH[flashKey] : undefined;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Automatisations"
        description="Relances automatiques : chaque règle est activable, paramétrable et journalisée. Une alerte similaire n'est jamais répétée dans la même période."
        actions={
          <form action={runNowAction}>
            <Button type="submit">Exécuter maintenant</Button>
          </form>
        }
      />

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}
      {params.erreur && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          L&apos;opération n&apos;a pas pu être effectuée.
        </p>
      )}

      <section aria-labelledby="regles" className="space-y-4">
        <h2 id="regles" className="text-lg font-semibold text-ink">Règles</h2>
        {rules.map((rule) => (
          <RuleForm
            key={rule.code}
            code={rule.code}
            label={rule.label}
            trigger={rule.trigger}
            action={rule.action}
            enabled={rule.enabled}
            params={rule.params}
            paramDefs={rule.paramDefs}
            lastRunText={
              rule.lastRun
                ? `Dernière exécution le ${formatDateTime(rule.lastRun.startedAt)} : ${rule.lastRun.evaluated} évalué(s), ${rule.lastRun.tasksCreated} tâche(s) et ${rule.lastRun.notificationsCreated} notification(s) créée(s).`
                : null
            }
          />
        ))}
      </section>

      <section aria-labelledby="journal" className="space-y-3">
        <h2 id="journal" className="text-lg font-semibold text-ink">Journal d&apos;exécution</h2>
        {runs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
            Aucune exécution pour le moment. Lancez-en une avec « Exécuter maintenant ».
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Journal des exécutions des automatisations</caption>
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Règle</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Déclenchement</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Évalués</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Tâches</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Notifications</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Déjà traités</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((run) => {
                  const status = STATUS[run.status] ?? STATUS.running;
                  return (
                    <tr key={run.id} className="align-top">
                      <td className="px-4 py-3 text-ink-soft">{formatDateTime(run.startedAt)}</td>
                      <td className="px-4 py-3 font-medium text-ink">{ruleLabel(run.ruleCode)}</td>
                      <td className="px-4 py-3 text-ink-soft">{run.trigger === "manual" ? "Manuel" : "Planifié"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>{status.label}</span>
                        {run.error && <p className="mt-1 max-w-xs text-xs text-danger">{run.error}</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-soft">{run.evaluated}</td>
                      <td className="px-4 py-3 text-right text-ink-soft">{run.tasksCreated}</td>
                      <td className="px-4 py-3 text-right text-ink-soft">{run.notificationsCreated}</td>
                      <td className="px-4 py-3 text-right text-ink-soft">{run.skipped}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
