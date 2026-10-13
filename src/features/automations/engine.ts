import "server-only";
import {
  RULE_CODES,
  resolveParams,
  type RuleCode,
  type RuleParams,
} from "@/features/automations/config";
import {
  daysBetween,
  groupBy,
  inactiveDays,
  inactivityThresholdDays,
  periodKey,
  plural,
  shouldEscalate,
  summarizeNames,
} from "@/features/automations/rules";
import { createNotifications, type NewNotification } from "@/features/notifications/service";
import { todayUtc } from "@/features/tasks/rules";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { logger } from "@/lib/logger";

// Moteur des relances automatiques (CDC 6.2). Il ne fait que LIRE l'état du CRM et produire des tâches et des
// notifications ; il ne modifie jamais un compte, une opportunité ou une activité.
//
// Idempotence : chaque tâche porte une clé (règle + objet + période) et chaque notification une clé (destinataire +
// règle + période), toutes deux UNIQUES en base. Relancer le moteur dans la même période ne crée donc rien de plus,
// même si deux exécutions se chevauchent. Le moteur n'a pas besoin d'un ordonnanceur précis : il peut être appelé
// aussi souvent que voulu (cron, bouton « Exécuter maintenant »).

export type Stats = { evaluated: number; tasksCreated: number; notificationsCreated: number; skipped: number };

export type RunSummary = Stats & {
  ruleCode: RuleCode;
  status: "success" | "error" | "disabled";
  error?: string;
};

const DAY_MS = 86_400_000;
const NO_STATS: Stats = { evaluated: 0, tasksCreated: 0, notificationsCreated: 0, skipped: 0 };

/** Un utilisateur désactivé ne reçoit ni tâche ni notification. */
const notBanned = { OR: [{ banned: false }, { banned: null }] } satisfies Prisma.UserWhereInput;

async function activeUserIds(ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const users = await db.user.findMany({ where: { id: { in: unique }, ...notBanned }, select: { id: true } });
  return new Set(users.map((user) => user.id));
}

/** Manager de l'équipe de chaque utilisateur (absent si l'utilisateur n'a pas d'équipe ou d'équipe sans manager). */
async function managersOf(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, team: { select: { managerUserId: true } } } });
  const map = new Map<string, string>();
  for (const user of users) if (user.team?.managerUserId) map.set(user.id, user.team.managerUserId);
  return map;
}

type Item = { ownerId: string; name: string; days: number; id: string };

/**
 * Notifications d'escalade : les éléments dont le retard atteint le délai sont regroupés par manager. Le manager
 * d'un utilisateur n'est jamais prévenu de ses propres retards, ni s'il est désactivé.
 */
async function escalations(
  items: Item[],
  escalationDays: number,
  make: (managerId: string, list: Item[]) => NewNotification,
): Promise<NewNotification[]> {
  const late = items.filter((item) => shouldEscalate(item.days, escalationDays));
  if (late.length === 0) return [];
  const managers = await managersOf(late.map((item) => item.ownerId));
  const withManager = late.flatMap((item) => {
    const managerId = managers.get(item.ownerId);
    return managerId && managerId !== item.ownerId ? [{ ...item, managerId }] : [];
  });
  const active = await activeUserIds(withManager.map((item) => item.managerId));
  const reachable = withManager.filter((item) => active.has(item.managerId));
  return [...groupBy(reachable, (item) => item.managerId)].map(([managerId, list]) => make(managerId, list));
}

async function deliver(notifications: NewNotification[], evaluated: number, tasksCreated = 0, tasksExpected = 0): Promise<Stats> {
  const created = await createNotifications(notifications);
  return {
    evaluated,
    tasksCreated,
    notificationsCreated: created,
    // Ce qui existait déjà pour la période : tâches et notifications non recréées.
    skipped: tasksExpected - tasksCreated + (notifications.length - created),
  };
}

// --- Règles ------------------------------------------------------------------------------------------------------

async function inactivity(p: RuleParams, now: Date): Promise<Stats> {
  const period = periodKey(now, p.frequencyDays);
  const segments = {
    largeAccountMinEmployees: p.largeAccountMinEmployees,
    largeDays: p.largeDays,
    standardDays: p.standardDays,
  };

  const accounts = await db.crmAccount.findMany({
    where: { archivedAt: null, status: { in: ["client", "prospect"] }, owner: notBanned },
    select: { id: true, legalName: true, employeeCount: true, createdAt: true, ownerUserId: true },
  });
  // Dernière activité PASSÉE de chaque compte : un rendez-vous planifié dans le futur ne compte pas comme un échange.
  const lasts = await db.activity.groupBy({ by: ["accountId"], where: { occurredAt: { lte: now } }, _max: { occurredAt: true } });
  const lastByAccount = new Map(lasts.map((row) => [row.accountId, row._max.occurredAt]));

  const inactive = accounts.flatMap((account) => {
    const days = inactiveDays(
      lastByAccount.get(account.id) ?? null,
      account.createdAt,
      now,
      inactivityThresholdDays(account.employeeCount, segments),
    );
    return days === null ? [] : [{ account, days }];
  });

  const dueDate = new Date(todayUtc(now).getTime() + p.dueInDays * DAY_MS);
  const tasks = await db.task.createMany({
    data: inactive.map(({ account, days }) => ({
      title: `Relancer ${account.legalName}`,
      description: `Aucune activité depuis ${days} jours : reprenez contact avec le client.`,
      dueDate,
      priority: "normal",
      assigneeUserId: account.ownerUserId,
      // Pas d'utilisateur « système » : la tâche est créée au nom de son responsable, l'origine la distingue.
      createdByUserId: account.ownerUserId,
      accountId: account.id,
      origin: "automation",
      automationKey: `inactivity:${account.id}:${period}`,
    })),
    skipDuplicates: true,
  });

  const notifications: NewNotification[] = [...groupBy(inactive, (item) => item.account.ownerUserId)].map(([userId, list]) => ({
    userId,
    source: "inactivity",
    title: `${plural(list.length, "compte")} sans activité récente`,
    body: `Tâche de relance créée : ${summarizeNames(list.map((item) => item.account.legalName))}.`,
    href: "/taches",
    itemCount: list.length,
    dedupeKey: `inactivity:${period}`,
  }));

  return deliver(notifications, inactive.length, tasks.count, inactive.length);
}

async function noNextAction(p: RuleParams, now: Date): Promise<Stats> {
  const period = periodKey(now, p.frequencyDays);
  const opportunities = await db.opportunity.findMany({
    where: { status: "open", nextActionDate: { lt: todayUtc(now) }, owner: notBanned },
    select: { id: true, name: true, ownerUserId: true },
  });

  const notifications: NewNotification[] = [...groupBy(opportunities, (o) => o.ownerUserId)].map(([userId, list]) => ({
    userId,
    source: "no_next_action",
    title: `${plural(list.length, "opportunité")} sans prochaine action à venir`,
    body: `Planifiez la suite : ${summarizeNames(list.map((o) => o.name))}.`,
    href: list.length === 1 ? `/opportunites/${list[0].id}` : "/opportunites",
    itemCount: list.length,
    dedupeKey: `no_next_action:${period}`,
  }));
  return deliver(notifications, opportunities.length);
}

async function closeDateOverdue(p: RuleParams, now: Date): Promise<Stats> {
  const period = periodKey(now, p.frequencyDays);
  const opportunities = await db.opportunity.findMany({
    where: { status: "open", expectedCloseDate: { lt: todayUtc(now) }, owner: notBanned },
    select: { id: true, name: true, ownerUserId: true, expectedCloseDate: true },
  });

  const notifications: NewNotification[] = [...groupBy(opportunities, (o) => o.ownerUserId)].map(([userId, list]) => ({
    userId,
    source: "close_date_overdue",
    title: `${plural(list.length, "opportunité")} dont la clôture prévue est dépassée`,
    body: `Mettez à jour la date ou l'étape : ${summarizeNames(list.map((o) => o.name))}.`,
    href: list.length === 1 ? `/opportunites/${list[0].id}` : "/opportunites",
    itemCount: list.length,
    dedupeKey: `close_date_overdue:${period}`,
  }));

  const items: Item[] = opportunities.map((o) => ({
    id: o.id,
    ownerId: o.ownerUserId,
    name: o.name,
    days: daysBetween(o.expectedCloseDate as Date, now),
  }));
  notifications.push(
    ...(await escalations(items, p.escalationDays, (managerId, list) => ({
      userId: managerId,
      source: "close_date_overdue",
      title: `${plural(list.length, "opportunité")} de votre équipe en retard de clôture`,
      body: `Retard d'au moins ${p.escalationDays} jours : ${summarizeNames(list.map((item) => item.name))}.`,
      href: "/opportunites",
      itemCount: list.length,
      dedupeKey: `close_date_overdue:escalation:${period}`,
    }))),
  );
  return deliver(notifications, opportunities.length);
}

async function meetingSoon(p: RuleParams, now: Date): Promise<Stats> {
  const until = new Date(now.getTime() + p.hoursBefore * 3_600_000);
  const meetings = await db.activity.findMany({
    where: { type: { in: ["meeting", "video"] }, occurredAt: { gt: now, lte: until }, author: notBanned },
    select: { id: true, subject: true, occurredAt: true, authorUserId: true, accountId: true, opportunityId: true, account: { select: { legalName: true } } },
  });

  // Un rappel par rendez-vous : la clé est l'activité elle-même, donc jamais deux rappels pour le même rendez-vous.
  const notifications: NewNotification[] = meetings.map((meeting) => ({
    userId: meeting.authorUserId,
    source: "meeting_soon",
    title: `Rendez-vous imminent : ${meeting.subject}`,
    body: `${formatDateTime(meeting.occurredAt)} — ${meeting.account.legalName}`,
    href: meeting.opportunityId ? `/opportunites/${meeting.opportunityId}` : `/comptes/${meeting.accountId}`,
    dedupeKey: `meeting_soon:${meeting.id}`,
  }));
  return deliver(notifications, meetings.length);
}

async function taskOverdue(p: RuleParams, now: Date): Promise<Stats> {
  const period = periodKey(now, p.frequencyDays);
  const tasks = await db.task.findMany({
    where: { status: "open", dueDate: { lt: todayUtc(now) }, assignee: notBanned },
    select: { id: true, title: true, dueDate: true, assigneeUserId: true },
  });

  const notifications: NewNotification[] = [...groupBy(tasks, (t) => t.assigneeUserId)].map(([userId, list]) => ({
    userId,
    source: "task_overdue",
    title: `${plural(list.length, "tâche")} en retard`,
    body: summarizeNames(list.map((t) => t.title)),
    href: "/taches?vue=late",
    itemCount: list.length,
    dedupeKey: `task_overdue:${period}`,
  }));

  const items: Item[] = tasks.map((t) => ({ id: t.id, ownerId: t.assigneeUserId, name: t.title, days: daysBetween(t.dueDate, now) }));
  notifications.push(
    ...(await escalations(items, p.escalationDays, (managerId, list) => ({
      userId: managerId,
      source: "task_overdue",
      title: `${plural(list.length, "tâche")} en retard dans votre équipe`,
      body: `Retard d'au moins ${p.escalationDays} jours : ${summarizeNames(list.map((item) => item.name))}.`,
      href: "/taches?vue=late&responsable=tous",
      itemCount: list.length,
      dedupeKey: `task_overdue:escalation:${period}`,
    }))),
  );
  return deliver(notifications, tasks.length);
}

const EVALUATORS: Record<RuleCode, (params: RuleParams, now: Date) => Promise<Stats>> = {
  inactivity,
  no_next_action: noNextAction,
  close_date_overdue: closeDateOverdue,
  meeting_soon: meetingSoon,
  task_overdue: taskOverdue,
};

// --- Exécution ---------------------------------------------------------------------------------------------------

/**
 * Exécute les règles activées. Chaque passage est consigné dans `automation_runs` (journal d'exécution, CDC 6.2).
 * Une règle en erreur est journalisée et n'empêche pas les suivantes. `now` est injectable pour les tests.
 */
export async function runAutomations(options: {
  trigger: "manual" | "schedule";
  actorUserId?: string | null;
  now?: Date;
  only?: RuleCode[];
}): Promise<RunSummary[]> {
  const now = options.now ?? new Date();
  const rules = await db.automationRule.findMany();
  const summaries: RunSummary[] = [];

  for (const code of RULE_CODES) {
    if (options.only && !options.only.includes(code)) continue;
    const rule = rules.find((candidate) => candidate.code === code);
    if (!rule?.enabled) {
      summaries.push({ ruleCode: code, status: "disabled", ...NO_STATS });
      continue;
    }

    const run = await db.automationRun.create({
      data: { ruleCode: code, trigger: options.trigger, startedByUserId: options.actorUserId ?? null },
    });
    try {
      const stats = await EVALUATORS[code](resolveParams(code, rule.params), now);
      await db.automationRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date(), ...stats } });
      summaries.push({ ruleCode: code, status: "success", ...stats });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      logger.error({ err: error, ruleCode: code }, "Échec d'une règle d'automatisation");
      await db.automationRun.update({
        where: { id: run.id },
        data: { status: "error", finishedAt: new Date(), error: message.slice(0, 500) },
      });
      summaries.push({ ruleCode: code, status: "error", error: message.slice(0, 500), ...NO_STATS });
    }
  }

  await writeAudit({
    actorUserId: options.actorUserId ?? null,
    action: "automation.run",
    entityType: "automation",
    metadata: {
      trigger: options.trigger,
      rules: summaries.map((s) => ({ code: s.ruleCode, status: s.status, tasks: s.tasksCreated, notifications: s.notificationsCreated })),
    },
  });
  return summaries;
}
