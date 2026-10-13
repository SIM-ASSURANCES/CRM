import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Centre de notifications (CDC 6.3). Chacun ne lit et ne modifie QUE les siennes : le destinataire est toujours
// l'utilisateur de la session, jamais une valeur envoyée par le navigateur.

export type NewNotification = {
  userId: string;
  /** Règle d'origine (« task_overdue »…) ou événement (« owner_changed »). */
  source: string;
  title: string;
  body?: string;
  /** Chemin interne vers le dossier concerné (accès direct, CDC 6.3). */
  href: string;
  itemCount?: number;
  /**
   * Politique anti-spam : une seule notification par destinataire et par clé. Une alerte similaire dans la même
   * période réutilise la même clé et n'est donc pas répétée.
   */
  dedupeKey: string;
};

export type NotificationRow = {
  id: string;
  source: string;
  title: string;
  body: string | null;
  href: string;
  itemCount: number;
  read: boolean;
  createdAt: Date;
};

type NotificationClient = Pick<PrismaClient, "notification">;

/**
 * Crée les notifications absentes et ignore celles dont la clé existe déjà (`ON CONFLICT DO NOTHING`) : sans erreur,
 * donc utilisable à l'intérieur d'une transaction. Retourne le nombre réellement créé.
 */
export async function createNotifications(items: NewNotification[], client: NotificationClient = db): Promise<number> {
  if (items.length === 0) return 0;
  const result = await client.notification.createMany({
    data: items.map((item) => ({
      userId: item.userId,
      source: item.source,
      title: item.title,
      body: item.body ?? null,
      href: item.href,
      itemCount: item.itemCount ?? 1,
      dedupeKey: item.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Prévient la personne à qui un dossier est confié (CDC 6.3 : « changements de propriétaire »). Rien n'est envoyé
 * quand on se l'attribue soi-même. À appeler dans la transaction du changement : la notification est validée ou
 * annulée avec lui. La clé est unique par changement : deux réaffectations successives restent deux notifications.
 */
export async function notifyAssigned(
  client: NotificationClient,
  input: { actorUserId: string; toUserId: string; kind: "account" | "opportunity" | "task"; entityId: string; name: string; href: string },
): Promise<void> {
  if (input.toUserId === input.actorUserId) return;
  const titles = {
    account: "Un compte vous a été confié",
    opportunity: "Une opportunité vous a été confiée",
    task: "Une tâche vous a été confiée",
  } as const;
  await createNotifications(
    [
      {
        userId: input.toUserId,
        source: "owner_changed",
        title: titles[input.kind],
        body: input.name,
        href: input.href,
        dedupeKey: `owner_changed:${input.kind}:${input.entityId}:${Date.now()}`,
      },
    ],
    client,
  );
}

export async function countUnread(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(
  user: CurrentUser,
  options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
): Promise<{ rows: NotificationRow[]; total: number; unread: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const where = { userId: user.id, ...(options.unreadOnly ? { readAt: null } : {}) };

  const [total, unread, rows] = await Promise.all([
    db.notification.count({ where }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      body: row.body,
      href: row.href,
      itemCount: row.itemCount,
      read: row.readAt !== null,
      createdAt: row.createdAt,
    })),
    total,
    unread,
    page,
    pageSize,
  };
}

/** Marque UNE notification comme lue. Une notification d'un autre utilisateur n'est jamais touchée (0 ligne). */
export async function markRead(user: CurrentUser, id: string, now: Date = new Date()): Promise<boolean> {
  const result = await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: now } });
  return result.count > 0;
}

/**
 * Ouvre une notification : la marque comme lue et renvoie le chemin du dossier concerné (accès direct, CDC 6.3).
 * `null` si elle n'existe pas ou n'appartient pas à l'utilisateur.
 */
export async function openNotification(user: CurrentUser, id: string, now: Date = new Date()): Promise<string | null> {
  const notification = await db.notification.findFirst({ where: { id, userId: user.id }, select: { href: true } });
  if (!notification) return null;
  await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: now } });
  return safeNotificationHref(notification.href);
}

export async function markAllRead(user: CurrentUser, now: Date = new Date()): Promise<number> {
  const result = await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: now } });
  return result.count;
}

/** Chemin interne sûr pour un lien de notification : un lien externe ou mal formé est remplacé par le centre. */
export function safeNotificationHref(href: string): string {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("\\") ? href : "/notifications";
}
