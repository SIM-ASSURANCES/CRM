import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { TaskForm } from "@/app/(crm)/taches/_components/task-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAssignableOwners } from "@/features/accounts/service";
import { canManageTask, getTask, type TaskRow } from "@/features/tasks/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { toDateInputValue } from "@/lib/format";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Modifier une tâche" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function EditTaskPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditTaskContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditTaskContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("task:write");
  const retour = (await searchParams).retour;
  const returnTo = safeRedirectPath(typeof retour === "string" ? retour : undefined, "/taches");

  let task: TaskRow;
  try {
    task = await getTask(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // Seule une tâche ouverte, dont on est responsable ou créateur (ou que l'on peut réaffecter), se modifie.
  if (task.status !== "open" || !canManageTask(user, task)) redirect(returnTo);

  const assignees = can(user.role, "account:assign") ? await listAssignableOwners(user) : undefined;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Modifier la tâche" />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <TaskForm
          mode="update"
          taskId={task.id}
          version={task.version}
          assignees={assignees}
          linked={{
            account: task.accountName ?? undefined,
            opportunity: task.opportunityName ?? undefined,
            contact: task.contactName ?? undefined,
          }}
          returnTo={returnTo}
          initial={{
            title: task.title,
            description: task.description ?? "",
            dueDate: toDateInputValue(task.dueDate),
            priority: task.priority,
            assigneeUserId: task.assigneeUserId,
          }}
        />
      </div>
    </div>
  );
}
