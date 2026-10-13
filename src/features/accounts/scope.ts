import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/session";

// Périmètre de visibilité (CDC 2) : le commercial voit ses comptes ; le manager ceux de son équipe ; la direction,
// l'administrateur et l'audit voient tout. Appliqué à CHAQUE lecture et écriture, côté serveur. La vue « groupe »
// conserve les droits propres à chaque compte : une filiale hors périmètre n'apparaît pas dans la hiérarchie.

export function accountScopeWhere(user: CurrentUser): Prisma.CrmAccountWhereInput {
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

/**
 * Un contact est visible si son responsable est dans le périmètre, ou s'il est rattaché à au moins un compte visible.
 * (Un contact partagé entre deux comptes reste donc accessible à celui qui voit l'un d'eux.)
 */
export function contactScopeWhere(user: CurrentUser): Prisma.ContactWhereInput {
  const viaAccount: Prisma.ContactWhereInput = { accounts: { some: { account: accountScopeWhere(user) } } };
  switch (user.role) {
    case "admin":
    case "direction":
    case "audit":
      return {};
    case "manager":
      return user.teamId
        ? { OR: [{ ownerUserId: user.id }, { owner: { teamId: user.teamId } }, viaAccount] }
        : { OR: [{ ownerUserId: user.id }, viaAccount] };
    case "commercial":
      return { OR: [{ ownerUserId: user.id }, viaAccount] };
  }
}
