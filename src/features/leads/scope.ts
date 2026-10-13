import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/session";

// Périmètre de visibilité (CDC 2) : le commercial voit ses prospects ; le manager ceux de son équipe ;
// la direction, l'administrateur et l'audit voient tout. Appliqué à CHAQUE lecture et écriture côté serveur.

export function leadScopeWhere(user: CurrentUser): Prisma.LeadWhereInput {
  switch (user.role) {
    case "admin":
    case "direction":
    case "audit":
      return {};
    case "manager":
      return user.teamId
        ? { OR: [{ ownerUserId: user.id }, { owner: { teamId: user.teamId } }] }
        : { ownerUserId: user.id };
    case "commercial":
      return { ownerUserId: user.id };
  }
}

/** Même périmètre pour les requêtes SQL brutes (alias de la table des prospects : « l »). */
export function leadScopeSql(user: CurrentUser): Prisma.Sql {
  switch (user.role) {
    case "admin":
    case "direction":
    case "audit":
      return Prisma.empty;
    case "manager":
      return user.teamId
        ? Prisma.sql`AND (l.owner_user_id = ${user.id}::uuid OR l.owner_user_id IN (SELECT id FROM users WHERE team_id = ${user.teamId}::uuid))`
        : Prisma.sql`AND l.owner_user_id = ${user.id}::uuid`;
    case "commercial":
      return Prisma.sql`AND l.owner_user_id = ${user.id}::uuid`;
  }
}
