import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { can, type Permission } from "@/lib/auth/permissions";
import { toRole, type Role } from "@/lib/auth/roles";
import { errors } from "@/lib/errors";

// Couche d'accès aux données d'identité (Data Access Layer, guide Next.js « Authentication »).
// Toute page ou action sensible appelle requireUser / requirePermission : le contrôle est fait
// côté serveur, au plus près de la donnée, jamais seulement dans l'interface.

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
  mustChangePassword: boolean;
};

/** Lit la session (dédupliquée par requête). À appeler derrière un <Suspense> (cacheComponents). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: toRole(user.role),
    teamId: user.teamId ?? null,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
});

export async function requireUser(options?: { allowPasswordChange?: boolean }): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Après une réinitialisation par l'administrateur, aucune autre page n'est accessible avant le changement.
  if (user.mustChangePassword && !options?.allowPasswordChange) redirect("/change-password");
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw errors.forbidden();
  return user;
}

/**
 * Pour les écrans d'administration : un utilisateur sans le droit reçoit une 404, sans révéler que l'écran existe.
 * (Les actions et services appliquent de toute façon leur propre contrôle de permission.)
 */
export async function requirePermissionOrNotFound(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) notFound();
  return user;
}
