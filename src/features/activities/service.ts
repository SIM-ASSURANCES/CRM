import "server-only";
import { accountScopeWhere } from "@/features/accounts/scope";
import { FEED_LIMIT } from "@/features/activities/config";
import type { CreateActivityInput, FeedFilters, UpdateActivityInput } from "@/features/activities/schemas";
import { safeWebLink } from "@/features/integrations/rules";
import { opportunityScopeWhere } from "@/features/opportunities/scope";
import { isTaskOverdue } from "@/features/tasks/rules";
import { taskScopeWhere } from "@/features/tasks/scope";
import { canManageTask } from "@/features/tasks/service";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { FieldErrors } from "@/lib/forms";

// Service des activités et du fil unifié (CDC 3.4 et 6.1). Toute opération vérifie la permission, applique le périmètre
// (une activité n'est visible que par ceux qui voient son compte) et écrit la donnée et l'audit dans la MÊME transaction.

export type FeedItem = {
  /** Clé stable pour l'affichage : « activity:<id> », « task:<id> » ou « stage:<id> ». */
  key: string;
  kind: "activity" | "task" | "stage";
  entityId: string;
  /** Code du type (type d'activité, « task » ou « stage »). */
  type: string;
  title: string;
  occurredAt: Date;
  authorName: string | null;
  origin: string;
  accountId: string | null;
  accountName: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  detail: string | null;
  nextAction: string | null;
  nextActionDate: Date | null;
  /** Lien vers l'élément d'origine (message Outlook), déjà validé (https seulement) ; absent pour les saisies manuelles. */
  externalUrl?: string | null;
  /** Statut de la tâche (open, done, cancelled) ; absent pour les autres événements. */
  status?: string;
  overdue?: boolean;
  /** L'utilisateur courant peut-il corriger cet événement ? Décidé ici, côté serveur (permission + auteur + origine). */
  editable: boolean;
};

export type Feed = { items: FeedItem[]; truncated: boolean };

export type ActivityDetail = {
  id: string;
  type: string;
  subject: string;
  occurredAt: Date;
  accountId: string;
  accountName: string;
  contactId: string | null;
  opportunityId: string | null;
  outcome: string | null;
  nextAction: string | null;
  nextActionDate: Date | null;
  authorUserId: string;
  authorName: string;
  origin: string;
  version: number;
};

export type LinkOptions = {
  account: { id: string; name: string };
  contacts: { id: string; label: string }[];
  opportunities: { id: string; label: string }[];
};

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

function fail(fieldErrors: FieldErrors, message = "Certaines informations sont manquantes."): never {
  throw errors.validation(message, { fieldErrors });
}

/** Fin de journée d'une date « jour » : pour inclure le dernier jour d'une période dans un filtre. */
const endOfDay = (day: Date) => new Date(day.getTime() + 86_400_000 - 1);

// --- Liens (compte, contact, opportunité) ------------------------------------------------------------------------

async function assertAccountUsable(tx: Prisma.TransactionClient, user: CurrentUser, accountId: string) {
  const account = await tx.crmAccount.findFirst({
    where: { AND: [{ id: accountId, archivedAt: null }, accountScopeWhere(user)] },
    select: { id: true, legalName: true },
  });
  if (!account) fail({ accountId: ["Compte introuvable ou hors de votre périmètre."] }, "Compte invalide.");
  return account;
}

/** Le contact doit être rattaché au compte : on ne journalise pas un échange avec un contact étranger au dossier. */
async function assertContactOfAccount(tx: Prisma.TransactionClient, accountId: string, contactId?: string) {
  if (!contactId) return;
  const link = await tx.accountContact.findFirst({ where: { accountId, contactId, contact: { archivedAt: null } }, select: { id: true } });
  if (!link) fail({ contactId: ["Ce contact n'est pas rattaché à ce compte."] });
}

async function resolveOpportunity(tx: Prisma.TransactionClient, user: CurrentUser, accountId: string, opportunityId?: string) {
  if (!opportunityId) return null;
  const opportunity = await tx.opportunity.findFirst({
    where: { AND: [{ id: opportunityId }, opportunityScopeWhere(user)] },
    select: { id: true, accountId: true, status: true, nextAction: true, nextActionDate: true, version: true },
  });
  if (!opportunity) fail({ opportunityId: ["Opportunité introuvable ou hors de votre périmètre."] });
  if (opportunity.accountId !== accountId) fail({ opportunityId: ["Cette opportunité appartient à un autre compte."] });
  return opportunity;
}

/** Listes de choix d'un formulaire d'activité ou de tâche, pour UN compte visible. */
export async function getLinkOptions(user: CurrentUser, accountId: string): Promise<LinkOptions> {
  assertCan(user, "activity:read");
  const account = await db.crmAccount.findFirst({
    where: { AND: [{ id: accountId, archivedAt: null }, accountScopeWhere(user)] },
    select: { id: true, legalName: true },
  });
  if (!account) throw errors.notFound("Compte introuvable.");

  const [links, opportunities] = await Promise.all([
    db.accountContact.findMany({
      where: { accountId, contact: { archivedAt: null } },
      include: { contact: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      take: 300,
    }),
    db.opportunity.findMany({
      where: { AND: [{ accountId }, opportunityScopeWhere(user)] },
      select: { id: true, name: true, status: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]);

  const statusSuffix: Record<string, string> = { won: " (gagnée)", lost: " (perdue)" };
  return {
    account: { id: account.id, name: account.legalName },
    contacts: links.map((l) => ({
      id: l.contact.id,
      label: `${l.contact.firstName} ${l.contact.lastName}${l.contact.jobTitle ? ` — ${l.contact.jobTitle}` : ""}`,
    })),
    opportunities: opportunities.map((o) => ({ id: o.id, label: `${o.name}${statusSuffix[o.status] ?? ""}` })),
  };
}

// --- Écriture ----------------------------------------------------------------------------------------------------

export async function createActivity(user: CurrentUser, input: CreateActivityInput): Promise<{ id: string }> {
  assertCan(user, "activity:write");

  return db.$transaction(async (tx) => {
    const account = await assertAccountUsable(tx, user, input.accountId);
    await assertContactOfAccount(tx, account.id, input.contactId);
    const opportunity = await resolveOpportunity(tx, user, account.id, input.opportunityId);

    const activity = await tx.activity.create({
      data: {
        type: input.type,
        subject: input.subject,
        occurredAt: input.occurredAt,
        authorUserId: user.id,
        accountId: account.id,
        contactId: input.contactId ?? null,
        opportunityId: opportunity?.id ?? null,
        outcome: input.outcome ?? null,
        nextAction: input.nextAction ?? null,
        nextActionDate: input.nextActionDate ?? null,
        origin: "user",
      },
    });
    await writeAudit(
      { actorUserId: user.id, action: "activity.created", entityType: "activity", entityId: activity.id, metadata: { type: input.type } },
      tx,
    );

    // La prochaine action d'une activité devient celle de l'opportunité encore ouverte (CDC 13.2 : « une prochaine
    // action est planifiée ») : la date alimente directement les alertes de retard et d'inactivité.
    if (opportunity && opportunity.status === "open" && input.nextAction && input.nextActionDate) {
      await tx.opportunity.update({
        where: { id: opportunity.id },
        data: { nextAction: input.nextAction, nextActionDate: input.nextActionDate, version: { increment: 1 } },
      });
      await writeAudit(
        {
          actorUserId: user.id,
          action: "opportunity.updated",
          entityType: "opportunity",
          entityId: opportunity.id,
          metadata: { changedFields: ["nextAction", "nextActionDate"], viaActivityId: activity.id },
        },
        tx,
      );
    }
    return { id: activity.id };
  });
}

export async function getActivity(user: CurrentUser, id: string): Promise<ActivityDetail> {
  assertCan(user, "activity:read");
  const activity = await db.activity.findFirst({
    where: { AND: [{ id }, { account: accountScopeWhere(user) }] },
    include: { account: { select: { legalName: true } }, author: { select: { name: true } } },
  });
  if (!activity) throw errors.notFound("Activité introuvable.");
  return {
    id: activity.id,
    type: activity.type,
    subject: activity.subject,
    occurredAt: activity.occurredAt,
    accountId: activity.accountId,
    accountName: activity.account.legalName,
    contactId: activity.contactId,
    opportunityId: activity.opportunityId,
    outcome: activity.outcome,
    nextAction: activity.nextAction,
    nextActionDate: activity.nextActionDate,
    authorUserId: activity.authorUserId,
    authorName: activity.author.name,
    origin: activity.origin,
    version: activity.version,
  };
}

/** Qui peut corriger une activité : son auteur, ou un profil qui peut réaffecter (manager, direction, administrateur). */
function canEditActivity(user: CurrentUser, authorUserId: string): boolean {
  return authorUserId === user.id || can(user.role, "account:assign");
}

export function canEditActivityOf(user: CurrentUser, activity: { authorUserId: string; origin: string }): boolean {
  // Une activité synchronisée ou automatique reflète sa source : on ne la réécrit pas à la main.
  return can(user.role, "activity:write") && activity.origin === "user" && canEditActivity(user, activity.authorUserId);
}

export async function updateActivity(user: CurrentUser, input: UpdateActivityInput): Promise<{ id: string }> {
  assertCan(user, "activity:write");

  return db.$transaction(async (tx) => {
    const existing = await tx.activity.findFirst({ where: { AND: [{ id: input.id }, { account: accountScopeWhere(user) }] } });
    if (!existing) throw errors.notFound("Activité introuvable.");
    if (existing.origin !== "user") throw errors.validation("Une activité synchronisée ou automatique ne se modifie pas.");
    if (!canEditActivity(user, existing.authorUserId)) throw errors.forbidden();
    if (input.accountId !== existing.accountId) fail({ accountId: ["Le compte d'une activité ne peut pas être modifié."] });

    await assertContactOfAccount(tx, existing.accountId, input.contactId);
    const opportunity = await resolveOpportunity(tx, user, existing.accountId, input.opportunityId);

    // Concurrence optimiste : si quelqu'un a modifié l'activité entre-temps, la version ne correspond plus (409).
    const updated = await tx.activity.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        type: input.type,
        subject: input.subject,
        occurredAt: input.occurredAt,
        contactId: input.contactId ?? null,
        opportunityId: opportunity?.id ?? null,
        outcome: input.outcome ?? null,
        nextAction: input.nextAction ?? null,
        nextActionDate: input.nextActionDate ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Cette activité a été modifiée par quelqu'un d'autre. Rechargez la page.");

    const changedFields = [
      existing.type !== input.type && "type",
      existing.subject !== input.subject && "subject",
      existing.occurredAt.getTime() !== input.occurredAt.getTime() && "occurredAt",
      existing.contactId !== (input.contactId ?? null) && "contactId",
      existing.opportunityId !== (opportunity?.id ?? null) && "opportunityId",
      existing.outcome !== (input.outcome ?? null) && "outcome",
      existing.nextAction !== (input.nextAction ?? null) && "nextAction",
      existing.nextActionDate?.getTime() !== input.nextActionDate?.getTime() && "nextActionDate",
    ].filter((field): field is string => typeof field === "string");

    await writeAudit(
      { actorUserId: user.id, action: "activity.updated", entityType: "activity", entityId: existing.id, metadata: { changedFields } },
      tx,
    );
    return { id: existing.id };
  });
}

// --- Fil unifié (CDC 3.4) ----------------------------------------------------------------------------------------

const STAGE_EVENT_TYPES = ["stage_changed", "won", "lost"];

/**
 * Fil chronologique : activités, tâches et changements d'étape des opportunités, du plus récent au plus ancien, avec
 * l'origine de chaque événement. Filtrable par type, période, contact, opportunité, compte et auteur.
 * Chaque source applique son propre périmètre : le fil ne révèle jamais un objet que l'utilisateur ne voit pas.
 */
export async function listFeed(user: CurrentUser, filters: FeedFilters = {}, now: Date = new Date()): Promise<Feed> {
  assertCan(user, "activity:read");

  const { accountId, opportunityId, contactId, authorId, type, from, to } = filters;
  const range = (field: "occurredAt" | "dueDate") =>
    from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: endOfDay(to) } : {}) } } : {};

  const wantActivities = !type || (type !== "task" && type !== "stage");
  const wantTasks = !type || type === "task";
  const wantStages = (!type || type === "stage") && !contactId;

  const [activities, tasks, events] = await Promise.all([
    wantActivities
      ? db.activity.findMany({
          where: {
            AND: [
              { account: accountScopeWhere(user) },
              {
                ...(accountId ? { accountId } : {}),
                ...(opportunityId ? { opportunityId } : {}),
                ...(contactId ? { contactId } : {}),
                ...(authorId ? { authorUserId: authorId } : {}),
                ...(type ? { type } : {}),
                ...range("occurredAt"),
              },
            ],
          },
          include: {
            author: { select: { name: true } },
            account: { select: { legalName: true } },
            contact: { select: { firstName: true, lastName: true } },
            opportunity: { select: { name: true } },
          },
          orderBy: { occurredAt: "desc" },
          take: FEED_LIMIT,
        })
      : [],
    wantTasks
      ? db.task.findMany({
          where: {
            AND: [
              taskScopeWhere(user),
              {
                ...(accountId ? { accountId } : {}),
                ...(opportunityId ? { opportunityId } : {}),
                ...(contactId ? { contactId } : {}),
                ...(authorId ? { assigneeUserId: authorId } : {}),
                ...range("dueDate"),
              },
            ],
          },
          include: {
            assignee: { select: { name: true } },
            account: { select: { legalName: true } },
            contact: { select: { firstName: true, lastName: true } },
            opportunity: { select: { name: true } },
          },
          orderBy: { dueDate: "desc" },
          take: FEED_LIMIT,
        })
      : [],
    wantStages
      ? db.opportunityEvent.findMany({
          where: {
            AND: [
              { type: { in: STAGE_EVENT_TYPES } },
              { opportunity: { AND: [opportunityScopeWhere(user), { account: accountScopeWhere(user) }] } },
              {
                ...(accountId ? { opportunity: { accountId } } : {}),
                ...(opportunityId ? { opportunityId } : {}),
                ...(authorId ? { actorUserId: authorId } : {}),
                ...range("occurredAt"),
              },
            ],
          },
          include: {
            actor: { select: { name: true } },
            opportunity: { select: { id: true, name: true, accountId: true, account: { select: { legalName: true } } } },
          },
          orderBy: { occurredAt: "desc" },
          take: FEED_LIMIT,
        })
      : [],
  ]);

  const fullName = (contact: { firstName: string; lastName: string } | null) => (contact ? `${contact.firstName} ${contact.lastName}` : null);

  const items: FeedItem[] = [
    ...activities.map(
      (a): FeedItem => ({
        key: `activity:${a.id}`,
        kind: "activity",
        entityId: a.id,
        type: a.type,
        title: a.subject,
        occurredAt: a.occurredAt,
        authorName: a.author.name,
        origin: a.origin,
        accountId: a.accountId,
        accountName: a.account.legalName,
        contactName: fullName(a.contact),
        opportunityId: a.opportunityId,
        opportunityName: a.opportunity?.name ?? null,
        detail: a.outcome,
        nextAction: a.nextAction,
        nextActionDate: a.nextActionDate,
        // Revalidé à la lecture : la base peut contenir une valeur antérieure ou altérée.
        externalUrl: safeWebLink(a.externalUrl),
        editable: canEditActivityOf(user, a),
      }),
    ),
    ...tasks.map(
      (t): FeedItem => ({
        key: `task:${t.id}`,
        kind: "task",
        entityId: t.id,
        type: "task",
        title: t.title,
        // Une tâche terminée figure à la date de sa réalisation ; sinon à son échéance.
        occurredAt: t.completedAt ?? t.dueDate,
        authorName: t.assignee.name,
        origin: t.origin,
        accountId: t.accountId,
        accountName: t.account?.legalName ?? null,
        contactName: fullName(t.contact),
        opportunityId: t.opportunityId,
        opportunityName: t.opportunity?.name ?? null,
        detail: t.description,
        nextAction: null,
        nextActionDate: null,
        status: t.status,
        overdue: isTaskOverdue(t.dueDate, t.status, now),
        editable: t.status === "open" && canManageTask(user, t),
      }),
    ),
    ...events.map(
      (e): FeedItem => ({
        key: `stage:${e.id}`,
        kind: "stage",
        entityId: e.id,
        type: "stage",
        title:
          e.type === "won"
            ? "Opportunité gagnée"
            : e.type === "lost"
              ? "Opportunité perdue"
              : `Étape : ${e.fromStage ?? "—"} % → ${e.toStage} %`,
        occurredAt: e.occurredAt,
        authorName: e.actor?.name ?? null,
        origin: "user",
        accountId: e.opportunity.accountId,
        accountName: e.opportunity.account.legalName,
        contactName: null,
        opportunityId: e.opportunity.id,
        opportunityName: e.opportunity.name,
        detail: null,
        nextAction: null,
        nextActionDate: null,
        editable: false,
      }),
    ),
  ].sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime());

  const truncated = items.length > FEED_LIMIT || [activities, tasks, events].some((source) => source.length === FEED_LIMIT);
  return { items: items.slice(0, FEED_LIMIT), truncated };
}
