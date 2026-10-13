"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { auth } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/session";

/** Déconnexion : invalide la session côté serveur (pas seulement le cookie), trace l'événement, redirige. */
export async function logoutAction() {
  const user = await getCurrentUser();
  await auth.api.signOut({ headers: await headers() });
  if (user) {
    await writeAudit({ actorUserId: user.id, action: "auth.logout", entityType: "user", entityId: user.id });
  }
  redirect("/login");
}
