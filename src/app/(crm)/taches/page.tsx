import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { setTaskStatusAction } from "@/app/(crm)/taches/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { listAssignableOwners } from "@/features/accounts/service";
import { TASK_VIEWS, taskPriorityLabel } from "@/features/tasks/config";
import { taskListSchema } from "@/features/tasks/schemas";
import { canManageTask, listTasks, type TaskRow } from "@/features/tasks/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tâches" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  task_created: "Tâche créée.",
  task_updated: "Tâche modifiée.",
  task_done: "Tâche terminée.",
  task_open: "Tâche rouverte.",
  task_cancelled: "Tâche annulée.",
};

export default function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TasksContent searchParams={searchParams} />
    </Suspense>
  );
}

/** Bouton d'un changement de statut : un formulaire par ligne, sans JavaScript côté navigateur. */
function StatusButton({ task, status, label, returnTo, variant = "secondary" }: { task: TaskRow; status: string; label: string; returnTo: string; variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <form action={setTaskStatusAction}>
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="version" value={task.version} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant={variant} aria-label={`${label} : ${task.title}`}>
        {label}
      </Button>
    </form>
  );
}

async function TasksContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("task:read");
  const params = await searchParams;

  const { view, page } = taskListSchema.parse({ view: first(params.vue), page: first(params.page) });
  // « responsable » : absent = mes tâches ; « tous » = toutes les tâches visibles ; sinon l'identifiant d'un collègue.
  const responsable = first(params.responsable);
  const everyone = responsable === "tous";
  const assigneeId = everyone ? null : (taskListSchema.shape.assigneeId.parse(responsable) ?? user.id);

  const canWrite = can(user.role, "task:write");
  const [list, people] = await Promise.all([
    listTasks(user, { view, assigneeId, page }),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  const keep = new URLSearchParams();
  if (view !== "open") keep.set("vue", view);
  if (responsable) keep.set("responsable", responsable);
  if (page > 1) keep.set("page", String(page));
  const returnTo = keep.size > 0 ? `/taches?${keep.toString()}` : "/taches";

  const tabHref = (code: string) => {
    const next = new URLSearchParams();
    if (code !== "open") next.set("vue", code);
    if (responsable) next.set("responsable", responsable);
    return next.size > 0 ? `/taches?${next.toString()}` : "/taches";
  };
  const countOf: Record<string, number | undefined> = { open: list.counts.open, late: list.counts.late, today: list.counts.today };

  const flashKey = first(params.ok);
  const flash = flashKey ? FLASH[flashKey] : undefined;

  return (
    <div>
      <PageHeader
        title="Tâches"
        description="Vos relances et actions à mener, avec leur échéance. Une tâche ouverte a toujours un responsable."
        actions={
          canWrite ? (
            <Link href="/taches/nouveau" className={buttonClasses("primary")}>
              Nouvelle tâche
            </Link>
          ) : undefined
        }
      />

      {flash && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}
      {params.erreur && (
        <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          L&apos;opération n&apos;a pas pu être effectuée : la tâche a peut-être été modifiée entre-temps.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Vues des tâches" className="flex flex-wrap gap-2">
          {TASK_VIEWS.map((tab) => (
            <Link
              key={tab.code}
              href={tabHref(tab.code)}
              aria-current={view === tab.code ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium",
                view === tab.code ? "bg-brand-700 text-white" : "border border-line bg-white text-ink hover:bg-surface",
              )}
            >
              {tab.label}
              {countOf[tab.code] !== undefined && (
                <span className={cn("ml-2 rounded-full px-1.5 text-xs", tab.code === "late" && countOf.late ? "bg-danger text-white" : "bg-black/10")}>
                  {countOf[tab.code]}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <form method="get" role="search" className="flex items-end gap-3">
          {view !== "open" && <input type="hidden" name="vue" value={view} />}
          <div>
            <label htmlFor="responsable" className="mb-1.5 block text-sm font-medium text-ink">Afficher</label>
            <select id="responsable" name="responsable" defaultValue={responsable ?? ""} className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink">
              <option value="">Mes tâches</option>
              <option value="tous">Toutes les tâches visibles</option>
              {people
                ?.filter((p) => p.id !== user.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          </div>
          <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
        </form>
      </div>

      {list.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          {view === "late"
            ? "Aucune tâche en retard : bravo."
            : view === "done"
              ? "Aucune tâche terminée pour le moment."
              : "Aucune tâche dans cette vue."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Liste des tâches</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Tâche</th>
                <th scope="col" className="px-4 py-3 font-semibold">{view === "done" ? "Terminée le" : "Échéance"}</th>
                <th scope="col" className="px-4 py-3 font-semibold">Lié à</th>
                <th scope="col" className="px-4 py-3 font-semibold">Responsable</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.rows.map((task) => {
                const manageable = canManageTask(user, task);
                return (
                  <tr key={task.id} className="align-top hover:bg-surface/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{task.title}</p>
                      <p className="text-xs text-muted">
                        Priorité {taskPriorityLabel(task.priority).toLowerCase()}
                        {task.origin === "automation" && " · créée automatiquement"}
                      </p>
                      {task.description && <p className="mt-1 text-xs text-ink-soft">{task.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {task.status === "done" && task.completedAt ? (
                        formatDate(task.completedAt)
                      ) : (
                        <span className={cn(task.overdue && "font-semibold text-danger")}>
                          {formatDate(task.dueDate)}
                          {task.overdue && <span className="block text-xs">en retard de {task.daysLate} jour{task.daysLate > 1 ? "s" : ""}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {task.opportunityId ? (
                        <Link href={`/opportunites/${task.opportunityId}`} className="text-brand-700 hover:underline">{task.opportunityName}</Link>
                      ) : task.accountId ? (
                        <Link href={`/comptes/${task.accountId}`} className="text-brand-700 hover:underline">{task.accountName}</Link>
                      ) : (
                        "—"
                      )}
                      {task.contactName && <span className="block text-xs text-muted">{task.contactName}</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{task.assigneeName}</td>
                    <td className="px-4 py-3">
                      {manageable && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {task.status === "open" && (
                            <>
                              <StatusButton task={task} status="done" label="Terminer" returnTo={returnTo} variant="primary" />
                              <Link href={`/taches/${task.id}/modifier?retour=${encodeURIComponent(returnTo)}`} className={buttonClasses("secondary")}>
                                Modifier
                              </Link>
                              <StatusButton task={task} status="cancelled" label="Annuler" returnTo={returnTo} variant="ghost" />
                            </>
                          )}
                          {task.status !== "open" && <StatusButton task={task} status="open" label="Rouvrir" returnTo={returnTo} />}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        basePath="/taches"
        params={{ vue: view === "open" ? undefined : view, responsable }}
      />
    </div>
  );
}
