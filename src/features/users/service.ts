import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { CreateUserInput, UpdateUserInput } from "@/features/users/schemas";
import { writeAudit } from "@/lib/audit";
import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/permissions";
import { toRole, type Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import { generateTemporaryPassword } from "@/lib/auth/temporary-password";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Administration des utilisateurs (CDC 2 et 2.1). Toute opération exige la permission « user:manage » vérifiée ICI,
// côté serveur, même si l'interface masque déjà ces écrans aux autres rôles. Les traces d'audit sont écrites dans la
// même transaction que la mutation. Un mot de passe temporaire n'est jamais stocké en clair ni journalisé : il est
// renvoyé une seule fois à l'administrateur, qui le transmet à l'utilisateur par un canal sûr.

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamName: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type UserDetail = UserRow & { teamId: string | null; pendingResetRequest: boolean };

/** Résultat d'une création de compte ou d'une réinitialisation : à afficher UNE fois puis oublier. */
export type CredentialResult = { id: string; name: string; email: string; temporaryPassword: string };

export type ResetRequestRow = {
  id: string;
  email: string;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
};

const userInclude = { team: { select: { name: true } } } satisfies Prisma.UserInclude;
type UserWithTeam = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toRow(user: UserWithTeam): UserRow {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: toRole(user.role),
    teamName: user.team?.name ?? null,
    disabled: Boolean(user.banned),
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function assertAdmin(actor: CurrentUser): void {
  if (!can(actor.role, "user:manage")) throw errors.forbidden();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function assertTeamExists(tx: Prisma.TransactionClient, teamId?: string): Promise<void> {
  if (!teamId) return;
  const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true } });
  if (!team) throw errors.validation("Équipe invalide.", { fieldErrors: { teamId: ["Équipe invalide."] } });
}

/** Garde-fou : le CRM ne doit jamais se retrouver sans administrateur actif. */
async function assertAnotherActiveAdmin(tx: Prisma.TransactionClient, targetId: string): Promise<void> {
  const others = await tx.user.count({
    where: { role: "admin", id: { not: targetId }, OR: [{ banned: false }, { banned: null }] },
  });
  if (others === 0) {
    throw errors.validation("Impossible : le CRM doit conserver au moins un administrateur actif.");
  }
}

// --- Lecture -----------------------------------------------------------------------------------------------------

export async function listUsers(
  actor: CurrentUser,
  options: { q?: string; status?: "active" | "disabled"; page?: number; pageSize?: number } = {},
): Promise<{ rows: UserRow[]; total: number; page: number; pageSize: number }> {
  assertAdmin(actor);

  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const filters: Prisma.UserWhereInput[] = [];

  if (options.status === "disabled") filters.push({ banned: true });
  if (options.status === "active") filters.push({ OR: [{ banned: false }, { banned: null }] });

  const q = options.q?.trim();
  if (q) {
    filters.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] });
  }

  const where: Prisma.UserWhereInput = { AND: filters };
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      include: userInclude,
      orderBy: [{ name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { rows: users.map(toRow), total, page, pageSize };
}

export async function getUser(actor: CurrentUser, id: string): Promise<UserDetail> {
  assertAdmin(actor);
  const user = await db.user.findUnique({ where: { id }, include: userInclude });
  if (!user) throw errors.notFound("Utilisateur introuvable.");

  const pending = await db.passwordResetRequest.count({ where: { email: user.email, status: "pending" } });
  return { ...toRow(user), teamId: user.teamId, pendingResetRequest: pending > 0 };
}

/** Nombre de demandes de réinitialisation en attente (cloche de l'en-tête). À n'appeler que pour un administrateur. */
export async function countPendingResetRequests(): Promise<number> {
  return db.passwordResetRequest.count({ where: { status: "pending" } });
}

export async function listPendingResetRequests(actor: CurrentUser): Promise<ResetRequestRow[]> {
  assertAdmin(actor);
  const requests = await db.passwordResetRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  const users = await db.user.findMany({
    where: { email: { in: requests.map((r) => r.email) } },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));

  return requests.map((request) => ({
    id: request.id,
    email: request.email,
    createdAt: request.createdAt,
    userId: byEmail.get(request.email)?.id ?? null,
    userName: byEmail.get(request.email)?.name ?? null,
  }));
}

// --- Écriture ----------------------------------------------------------------------------------------------------

export async function createUser(actor: CurrentUser, input: CreateUserInput): Promise<CredentialResult> {
  assertAdmin(actor);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await (await auth.$context).password.hash(temporaryPassword);
  const id = randomUUID();

  try {
    await db.$transaction(async (tx) => {
      await assertTeamExists(tx, input.teamId);
      await tx.user.create({
        data: {
          id,
          name: input.name,
          email: input.email,
          emailVerified: true,
          role: input.role,
          teamId: input.teamId ?? null,
          // Le mot de passe est connu de l'administrateur : changement obligatoire à la première connexion.
          mustChangePassword: true,
          accounts: { create: { accountId: id, providerId: "credential", password: passwordHash } },
        },
      });
      await writeAudit(
        { actorUserId: actor.id, action: "user.created", entityType: "user", entityId: id, metadata: { role: input.role } },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.validation("Cette adresse e-mail est déjà utilisée.", {
        fieldErrors: { email: ["Cette adresse e-mail est déjà utilisée."] },
      });
    }
    throw error;
  }

  return { id, name: input.name, email: input.email, temporaryPassword };
}

export async function updateUser(actor: CurrentUser, input: UpdateUserInput): Promise<void> {
  assertAdmin(actor);

  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.id } });
    if (!target) throw errors.notFound("Utilisateur introuvable.");
    await assertTeamExists(tx, input.teamId);

    const roleChanged = target.role !== input.role;
    if (roleChanged && actor.id === target.id) {
      throw errors.validation("Vous ne pouvez pas modifier votre propre rôle.", {
        fieldErrors: { role: ["Vous ne pouvez pas modifier votre propre rôle."] },
      });
    }
    if (roleChanged && target.role === "admin") await assertAnotherActiveAdmin(tx, target.id);

    const changedFields = [
      target.name !== input.name && "name",
      roleChanged && "role",
      target.teamId !== (input.teamId ?? null) && "teamId",
    ].filter((field): field is string => typeof field === "string");

    await tx.user.update({
      where: { id: target.id },
      data: { name: input.name, role: input.role, teamId: input.teamId ?? null },
    });
    // Un changement de rôle prend effet immédiatement : les sessions ouvertes sont révoquées.
    if (roleChanged) await tx.session.deleteMany({ where: { userId: target.id } });

    await writeAudit(
      {
        actorUserId: actor.id,
        action: "user.updated",
        entityType: "user",
        entityId: target.id,
        metadata: { changedFields, fromRole: target.role, toRole: input.role },
      },
      tx,
    );
  });
}

/** Désactivation immédiate (CDC 2.1) : connexion refusée et sessions ouvertes supprimées. Réversible. */
export async function setUserActive(actor: CurrentUser, id: string, active: boolean): Promise<void> {
  assertAdmin(actor);
  if (!active && actor.id === id) throw errors.validation("Vous ne pouvez pas désactiver votre propre compte.");

  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) throw errors.notFound("Utilisateur introuvable.");
    if (!active && target.role === "admin") await assertAnotherActiveAdmin(tx, target.id);

    await tx.user.update({
      where: { id },
      data: active
        ? { banned: false, banReason: null, banExpires: null }
        : { banned: true, banReason: "Compte désactivé par un administrateur", banExpires: null },
    });
    if (!active) await tx.session.deleteMany({ where: { userId: id } });

    await writeAudit(
      { actorUserId: actor.id, action: active ? "user.reactivated" : "user.deactivated", entityType: "user", entityId: id },
      tx,
    );
  });
}

/**
 * Réinitialisation du mot de passe par l'administrateur (décision du plan) : génère un mot de passe temporaire,
 * impose son changement à la prochaine connexion, révoque TOUTES les sessions de l'utilisateur et clôt ses demandes.
 */
export async function resetPassword(actor: CurrentUser, id: string): Promise<CredentialResult> {
  assertAdmin(actor);
  if (actor.id === id) {
    throw errors.validation("Pour votre propre compte, utilisez « Changer mon mot de passe » dans le menu utilisateur.");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await (await auth.$context).password.hash(temporaryPassword);

  const target = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw errors.notFound("Utilisateur introuvable.");
    if (user.banned) throw errors.validation("Ce compte est désactivé : réactivez-le avant de réinitialiser son mot de passe.");

    const credential = await tx.account.findFirst({ where: { userId: id, providerId: "credential" }, select: { id: true } });
    if (credential) {
      await tx.account.update({ where: { id: credential.id }, data: { password: passwordHash } });
    } else {
      await tx.account.create({ data: { userId: id, accountId: id, providerId: "credential", password: passwordHash } });
    }
    await tx.user.update({ where: { id }, data: { mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.passwordResetRequest.updateMany({
      where: { email: user.email, status: "pending" },
      data: { status: "done", handledById: actor.id, handledAt: new Date() },
    });

    await writeAudit({ actorUserId: actor.id, action: "user.password_reset", entityType: "user", entityId: id }, tx);
    return user;
  });

  return { id, name: target.name, email: target.email, temporaryPassword };
}

export async function dismissResetRequest(actor: CurrentUser, requestId: string): Promise<void> {
  assertAdmin(actor);

  await db.$transaction(async (tx) => {
    const updated = await tx.passwordResetRequest.updateMany({
      where: { id: requestId, status: "pending" },
      data: { status: "rejected", handledById: actor.id, handledAt: new Date() },
    });
    if (updated.count === 0) throw errors.notFound("Demande introuvable ou déjà traitée.");
    await writeAudit({ actorUserId: actor.id, action: "auth.reset_request_dismissed", entityType: "password_reset_request", entityId: requestId }, tx);
  });
}
