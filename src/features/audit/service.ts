import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import { optional } from "@/lib/forms";

// Consultation et export du journal d'audit (CDC 2.1, 8.3 et 14). Le journal est en ajout seul (trigger PostgreSQL) :
// cet écran ne permet que de LIRE. Lecture réservée à `audit:read`, export à `audit:export`, et chaque export est
// lui-même journalisé.

const dateOnly = (label: string) =>
  z.iso.date({ error: `${label} invalide.` }).transform((value) => new Date(`${value}T00:00:00.000Z`));

/**
 * Filtres du journal. « action » : une action exacte (« account.merged ») ou toute une famille (« account.* »).
 * « actorId » : un utilisateur, ou « system » pour les actions automatiques (jobs, automatisations).
 */
export const auditFiltersSchema = z.object({
  action: optional(z.string().trim().max(100).regex(/^[a-z_]+(\.([a-z_]+|\*))?$/, "Action invalide.")),
  entityType: optional(z.string().trim().max(50).regex(/^[a-z_]+$/, "Objet invalide.")),
  actorId: optional(z.union([z.uuid(), z.literal("system")])),
  from: optional(dateOnly("Début")),
  to: optional(dateOnly("Fin")),
});
export type AuditFilters = z.output<typeof auditFiltersSchema>;

export type AuditRow = {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string;
  actorEmail: string | null;
  ipAddress: string | null;
  metadata: Prisma.JsonValue | null;
};

export const EXPORT_LIMIT = 5000;

function assertRead(user: CurrentUser): void {
  if (!can(user.role, "audit:read")) throw errors.forbidden();
}

function whereOf(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) {
    where.action = filters.action.endsWith(".*") ? { startsWith: `${filters.action.slice(0, -2)}.` } : filters.action;
  }
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.actorId) where.actorUserId = filters.actorId === "system" ? null : filters.actorId;
  if (filters.from || filters.to) {
    where.occurredAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      // La date de fin inclut toute la journée.
      ...(filters.to ? { lte: new Date(filters.to.getTime() + 86_400_000 - 1) } : {}),
    };
  }
  return where;
}

const rowInclude = { actor: { select: { name: true, email: true } } } satisfies Prisma.AuditLogInclude;

function toRow(log: Prisma.AuditLogGetPayload<{ include: typeof rowInclude }>): AuditRow {
  return {
    id: log.id,
    occurredAt: log.occurredAt,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorName: log.actor?.name ?? "Système",
    actorEmail: log.actor?.email ?? null,
    ipAddress: log.ipAddress,
    metadata: log.metadata,
  };
}

export async function listAuditLogs(
  user: CurrentUser,
  filters: AuditFilters = {},
  options: { page?: number; pageSize?: number } = {},
): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: number }> {
  assertRead(user);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const where = whereOf(filters);

  const [total, logs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      include: rowInclude,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { rows: logs.map(toRow), total, page, pageSize };
}

/** Valeurs proposées par les filtres : actions et objets déjà journalisés, auteurs ayant laissé des traces. */
export async function auditFacets(user: CurrentUser): Promise<{
  actions: string[];
  entityTypes: string[];
  actors: { id: string; name: string }[];
}> {
  assertRead(user);
  const [actions, entityTypes, actors] = await Promise.all([
    db.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
    db.auditLog.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } }),
    db.user.findMany({ where: { auditLogs: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { actions: actions.map((entry) => entry.action), entityTypes: entityTypes.map((entry) => entry.entityType), actors };
}

/**
 * Export CSV du journal filtré (CDC 8.3 : « journaliser les exports », « limiter les exports de masse »). Plafonné à
 * EXPORT_LIMIT lignes, les plus récentes. L'export lui-même est tracé, avec les filtres appliqués.
 */
export async function exportAuditLogs(
  user: CurrentUser,
  filters: AuditFilters = {},
  options: { now?: Date; limit?: number } = {},
): Promise<{ filename: string; csv: string; rows: number; truncated: boolean }> {
  if (!can(user.role, "audit:export")) throw errors.forbidden();

  // Le plafond ne peut qu'être abaissé : une valeur supérieure à EXPORT_LIMIT est ramenée à EXPORT_LIMIT.
  const limit = Math.min(Math.max(options.limit ?? EXPORT_LIMIT, 1), EXPORT_LIMIT);
  const logs = await db.auditLog.findMany({
    where: whereOf(filters),
    include: rowInclude,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const truncated = logs.length > limit;
  const rows = logs.slice(0, limit);

  const csv = toCsv([
    ["Date (UTC)", "Auteur", "E-mail de l'auteur", "Action", "Objet", "Identifiant de l'objet", "Adresse IP", "Métadonnées", "Identifiant de requête"],
    ...rows.map((log) => [
      log.occurredAt,
      log.actor?.name ?? "Système",
      log.actor?.email,
      log.action,
      log.entityType,
      log.entityId,
      log.ipAddress,
      log.metadata === null ? "" : JSON.stringify(log.metadata),
      log.requestId,
    ]),
  ]);

  await writeAudit({
    actorUserId: user.id,
    action: "audit.exported",
    entityType: "audit",
    metadata: {
      rows: rows.length,
      truncated,
      filters: {
        action: filters.action ?? null,
        entityType: filters.entityType ?? null,
        actorId: filters.actorId ?? null,
        from: filters.from?.toISOString().slice(0, 10) ?? null,
        to: filters.to?.toISOString().slice(0, 10) ?? null,
      },
    },
  });

  const stamp = (options.now ?? new Date()).toISOString().slice(0, 10);
  return { filename: `journal-audit-${stamp}${truncated ? "-tronque" : ""}.csv`, csv, rows: rows.length, truncated };
}
