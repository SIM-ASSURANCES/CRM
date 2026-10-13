import type { Role } from "@/lib/auth/roles";

// Matrice rôle → permissions. Elle est vérifiée CÔTÉ SERVEUR pour chaque opération (CDC 2.1 et A.9) :
// masquer un bouton dans l'interface ne protège jamais une donnée.
// Les périmètres (propriétaire, équipe) sont appliqués en plus, par entité (voir features/*/scope.ts).

export const PERMISSIONS = [
  "dashboard:read",
  "prospect:read",
  "prospect:write",
  "account:read",
  "account:write",
  // Changer le propriétaire commercial d'un compte ou d'une opportunité (changement tracé, CDC 5.1).
  "account:assign",
  // Fusionner des doublons : réservé aux profils autorisés, avec trace d'audit (CDC 3.2).
  "account:merge",
  "contact:read",
  "contact:write",
  "opportunity:read",
  "opportunity:write",
  "report:export",
  "user:manage",
  "audit:read",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  direction: [
    "dashboard:read",
    "prospect:read",
    "prospect:write",
    "account:read",
    "account:write",
    "account:assign",
    "account:merge",
    "contact:read",
    "contact:write",
    "opportunity:read",
    "opportunity:write",
    "report:export",
  ],
  manager: [
    "dashboard:read",
    "prospect:read",
    "prospect:write",
    "account:read",
    "account:write",
    "account:assign",
    "contact:read",
    "contact:write",
    "opportunity:read",
    "opportunity:write",
    "report:export",
  ],
  commercial: [
    "dashboard:read",
    "prospect:read",
    "prospect:write",
    "account:read",
    "account:write",
    "contact:read",
    "contact:write",
    "opportunity:read",
    "opportunity:write",
  ],
  audit: ["dashboard:read", "prospect:read", "account:read", "contact:read", "opportunity:read", "audit:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
