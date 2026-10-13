import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { TeamInput, UpdateTeamInput } from "@/features/users/schemas";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Équipes commerciales : elles définissent le périmètre d'un manager (il voit les prospects de son équipe).

export type TeamRow = {
  id: string;
  name: string;
  managerUserId: string | null;
  managerName: string | null;
  memberCount: number;
};

const teamInclude = {
  manager: { select: { name: true } },
  _count: { select: { members: true } },
} satisfies Prisma.TeamInclude;

function toRow(team: Prisma.TeamGetPayload<{ include: typeof teamInclude }>): TeamRow {
  return {
    id: team.id,
    name: team.name,
    managerUserId: team.managerUserId,
    managerName: team.manager?.name ?? null,
    memberCount: team._count.members,
  };
}

function assertAdmin(actor: CurrentUser): void {
  if (!can(actor.role, "user:manage")) throw errors.forbidden();
}

async function assertManager(tx: Prisma.TransactionClient, managerUserId?: string): Promise<void> {
  if (!managerUserId) return;
  const manager = await tx.user.findUnique({ where: { id: managerUserId }, select: { role: true, banned: true } });
  const message = "Le responsable doit être un utilisateur actif avec le rôle Manager commercial.";
  if (!manager || manager.role !== "manager" || manager.banned) {
    throw errors.validation(message, { fieldErrors: { managerUserId: [message] } });
  }
}

function duplicateNameError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const message = "Une équipe porte déjà ce nom.";
    throw errors.validation(message, { fieldErrors: { name: [message] } });
  }
  throw error;
}

export async function listTeams(actor: CurrentUser): Promise<TeamRow[]> {
  assertAdmin(actor);
  const teams = await db.team.findMany({ include: teamInclude, orderBy: { name: "asc" } });
  return teams.map(toRow);
}

export async function getTeam(actor: CurrentUser, id: string): Promise<TeamRow> {
  assertAdmin(actor);
  const team = await db.team.findUnique({ where: { id }, include: teamInclude });
  if (!team) throw errors.notFound("Équipe introuvable.");
  return toRow(team);
}

/** Utilisateurs pouvant être responsables d'une équipe : managers actifs. */
export async function listManagers(actor: CurrentUser): Promise<{ id: string; name: string }[]> {
  assertAdmin(actor);
  return db.user.findMany({
    where: { role: "manager", OR: [{ banned: false }, { banned: null }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function listTeamOptions(actor: CurrentUser): Promise<{ id: string; name: string }[]> {
  assertAdmin(actor);
  return db.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function createTeam(actor: CurrentUser, input: TeamInput): Promise<string> {
  assertAdmin(actor);
  try {
    return await db.$transaction(async (tx) => {
      await assertManager(tx, input.managerUserId);
      const team = await tx.team.create({ data: { name: input.name, managerUserId: input.managerUserId ?? null } });
      await writeAudit({ actorUserId: actor.id, action: "team.created", entityType: "team", entityId: team.id }, tx);
      return team.id;
    });
  } catch (error) {
    return duplicateNameError(error);
  }
}

export async function updateTeam(actor: CurrentUser, input: UpdateTeamInput): Promise<void> {
  assertAdmin(actor);
  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.team.findUnique({ where: { id: input.id }, select: { id: true } });
      if (!existing) throw errors.notFound("Équipe introuvable.");
      await assertManager(tx, input.managerUserId);
      await tx.team.update({ where: { id: input.id }, data: { name: input.name, managerUserId: input.managerUserId ?? null } });
      await writeAudit({ actorUserId: actor.id, action: "team.updated", entityType: "team", entityId: input.id }, tx);
    });
  } catch (error) {
    duplicateNameError(error);
  }
}

/** Une équipe qui a encore des membres ne peut pas être supprimée (les périmètres changeraient en silence). */
export async function deleteTeam(actor: CurrentUser, id: string): Promise<void> {
  assertAdmin(actor);
  await db.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id }, include: { _count: { select: { members: true } } } });
    if (!team) throw errors.notFound("Équipe introuvable.");
    if (team._count.members > 0) {
      throw errors.validation("Cette équipe a encore des membres : retirez-les avant de la supprimer.");
    }
    await tx.team.delete({ where: { id } });
    await writeAudit({ actorUserId: actor.id, action: "team.deleted", entityType: "team", entityId: id }, tx);
  });
}
