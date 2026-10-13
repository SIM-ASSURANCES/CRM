import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Vérification OPTIMISTE uniquement (présence du cookie de session) pour éviter d'afficher une page
// protégée à un visiteur anonyme. La vraie vérification (session valide, rôle, permission) est faite
// côté serveur par requireUser / requirePermission, au plus près de la donnée.
const PUBLIC_PATHS = ["/login", "/forgot-password"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isPublic && !getSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Exclut l'API (elle fait ses propres contrôles), les ressources statiques et les fichiers avec extension.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
