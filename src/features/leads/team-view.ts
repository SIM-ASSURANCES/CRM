import "server-only";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Vue individuelle d'un manager sur son équipe : il consulte le tableau de bord de chacun de ses commerciaux. La liste et le
// périmètre sont calculés CÔTÉ SERVEUR à partir de l'équipe du manager : un identifiant d'un autre membre, d'une autre
// équipe ou envoyé par un autre rôle ne donne rien.

export type TeamMember = { id: string; name: string };

/** Membres actifs de l'équipe du manager (hors lui-même), par ordre alphabétique. Vide pour tout autre rôle. */
export async function listTeamMembers(user: CurrentUser): Promise<TeamMember[]> {
  if (user.role !== "manager" || !user.teamId) return [];
  return db.user.findMany({
    where: { teamId: user.teamId, id: { not: user.id }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Utilisateur « vu comme ce membre » : mêmes indicateurs que son propre tableau de bord (périmètre = ses seuls prospects).
 * Retourne null si le demandeur n'est pas manager ou si la personne n'est pas un membre actif de son équipe.
 */
export async function getMemberView(user: CurrentUser, memberId: string): Promise<{ member: TeamMember; scope: CurrentUser } | null> {
  const member = (await listTeamMembers(user)).find((candidate) => candidate.id === memberId);
  if (!member) return null;
  const row = await db.user.findUnique({ where: { id: member.id }, select: { email: true, teamId: true } });
  if (!row) return null;
  return {
    member,
    scope: { id: member.id, name: member.name, email: row.email, role: "commercial", teamId: row.teamId, mustChangePassword: false },
  };
}
