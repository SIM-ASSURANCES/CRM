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
  // Activités journalisées et tâches (CDC 6) ; l'audit lit sans écrire. Réaffecter une tâche exige account:assign.
  "activity:read",
  "activity:write",
  "task:read",
  "task:write",
  // Rapports de prévisions et de motifs de perte (CDC 8.2) : chacun ne voit que son périmètre. L'export est réservé aux
  // managers et au-dessus (CDC 8.3 : limiter les exports de masse par rôle).
  "report:read",
  "report:export",
  // Fixer les objectifs mensuels des commerciaux (un manager ne fixe que ceux de son équipe).
  "target:manage",
  "user:manage",
  "audit:read",
  // Exporter le journal d'audit (chaque export est lui-même journalisé, CDC 8.3).
  "audit:export",
  // Importer des données initiales (comptes, contacts) depuis un fichier CSV ou XLSX.
  "import:run",
  // Connecter SA propre messagerie (Microsoft 365) : chacun ne gère que sa connexion ; l'audit n'écrit rien.
  "integration:connect",
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
    "activity:read",
    "activity:write",
    "task:read",
    "task:write",
    "report:read",
    "report:export",
    "target:manage",
    "integration:connect",
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
    "activity:read",
    "activity:write",
    "task:read",
    "task:write",
    "report:read",
    "report:export",
    "target:manage",
    "integration:connect",
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
    "activity:read",
    "activity:write",
    "task:read",
    "task:write",
    "report:read",
    "integration:connect",
  ],
  audit: [
    "dashboard:read",
    "prospect:read",
    "account:read",
    "contact:read",
    "opportunity:read",
    "activity:read",
    "task:read",
    "report:read",
    "audit:read",
    "audit:export",
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
