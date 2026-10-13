import "server-only";
import { accountScopeWhere } from "@/features/accounts/scope";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/session";

// Périmètre de visibilité des tâches (CDC 2) : le commercial voit celles dont il est responsable ou créateur, et celles
// rattachées à un compte qu'il voit ; le manager y ajoute celles de son équipe ; la direction, l'administrateur et
// l'audit voient tout. Appliqué à CHAQUE lecture et écriture, côté serveur.
export function taskScopeWhere(user: CurrentUser): Prisma.TaskWhereInput {
  switch (user.role) {
    case "admin":
    case "direction":
    case "audit":
      return {};
    case "manager": {
      const own: Prisma.TaskWhereInput[] = [
        { assigneeUserId: user.id },
        { createdByUserId: user.id },
        { account: accountScopeWhere(user) },
      ];
      if (user.teamId) own.push({ assignee: { teamId: user.teamId } });
      return { OR: own };
    }
    case "commercial":
      return { OR: [{ assigneeUserId: user.id }, { createdByUserId: user.id }, { account: accountScopeWhere(user) }] };
  }
}
