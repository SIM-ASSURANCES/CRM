import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/session";

// Périmètre de visibilité des opportunités (CDC 2) : le commercial voit les siennes ; le manager celles de son
// équipe ; la direction, l'administrateur et l'audit voient tout. Appliqué à CHAQUE lecture et écriture, côté serveur.
export function opportunityScopeWhere(user: CurrentUser): Prisma.OpportunityWhereInput {
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
