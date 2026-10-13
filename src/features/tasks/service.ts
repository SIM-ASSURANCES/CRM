import "server-only";
import { accountScopeWhere } from "@/features/accounts/scope";
import { notifyAssigned } from "@/features/notifications/service";
import { opportunityScopeWhere } from "@/features/opportunities/scope";
import type { TaskView } from "@/features/tasks/config";
import { daysLate, isDueDateAllowed, isTaskOverdue, todayUtc } from "@/features/tasks/rules";
import type { CreateTaskInput, SetTaskStatusInput, UpdateTaskInput } from "@/features/tasks/schemas";
import { taskScopeWhere } from "@/features/tasks/scope";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { FieldErrors } from "@/lib/forms";

// Service des tâches (CDC 6). Toute opération vérifie la permission, applique le périmètre et écrit la donnée et
// l'audit dans la MÊME transaction. Toute tâche ouverte a un responsable (CDC 12 : « User → Task »).

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date;
  status: string;
  priority: string;
  assigneeUserId: string;
  assigneeName: string;
  createdByUserId: string;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  completedAt: Date | null;
  origin: string;
  overdue: boolean;
  daysLate: number;
  version: number;
};

export type TaskCounts = { open: number; late: number; today: number };

const taskInclude = {
  assignee: { select: { name: true } },
  account: { select: { legalName: true } },
  contact: { select: { firstName: true, lastName: true } },
  opportunity: { select: { name: true } },
} satisfies Prisma.TaskInclude;

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function toRow(task: TaskWithRelations, now: Date): TaskRow {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    status: task.status,
    priority: task.priority,
    assigneeUserId: task.assigneeUserId,
    assigneeName: task.assignee.name,
    createdByUserId: task.createdByUserId,
    accountId: task.accountId,
    accountName: task.account?.legalName ?? null,
    contactId: task.contactId,
    contactName: task.contact ? `${task.contact.firstName} ${task.contact.lastName}` : null,
    opportunityId: task.opportunityId,
    opportunityName: task.opportunity?.name ?? null,
    completedAt: task.completedAt,
    origin: task.origin,
    overdue: isTaskOverdue(task.dueDate, task.status, now),
    daysLate: daysLate(task.dueDate, task.status, now),
    version: task.version,
  };
}

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

function fail(fieldErrors: FieldErrors, message = "Certaines informations sont manquantes."): never {
  throw errors.validation(message, { fieldErrors });
}

/** Qui peut agir sur une tâche : son responsable, son créateur, ou un profil qui peut réaffecter. */
export function canManageTask(user: CurrentUser, task: { assigneeUserId: string; createdByUserId: string }): boolean {
  return (
    can(user.role, "task:write") &&
    (task.assigneeUserId === user.id || task.createdByUserId === user.id || can(user.role, "account:assign"))
  );
}

// --- Lecture -----------------------------------------------------------------------------------------------------

/**
 * Liste des tâches d'une vue. `assigneeId` : un responsable précis, ou `null` pour toutes les tâches visibles.
 * Les compteurs portent sur le même périmètre, quelle que soit la vue affichée.
 */
export async function listTasks(
  user: CurrentUser,
  options: { view?: TaskView; assigneeId?: string | null; page?: number; pageSize?: number } = {},
  now: Date = new Date(),
): Promise<{ rows: TaskRow[]; total: number; page: number; pageSize: number; counts: TaskCounts }> {
  assertCan(user, "task:read");

  const view = options.view ?? "open";
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const today = todayUtc(now);

  const base: Prisma.TaskWhereInput[] = [taskScopeWhere(user)];
  if (options.assigneeId) base.push({ assigneeUserId: options.assigneeId });

  const viewWhere: Record<TaskView, Prisma.TaskWhereInput> = {
    open: { status: "open" },
    late: { status: "open", dueDate: { lt: today } },
    today: { status: "open", dueDate: today },
    done: { status: "done" },
  };

  const where: Prisma.TaskWhereInput = { AND: [...base, viewWhere[view]] };
  const [total, rows, open, late, dueToday] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      include: taskInclude,
      orderBy: view === "done" ? [{ completedAt: "desc" }] : [{ dueDate: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.task.count({ where: { AND: [...base, viewWhere.open] } }),
    db.task.count({ where: { AND: [...base, viewWhere.late] } }),
    db.task.count({ where: { AND: [...base, viewWhere.today] } }),
  ]);

  return { rows: rows.map((row) => toRow(row, now)), total, page, pageSize, counts: { open, late, today: dueToday } };
}

export async function getTask(user: CurrentUser, id: string, now: Date = new Date()): Promise<TaskRow> {
  assertCan(user, "task:read");
  const task = await db.task.findFirst({ where: { AND: [{ id }, taskScopeWhere(user)] }, include: taskInclude });
  if (!task) throw errors.notFound("Tâche introuvable.");
  return toRow(task, now);
}

// --- Écriture ----------------------------------------------------------------------------------------------------

async function resolveAssignee(tx: Prisma.TransactionClient, user: CurrentUser, requested: string | undefined, current: string) {
  if (!requested || requested === current) return current;
  if (!can(user.role, "account:assign")) {
    fail({ assigneeUserId: ["Vous ne pouvez pas confier une tâche à quelqu'un d'autre."] });
  }
  const assignee = await tx.user.findFirst({
    where: { id: requested, role: { not: "audit" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true },
  });
  if (!assignee) fail({ assigneeUserId: ["Le responsable doit être un utilisateur actif pouvant gérer des tâches."] });
  return assignee.id;
}

/** Résout les objets liés : l'opportunité impose son compte ; le contact doit être rattaché à ce compte. */
async function resolveLinks(tx: Prisma.TransactionClient, user: CurrentUser, input: { accountId?: string; contactId?: string; opportunityId?: string }) {
  let accountId = input.accountId;

  if (input.opportunityId) {
    const opportunity = await tx.opportunity.findFirst({
      where: { AND: [{ id: input.opportunityId }, opportunityScopeWhere(user)] },
      select: { id: true, accountId: true },
    });
    if (!opportunity) fail({ opportunityId: ["Opportunité introuvable ou hors de votre périmètre."] });
    if (accountId && accountId !== opportunity.accountId) fail({ opportunityId: ["Cette opportunité appartient à un autre compte."] });
    accountId = opportunity.accountId;
  }

  if (accountId) {
    const account = await tx.crmAccount.findFirst({
      where: { AND: [{ id: accountId, archivedAt: null }, accountScopeWhere(user)] },
      select: { id: true },
    });
    if (!account) fail({ accountId: ["Compte introuvable ou hors de votre périmètre."] }, "Compte invalide.");
  }

  if (input.contactId) {
    if (!accountId) fail({ contactId: ["Choisissez d'abord le compte du contact."] });
    const link = await tx.accountContact.findFirst({
      where: { accountId, contactId: input.contactId, contact: { archivedAt: null } },
      select: { id: true },
    });
    if (!link) fail({ contactId: ["Ce contact n'est pas rattaché à ce compte."] });
  }

  return { accountId: accountId ?? null, contactId: input.contactId ?? null, opportunityId: input.opportunityId ?? null };
}

export async function createTask(user: CurrentUser, input: CreateTaskInput, now: Date = new Date()): Promise<{ id: string }> {
  assertCan(user, "task:write");
  if (!isDueDateAllowed(input.dueDate, now)) fail({ dueDate: ["L'échéance ne peut pas être dans le passé."] });

  return db.$transaction(async (tx) => {
    const assigneeUserId = await resolveAssignee(tx, user, input.assigneeUserId, user.id);
    const links = await resolveLinks(tx, user, input);

    const task = await tx.task.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate,
        priority: input.priority,
        assigneeUserId,
        createdByUserId: user.id,
        ...links,
        origin: "user",
      },
    });
    await writeAudit(
      { actorUserId: user.id, action: "task.created", entityType: "task", entityId: task.id, metadata: { assigneeUserId } },
      tx,
    );
    return { id: task.id };
  });
}

export async function updateTask(user: CurrentUser, input: UpdateTaskInput, now: Date = new Date()): Promise<{ id: string }> {
  assertCan(user, "task:write");

  return db.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({ where: { AND: [{ id: input.id }, taskScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Tâche introuvable.");
    if (!canManageTask(user, existing)) throw errors.forbidden();
    if (existing.status !== "open") throw errors.validation("Seule une tâche à faire peut être modifiée : rouvrez-la d'abord.");
    if (existing.dueDate.getTime() !== input.dueDate.getTime() && !isDueDateAllowed(input.dueDate, now)) {
      fail({ dueDate: ["L'échéance ne peut pas être dans le passé."] });
    }

    const assigneeUserId = await resolveAssignee(tx, user, input.assigneeUserId, existing.assigneeUserId);

    // Les objets liés ne changent pas à la modification : une tâche reste attachée à son dossier d'origine.
    const updated = await tx.task.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate,
        priority: input.priority,
        assigneeUserId,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Cette tâche a été modifiée par quelqu'un d'autre. Rechargez la page.");

    const changedFields = [
      existing.title !== input.title && "title",
      existing.description !== (input.description ?? null) && "description",
      existing.dueDate.getTime() !== input.dueDate.getTime() && "dueDate",
      existing.priority !== input.priority && "priority",
      existing.assigneeUserId !== assigneeUserId && "assigneeUserId",
    ].filter((field): field is string => typeof field === "string");

    await writeAudit(
      { actorUserId: user.id, action: "task.updated", entityType: "task", entityId: existing.id, metadata: { changedFields } },
      tx,
    );
    if (existing.assigneeUserId !== assigneeUserId) {
      await writeAudit(
        {
          actorUserId: user.id,
          action: "task.reassigned",
          entityType: "task",
          entityId: existing.id,
          metadata: { fromAssigneeId: existing.assigneeUserId, toAssigneeId: assigneeUserId },
        },
        tx,
      );
      await notifyAssigned(tx, {
        actorUserId: user.id,
        toUserId: assigneeUserId,
        kind: "task",
        entityId: existing.id,
        name: input.title,
        href: "/taches",
      });
    }
    return { id: existing.id };
  });
}

const STATUS_AUDIT: Record<string, string> = { done: "task.completed", cancelled: "task.cancelled", open: "task.reopened" };

/** Terminer, annuler ou rouvrir une tâche. La date de réalisation est posée par le serveur. */
export async function setTaskStatus(user: CurrentUser, input: SetTaskStatusInput, now: Date = new Date()): Promise<{ id: string; status: string }> {
  assertCan(user, "task:write");

  return db.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({ where: { AND: [{ id: input.id }, taskScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Tâche introuvable.");
    if (!canManageTask(user, existing)) throw errors.forbidden();
    if (existing.status === input.status) throw errors.validation("La tâche est déjà dans cet état.");

    const updated = await tx.task.updateMany({
      where: { id: existing.id, version: input.version },
      data: { status: input.status, completedAt: input.status === "done" ? now : null, version: { increment: 1 } },
    });
    if (updated.count === 0) throw errors.conflict("Cette tâche a été modifiée par quelqu'un d'autre. Rechargez la page.");

    await writeAudit(
      {
        actorUserId: user.id,
        action: STATUS_AUDIT[input.status],
        entityType: "task",
        entityId: existing.id,
        metadata: { from: existing.status, to: input.status },
      },
      tx,
    );
    return { id: existing.id, status: input.status };
  });
}
