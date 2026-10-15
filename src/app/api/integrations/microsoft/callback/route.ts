import { connection } from "next/server";
import { completeMicrosoftConnection } from "@/features/integrations/connection";
import { defaultDeps, loadIntegrationSetup } from "@/features/integrations/setup";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Retour de la page de consentement Microsoft. Le navigateur de l'utilisateur arrive ici avec `code` et `state` : l'état
// est vérifié (lié à la session, à usage unique, expirant) avant tout échange. Aucun détail n'est mis dans l'adresse de
// redirection : seulement un code de résultat que la page /integrations traduit en message.

const back = (query: string) => Response.redirect(new URL(`/integrations?${query}`, env.BETTER_AUTH_URL), 303);

export async function GET(request: Request) {
  await connection();
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", env.BETTER_AUTH_URL), 303);

  const setup = loadIntegrationSetup();
  if (!setup) return back("erreur=config");

  const params = new URL(request.url).searchParams;
  // L'utilisateur a refusé le consentement (ou Microsoft a signalé une erreur) : rien à enregistrer.
  if (params.get("error")) return back("erreur=refuse");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("erreur=connexion");

  try {
    await completeMicrosoftConnection(user, { code, state }, defaultDeps(setup));
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "FORBIDDEN") return back("erreur=acces");
      return back("erreur=connexion");
    }
    logger.error({ err: error }, "Échec inattendu de la connexion Microsoft");
    return back("erreur=connexion");
  }
  return back("ok=connected");
}
