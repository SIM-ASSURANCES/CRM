import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { errors } from "@/lib/errors";

// Aides communes aux Route Handlers qui renvoient des fichiers (exports). L'identité est relue côté serveur, jamais
// déduite d'un paramètre de la requête ; les permissions sont vérifiées par les services appelés.

/** Utilisateur de la session pour un Route Handler : 401 sans session, 403 tant que le mot de passe temporaire n'est pas changé. */
export async function apiUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw errors.unauthenticated();
  if (user.mustChangePassword) throw errors.forbidden("Changez d'abord votre mot de passe temporaire.");
  return user;
}

/**
 * Fichier en téléchargement (CSV, XLSX…) : jamais mis en cache (donnée à jour et personnelle), type non devinable par le
 * navigateur, nom de fichier ASCII de repli + nom UTF-8 pour les accents.
 */
export function fileResponse(filename: string, contentType: string, body: string | Buffer, extraHeaders: Record<string, string> = {}): Response {
  const ascii = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

/**
 * Réponse CSV en téléchargement. Jamais mise en cache (donnée à jour et personnelle), type non devinable par le
 * navigateur, nom de fichier ASCII de repli + nom UTF-8 pour les accents.
 */
export function csvResponse(filename: string, csv: string, extraHeaders: Record<string, string> = {}): Response {
  const ascii = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
