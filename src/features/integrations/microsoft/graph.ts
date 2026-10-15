import { z } from "zod";

// Client minimal de Microsoft Graph pour les e-mails. Il se limite à ce que la synchronisation utilise : le profil, la
// lecture INCRÉMENTALE (« delta ») des dossiers Boîte de réception et Éléments envoyés, et l'abonnement aux
// notifications. Tout passe par l'interface `MailGraph` : le moteur de synchronisation est ainsi testé avec un faux
// fournisseur, sans réseau.

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const PAGE_SIZE = 50;

export type MailFolder = "inbox" | "sentitems";

export type MailMessage = {
  /** Identifiant propre à Graph (change si le message est déplacé) ; sert de repli pour le dédoublonnage. */
  id: string;
  /** Identifiant international du message (RFC 5322) : stable, c'est la clé de dédoublonnage préférée. */
  internetMessageId: string | null;
  subject: string;
  from: string | null;
  to: string[];
  cc: string[];
  receivedAt: Date | null;
  sentAt: Date | null;
  webLink: string | null;
  /** normal | personal | private | confidential */
  sensitivity: string;
  isDraft: boolean;
  /** Message supprimé ou déplacé hors du dossier depuis la dernière synchronisation. */
  removed: boolean;
};

export type DeltaPage = {
  messages: MailMessage[];
  /** Adresse de la page suivante, ou curseur de la prochaine synchronisation quand `done` est vrai. */
  cursor: string;
  done: boolean;
};

export type GraphErrorKind =
  /** Jeton refusé : à actualiser, ou connexion révoquée. */
  | "unauthorized"
  /** Curseur périmé : il faut repartir d'une synchronisation complète (les doublons sont écartés à l'enregistrement). */
  | "gone"
  /** Trop de requêtes : réessayer après le délai indiqué. */
  | "throttled"
  | "unavailable";

export class GraphError extends Error {
  readonly kind: GraphErrorKind;
  readonly retryAfterSeconds?: number;
  constructor(kind: GraphErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "GraphError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type Subscription = { id: string; expiresAt: Date };

export interface MailGraph {
  profile(accessToken: string): Promise<{ id: string; email: string }>;
  messagesDelta(accessToken: string, input: { folder: MailFolder; cursor: string | null; since: Date }): Promise<DeltaPage>;
  createSubscription(accessToken: string, input: { notificationUrl: string; clientState: string; expiresAt: Date }): Promise<Subscription>;
  renewSubscription(accessToken: string, id: string, expiresAt: Date): Promise<Subscription>;
  deleteSubscription(accessToken: string, id: string): Promise<void>;
}

const address = z.object({ emailAddress: z.object({ address: z.string().optional() }).optional() });

const messageSchema = z.object({
  id: z.string(),
  "@removed": z.unknown().optional(),
  internetMessageId: z.string().nullish(),
  subject: z.string().nullish(),
  from: address.nullish(),
  toRecipients: z.array(address).nullish(),
  ccRecipients: z.array(address).nullish(),
  receivedDateTime: z.string().nullish(),
  sentDateTime: z.string().nullish(),
  webLink: z.string().nullish(),
  sensitivity: z.string().nullish(),
  isDraft: z.boolean().nullish(),
});

const deltaSchema = z.object({
  value: z.array(messageSchema),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

const subscriptionSchema = z.object({ id: z.string(), expirationDateTime: z.string() });

const addressOf = (entry: z.infer<typeof address> | null | undefined) => entry?.emailAddress?.address?.trim().toLowerCase() || null;
const addressesOf = (entries: z.infer<typeof address>[] | null | undefined) =>
  (entries ?? []).map(addressOf).filter((value): value is string => value !== null);
const dateOf = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Un curseur est une adresse fournie par Graph, relue depuis notre base. Avant de la suivre en y joignant le jeton
 * d'accès, on vérifie qu'elle pointe bien vers Graph : une valeur altérée ne doit jamais envoyer le jeton ailleurs.
 */
export function assertGraphUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GraphError("gone", "Curseur de synchronisation invalide.");
  }
  if (parsed.origin !== GRAPH_ORIGIN) throw new GraphError("gone", "Curseur de synchronisation invalide.");
  return parsed;
}

function deltaUrl(folder: MailFolder, since: Date): string {
  const url = new URL(`${GRAPH_ORIGIN}/v1.0/me/mailFolders/${folder}/messages/delta`);
  url.searchParams.set(
    "$select",
    "id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,webLink,sensitivity,isDraft",
  );
  url.searchParams.set("$filter", `receivedDateTime ge ${since.toISOString()}`);
  // Les espaces du filtre OData sont écrits « %20 » (et non « + ») : la seule forme que Graph accepte à coup sûr.
  // Un « + » littéral est déjà encodé en « %2B » par URLSearchParams, le remplacement est donc sans risque.
  url.search = url.searchParams.toString().replace(/\+/g, "%20");
  return url.toString();
}

async function call(fetchImpl: typeof fetch, accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...init.headers },
    });
  } catch {
    throw new GraphError("unavailable", "Microsoft Graph est injoignable pour le moment.");
  }
  if (response.ok) return response;

  if (response.status === 401) throw new GraphError("unauthorized", "Accès refusé par Microsoft.");
  if (response.status === 410) throw new GraphError("gone", "Le curseur de synchronisation a expiré.");
  if (response.status === 429) {
    const retry = Number(response.headers.get("Retry-After"));
    throw new GraphError("throttled", "Microsoft limite temporairement les requêtes.", Number.isFinite(retry) && retry > 0 ? retry : 30);
  }
  throw new GraphError("unavailable", `Microsoft Graph a répondu ${response.status}.`);
}

export function createHttpMailGraph(fetchImpl: typeof fetch = fetch): MailGraph {
  return {
    async profile(accessToken) {
      const response = await call(fetchImpl, accessToken, `${GRAPH_ORIGIN}/v1.0/me?$select=id,mail,userPrincipalName`);
      const parsed = z
        .object({ id: z.string(), mail: z.string().nullish(), userPrincipalName: z.string().nullish() })
        .safeParse(await response.json().catch(() => null));
      const email = parsed.success ? (parsed.data.mail || parsed.data.userPrincipalName) : null;
      if (!parsed.success || !email) throw new GraphError("unavailable", "Profil Microsoft illisible.");
      return { id: parsed.data.id, email: email.trim().toLowerCase() };
    },

    async messagesDelta(accessToken, { folder, cursor, since }) {
      const url = cursor ? assertGraphUrl(cursor).toString() : deltaUrl(folder, since);
      const response = await call(fetchImpl, accessToken, url, { headers: { Prefer: `odata.maxpagesize=${PAGE_SIZE}` } });
      const parsed = deltaSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new GraphError("unavailable", "Réponse de Microsoft Graph inattendue.");

      const next = parsed.data["@odata.nextLink"];
      const delta = parsed.data["@odata.deltaLink"];
      const nextCursor = next ?? delta;
      if (!nextCursor) throw new GraphError("unavailable", "Microsoft Graph n'a pas renvoyé de curseur.");

      return {
        messages: parsed.data.value.map((item) => ({
          id: item.id,
          internetMessageId: item.internetMessageId ?? null,
          subject: (item.subject ?? "").trim(),
          from: addressOf(item.from),
          to: addressesOf(item.toRecipients),
          cc: addressesOf(item.ccRecipients),
          receivedAt: dateOf(item.receivedDateTime),
          sentAt: dateOf(item.sentDateTime),
          webLink: item.webLink ?? null,
          sensitivity: item.sensitivity ?? "normal",
          isDraft: item.isDraft ?? false,
          removed: item["@removed"] !== undefined,
        })),
        cursor: nextCursor,
        done: next === undefined,
      };
    },

    async createSubscription(accessToken, { notificationUrl, clientState, expiresAt }) {
      const response = await call(fetchImpl, accessToken, `${GRAPH_ORIGIN}/v1.0/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeType: "created",
          notificationUrl,
          resource: "me/messages",
          expirationDateTime: expiresAt.toISOString(),
          clientState,
        }),
      });
      const parsed = subscriptionSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new GraphError("unavailable", "Réponse d'abonnement inattendue.");
      return { id: parsed.data.id, expiresAt: new Date(parsed.data.expirationDateTime) };
    },

    async renewSubscription(accessToken, id, expiresAt) {
      const response = await call(fetchImpl, accessToken, `${GRAPH_ORIGIN}/v1.0/subscriptions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }),
      });
      const parsed = subscriptionSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new GraphError("unavailable", "Réponse d'abonnement inattendue.");
      return { id: parsed.data.id, expiresAt: new Date(parsed.data.expirationDateTime) };
    },

    async deleteSubscription(accessToken, id) {
      await call(fetchImpl, accessToken, `${GRAPH_ORIGIN}/v1.0/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}
