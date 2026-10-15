import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/crypto";
import { assertGraphUrl, createHttpMailGraph, GraphError, type MailMessage } from "@/features/integrations/microsoft/graph";
import { authorizeUrl, exchangeCode, generatePkce, MICROSOFT_SCOPES, OAuthError, refreshAccessToken } from "@/features/integrations/microsoft/oauth";
import { counterparts, dedupeKey, describeMessage, domainOf, isExcludedAddress, messageDate, parseDomainList, safeWebLink, skipReason } from "@/features/integrations/rules";

// Briques pures de l'intégration Microsoft : chiffrement, règles de tri des e-mails, OAuth et client Graph (fetch simulé).

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const mail = (over: Partial<MailMessage> = {}): MailMessage => ({
  id: "g1",
  internetMessageId: "<ABC@Mail.Test>",
  subject: "Objet",
  from: "client@acme.ci",
  to: ["moi@sim.ci"],
  cc: [],
  receivedAt: new Date("2026-10-14T08:30:00Z"),
  sentAt: new Date("2026-10-14T08:29:00Z"),
  webLink: null,
  sensitivity: "normal",
  isDraft: false,
  removed: false,
  ...over,
});

describe("chiffrement des secrets (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("chiffre puis déchiffre, avec un résultat différent à chaque fois", () => {
    const a = encryptSecret("jeton-secret", key, "conn:access");
    const b = encryptSecret("jeton-secret", key, "conn:access");
    expect(a).not.toBe(b);
    expect(a).not.toContain("jeton-secret");
    expect(a.startsWith("v1.")).toBe(true);
    expect(decryptSecret(a, key, "conn:access")).toBe("jeton-secret");
  });

  it("refuse un mauvais contexte, une autre clé, une altération et un format inconnu, avec un message générique", () => {
    const payload = encryptSecret("jeton-secret", key, "conn:access");
    expect(() => decryptSecret(payload, key, "conn:refresh")).toThrow("Secret chiffré illisible.");
    expect(() => decryptSecret(payload, randomBytes(32), "conn:access")).toThrow("Secret chiffré illisible.");
    const [v, iv, tag, data] = payload.split(".");
    const flipped = `${v}.${iv}.${tag}.${data.slice(0, -2)}${data.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => decryptSecret(flipped, key, "conn:access")).toThrow("Secret chiffré illisible.");
    expect(() => decryptSecret("v2.a.b.c", key, "conn:access")).toThrow("Secret chiffré illisible.");
    expect(() => decryptSecret("n'importe quoi", key, "conn:access")).toThrow("Secret chiffré illisible.");
  });

  it("n'accepte qu'une clé de 32 octets", () => {
    expect(parseKey(randomBytes(32).toString("base64")).length).toBe(32);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow();
  });
});

describe("règles de tri des e-mails (CDC 7.1)", () => {
  it("extrait le domaine d'une adresse, en minuscules", () => {
    expect(domainOf("Marie@Client.CI")).toBe("client.ci");
    expect(domainOf("sans-arobase")).toBeNull();
    expect(domainOf("@seul.ci")).toBeNull();
    expect(domainOf("fin@")).toBeNull();
  });

  it("exclut un domaine et ses sous-domaines, mais pas un domaine qui lui ressemble ; une adresse invalide est exclue", () => {
    const excluded = ["banque.ci"];
    expect(isExcludedAddress("a@banque.ci", excluded)).toBe(true);
    expect(isExcludedAddress("a@filiale.banque.ci", excluded)).toBe(true);
    expect(isExcludedAddress("a@autrebanque.ci", excluded)).toBe(false);
    expect(isExcludedAddress("a@banque.ci.evil.com", excluded)).toBe(false);
    expect(isExcludedAddress("invalide", excluded)).toBe(true);
    expect(isExcludedAddress("a@x.ci", [])).toBe(false);
  });

  it("préfère le Message-ID international (sans chevrons, en minuscules) à l'identifiant Graph", () => {
    expect(dedupeKey(mail())).toBe("msgid:abc@mail.test");
    expect(dedupeKey(mail({ id: "autre-id" }))).toBe("msgid:abc@mail.test");
    expect(dedupeKey(mail({ internetMessageId: null, id: "g9" }))).toBe("graph:g9");
    expect(dedupeKey(mail({ internetMessageId: "  ", id: "g9" }))).toBe("graph:g9");
  });

  it("écarte brouillons, messages supprimés, privés ou sans date", () => {
    expect(skipReason(mail())).toBeNull();
    expect(skipReason(mail({ removed: true }))).toBe("removed");
    expect(skipReason(mail({ isDraft: true }))).toBe("draft");
    for (const sensitivity of ["personal", "private", "confidential"]) expect(skipReason(mail({ sensitivity }))).toBe("private");
    expect(skipReason(mail({ receivedAt: null, sentAt: null }))).toBe("undated");
  });

  it("date un message envoyé à l'envoi et un message reçu à la réception", () => {
    expect(messageDate(mail({ from: "moi@sim.ci" }), "moi@sim.ci")).toEqual(new Date("2026-10-14T08:29:00Z"));
    expect(messageDate(mail(), "moi@sim.ci")).toEqual(new Date("2026-10-14T08:30:00Z"));
    expect(messageDate(mail({ receivedAt: null }), "moi@sim.ci")).toEqual(new Date("2026-10-14T08:29:00Z"));
  });

  it("retient les interlocuteurs : sans soi-même, sans doublon, sans domaine exclu", () => {
    const message = mail({ from: "client@acme.ci", to: ["moi@sim.ci", "client@acme.ci", "x@perso.fr"], cc: ["y@acme.ci"] });
    expect(counterparts(message, "moi@sim.ci", ["perso.fr"])).toEqual(["client@acme.ci", "y@acme.ci"]);
    expect(counterparts(mail({ from: null, to: [] }), "moi@sim.ci", [])).toEqual([]);
  });

  it("ne conserve qu'un lien https valide vers le message d'origine", () => {
    expect(safeWebLink("https://outlook.office.com/mail/item?x=1")).toBe("https://outlook.office.com/mail/item?x=1");
    for (const unsafe of ["javascript:alert(1)", "data:text/html,<b>", "http://outlook.office.com/x", "//evil.example", "pas une adresse", "", null, undefined]) {
      expect(safeWebLink(unsafe)).toBeNull();
    }
    expect(safeWebLink(`https://outlook.office.com/${"a".repeat(2100)}`)).toBeNull();
  });

  it("résume l'échange sans en révéler le contenu", () => {
    expect(describeMessage(mail(), "moi@sim.ci")).toBe("Reçu de client@acme.ci");
    expect(describeMessage(mail({ from: null }), "moi@sim.ci")).toBe("Reçu de expéditeur inconnu");
    const sent = mail({ from: "moi@sim.ci", to: ["a@x.ci", "b@x.ci", "c@x.ci"], cc: ["d@x.ci", "e@x.ci"] });
    expect(describeMessage(sent, "moi@sim.ci")).toBe("Envoyé à a@x.ci, b@x.ci, c@x.ci (+2)");
  });

  it("normalise une liste de domaines saisie à la main et signale les valeurs invalides", () => {
    expect(parseDomainList("Perso.FR, @gmail.com\nhttps://banque.ci/page  perso.fr;")).toEqual({ domains: ["perso.fr", "gmail.com", "banque.ci"], invalid: [] });
    const result = parseDomainList("ok.ci pas-un-domaine a_b.ci");
    expect(result.domains).toEqual(["ok.ci"]);
    expect(result.invalid).toEqual(["pas-un-domaine", "a_b.ci"]);
    expect(parseDomainList("  \n ")).toEqual({ domains: [], invalid: [] });
  });
});

describe("OAuth Microsoft (CDC 7.3)", () => {
  const config = { clientId: "cid", clientSecret: "csecret", tenant: "contoso" };

  it("génère un défi PKCE S256 cohérent avec son vérificateur", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(generatePkce().verifier).not.toBe(verifier);
  });

  it("demande les droits minimaux : en-têtes des e-mails seulement, jamais Mail.Read ni Mail.Send", () => {
    expect(MICROSOFT_SCOPES).toEqual(["offline_access", "User.Read", "Mail.ReadBasic"]);
    const url = new URL(authorizeUrl(config, { redirectUri: "https://crm.test/cb", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/contoso/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access User.Read Mail.ReadBasic");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.search).not.toContain("csecret");
  });

  it("échange le code et calcule l'expiration à partir de l'horloge fournie", async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "Mail.ReadBasic" }));
    const now = new Date("2026-10-15T10:00:00Z");
    const tokens = await exchangeCode(config, { code: "code", redirectUri: "https://crm.test/cb", verifier: "ver" }, fetchImpl as unknown as typeof fetch, now);

    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: new Date("2026-10-15T11:00:00Z"), scope: "Mail.ReadBasic" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/contoso/oauth2/v2.0/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("ver");
  });

  it("classe les échecs : consentement révoqué, application mal configurée, panne passagère", async () => {
    const attempt = (response: () => Promise<Response>) => refreshAccessToken(config, "rt", vi.fn(response) as unknown as typeof fetch);
    await expect(attempt(async () => json({ error: "invalid_grant", error_description: "AADSTS70008 trace-id" }, 400))).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(attempt(async () => json({ error: "invalid_client" }, 401))).rejects.toMatchObject({ code: "invalid_client" });
    await expect(attempt(async () => json({ error: "temporarily_unavailable" }, 503))).rejects.toMatchObject({ code: "unavailable" });
    await expect(attempt(async () => json({ pas: "de jeton" }))).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      attempt(async () => {
        throw new TypeError("réseau coupé");
      }),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("ne reprend jamais le texte d'erreur de Microsoft dans le message affiché", async () => {
    const failing = vi.fn(async () => json({ error: "invalid_grant", error_description: "AADSTS70008 Trace ID: secret-trace" }, 400));
    const error = await refreshAccessToken(config, "rt", failing as unknown as typeof fetch).catch((e: Error) => e);
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as Error).message).toMatch(/reconnectez-vous/);
    expect((error as Error).message).not.toContain("secret-trace");
  });
});

describe("client Microsoft Graph", () => {
  const since = new Date("2026-09-15T00:00:00Z");

  it("lit une page de messages et distingue page suivante et curseur final", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        value: [
          {
            id: "m1",
            internetMessageId: "<a@b>",
            subject: "  Devis  ",
            from: { emailAddress: { address: "Client@Acme.CI" } },
            toRecipients: [{ emailAddress: { address: "Moi@SIM.ci" } }],
            ccRecipients: [{ emailAddress: {} }],
            receivedDateTime: "2026-10-14T08:30:00Z",
            sentDateTime: "pas une date",
            webLink: "https://outlook.office.com/x",
            sensitivity: "private",
            isDraft: true,
          },
          { id: "m2", "@removed": { reason: "deleted" } },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
      }),
    );
    const page = await createHttpMailGraph(fetchImpl as unknown as typeof fetch).messagesDelta("tok", { folder: "inbox", cursor: null, since });

    expect(page.done).toBe(false);
    expect(page.cursor).toBe("https://graph.microsoft.com/v1.0/next");
    expect(page.messages[0]).toMatchObject({
      id: "m1",
      subject: "Devis",
      from: "client@acme.ci",
      to: ["moi@sim.ci"],
      cc: [],
      receivedAt: new Date("2026-10-14T08:30:00Z"),
      sentAt: null,
      sensitivity: "private",
      isDraft: true,
      removed: false,
    });
    expect(page.messages[1]).toMatchObject({ id: "m2", removed: true, sensitivity: "normal" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/me/mailFolders/inbox/messages/delta");
    expect(decodeURIComponent(url)).toContain("receivedDateTime ge 2026-09-15T00:00:00.000Z");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");

    const final = createHttpMailGraph(vi.fn(async () => json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta/x" })) as unknown as typeof fetch);
    expect(await final.messagesDelta("tok", { folder: "sentitems", cursor: null, since })).toMatchObject({ done: true, cursor: "https://graph.microsoft.com/v1.0/delta/x" });
  });

  it("traduit les codes HTTP : 401 jeton refusé, 410 curseur perdu, 429 avec délai, autres pannes", async () => {
    const run = (response: Response) =>
      createHttpMailGraph(vi.fn(async () => response) as unknown as typeof fetch).messagesDelta("tok", { folder: "inbox", cursor: null, since });

    await expect(run(new Response(null, { status: 401 }))).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(run(new Response(null, { status: 410 }))).rejects.toMatchObject({ kind: "gone" });
    await expect(run(new Response(null, { status: 429, headers: { "Retry-After": "45" } }))).rejects.toMatchObject({ kind: "throttled", retryAfterSeconds: 45 });
    await expect(run(new Response(null, { status: 429 }))).rejects.toMatchObject({ kind: "throttled", retryAfterSeconds: 30 });
    await expect(run(new Response(null, { status: 503 }))).rejects.toMatchObject({ kind: "unavailable" });
    await expect(run(json({ value: [] }))).rejects.toMatchObject({ kind: "unavailable" });
    await expect(run(json({ inattendu: true }))).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("n'envoie jamais le jeton vers une adresse qui n'est pas Microsoft Graph (curseur altéré en base)", async () => {
    const fetchImpl = vi.fn(async () => json({ value: [] }));
    const graph = createHttpMailGraph(fetchImpl as unknown as typeof fetch);
    for (const cursor of ["https://evil.example/steal", "http://graph.microsoft.com/v1.0/x", "pas une adresse", "https://graph.microsoft.com.evil.example/x"]) {
      await expect(graph.messagesDelta("tok", { folder: "inbox", cursor, since })).rejects.toMatchObject({ kind: "gone" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => assertGraphUrl("https://graph.microsoft.com/v1.0/delta/ok")).not.toThrow();
    expect(() => assertGraphUrl("https://evil.example")).toThrow(GraphError);
  });

  it("lit le profil et gère les abonnements", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/me?")) return json({ id: "u1", mail: null, userPrincipalName: "Moi@SIM.ci" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return json({ id: "sub1", expirationDateTime: "2026-10-18T10:00:00Z" });
    });
    const graph = createHttpMailGraph(fetchImpl as unknown as typeof fetch);

    expect(await graph.profile("tok")).toEqual({ id: "u1", email: "moi@sim.ci" });
    const created = await graph.createSubscription("tok", { notificationUrl: "https://crm.test/hook", clientState: "cs", expiresAt: new Date("2026-10-18T10:00:00Z") });
    expect(created).toEqual({ id: "sub1", expiresAt: new Date("2026-10-18T10:00:00Z") });
    const sent = JSON.parse((fetchImpl.mock.calls.find(([, init]) => init?.method === "POST")![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ changeType: "created", resource: "me/messages", clientState: "cs", notificationUrl: "https://crm.test/hook" });
    expect((await graph.renewSubscription("tok", "sub1", new Date("2026-10-19T10:00:00Z"))).id).toBe("sub1");
    await expect(graph.deleteSubscription("tok", "sub1")).resolves.toBeUndefined();

    await expect(createHttpMailGraph(vi.fn(async () => json({ id: "u1" })) as unknown as typeof fetch).profile("tok")).rejects.toMatchObject({ kind: "unavailable" });
  });
});
