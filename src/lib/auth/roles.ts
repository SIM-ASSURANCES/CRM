// Rôles du cahier des charges (section 2).

export const ROLES = ["admin", "direction", "manager", "commercial", "audit"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur CRM",
  direction: "Direction commerciale",
  manager: "Manager commercial",
  commercial: "Commercial",
  audit: "Lecture seule / audit",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Un rôle inconnu ou absent est ramené au moins privilégié (lecture seule) : principe du moindre privilège. */
export function toRole(value: string | null | undefined): Role {
  return isRole(value) ? value : "audit";
}
