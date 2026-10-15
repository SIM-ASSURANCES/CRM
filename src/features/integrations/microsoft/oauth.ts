import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// OAuth 2.0 avec Microsoft Entra ID (flux « code d'autorisation » + PKCE). Droits demandés au minimum (CDC 7.3) :
//  - offline_access : obtenir un jeton d'actualisation, pour synchroniser sans que l'utilisateur soit présent ;
//  - User.Read : lire son propre profil (adresse du compte connecté) ;
//  - Mail.ReadBasic : lire les EN-TÊTES des messages (objet, expéditeur, destinataires, date), PAS leur contenu ni leurs
//    pièces jointes. Le CRM n'a besoin de rien de plus pour retracer les échanges avec un contact.

export const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Mail.ReadBasic"] as const;

export type MicrosoftConfig = { clientId: string; clientSecret: string; tenant: string };

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string };

export type OAuthErrorCode =
  /** Le consentement est révoqué ou le jeton expiré : l'utilisateur doit se reconnecter. */
  | "invalid_grant"
  /** Application mal configurée (identifiant ou secret refusé) : problème d'administration, pas d'utilisateur. */
  | "invalid_client"
  /** Panne passagère du fournisseur : réessayer plus tard. */
  | "unavailable";

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

const base64url = (buffer: Buffer) => buffer.toString("base64url");

/** Vérificateur et défi PKCE (RFC 7636) : empêche qu'un code d'autorisation intercepté soit utilisable par un tiers. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

/** Jeton aléatoire du paramètre « state » : lie le retour de Microsoft à la demande de CET utilisateur (anti-CSRF). */
export function generateState(): string {
  return base64url(randomBytes(32));
}

function endpoint(config: MicrosoftConfig, path: "authorize" | "token"): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/${path}`;
}

export function authorizeUrl(config: MicrosoftConfig, input: { redirectUri: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    // Laisse l'utilisateur choisir le compte : il peut avoir un compte personnel et un compte professionnel ouverts.
    prompt: "select_account",
  });
  return `${endpoint(config, "authorize")}?${params.toString()}`;
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  scope: z.string().default(""),
});

const errorResponse = z.object({ error: z.string().optional() });

async function requestTokens(
  config: MicrosoftConfig,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<Tokens> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint(config, "token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }).toString(),
    });
  } catch {
    throw new OAuthError("unavailable", "Microsoft est injoignable pour le moment.");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const code = errorResponse.safeParse(payload).data?.error;
    // Le texte d'erreur de Microsoft n'est pas repris : il peut contenir des identifiants de trace, jamais utiles ici.
    if (code === "invalid_grant") throw new OAuthError("invalid_grant", "L'accès a été révoqué ou a expiré : reconnectez-vous.");
    if (code === "invalid_client" || code === "unauthorized_client") {
      throw new OAuthError("invalid_client", "L'application Microsoft est mal configurée (identifiant ou secret refusé).");
    }
    throw new OAuthError("unavailable", "Microsoft a refusé la demande ou est indisponible.");
  }

  const parsed = tokenResponse.safeParse(payload);
  if (!parsed.success) throw new OAuthError("unavailable", "Réponse de Microsoft inattendue.");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: new Date(now.getTime() + parsed.data.expires_in * 1000),
    scope: parsed.data.scope,
  };
}

/** Échange le code d'autorisation contre des jetons (retour de la page de consentement). */
export function exchangeCode(
  config: MicrosoftConfig,
  input: { code: string; redirectUri: string; verifier: string },
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Tokens> {
  return requestTokens(
    config,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
      scope: MICROSOFT_SCOPES.join(" "),
    },
    fetchImpl,
    now,
  );
}

/** Obtient un nouveau jeton d'accès. Microsoft fait tourner le jeton d'actualisation : le nouveau remplace l'ancien. */
export function refreshAccessToken(
  config: MicrosoftConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Tokens> {
  return requestTokens(
    config,
    { grant_type: "refresh_token", refresh_token: refreshToken, scope: MICROSOFT_SCOPES.join(" ") },
    fetchImpl,
    now,
  );
}
