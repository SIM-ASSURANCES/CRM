import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeltaPage, MailFolder, MailGraph, MailMessage } from "@/features/integrations/microsoft/graph";
import type { IntegrationDeps, IntegrationSetup } from "@/features/integrations/setup";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Intégration Microsoft 365 : connexion OAuth, jetons chiffrés, synchronisation des e-mails (CDC 7), sur la base dédiée
// (TEST_DATABASE_URL). Microsoft est remplacé par un faux fournisseur : aucun appel réseau.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("intégration Microsoft 365 (PostgreSQL)", () => {
  let db: Db;
  let conn: typeof import("@/features/integrations/connection");
  let sync: typeof import("@/features/integrations/sync");
  let excl: typeof import("@/features/integrations/exclusions");
  let subs: typeof import("@/features/integrations/subscriptions");
  let hook: typeof import("@/features/integrations/webhook");
  let acc: typeof import("@/features/accounts/service");
  let con: typeof import("@/features/contacts/service");
  let crypto: typeof import("@/lib/crypto");
  let GraphError: typeof import("@/features/integrations/microsoft/graph").GraphError;
  let owner: CurrentUser; // commercial de l'équipe
  let other: CurrentUser; // commercial hors équipe
  let manager: CurrentUser;
  let admin: CurrentUser;
  let audit: CurrentUser;
  let accountId: string;
  let graph: FakeGraph;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let deps: IntegrationDeps;

  const uniq = () => randomUUID().slice(0, 8);
  const now = new Date(Date.UTC(2026, 9, 15, 10, 0));
  const key = randomBytes(32);
  const setup: IntegrationSetup = {
    microsoft: { clientId: "client-test", clientSecret: "secret-test", tenant: "organizations" },
    key,
    baseUrl: "http://localhost:3100",
  };

  /** Faux Microsoft Graph : des pages et des pannes préparées par le test, et la trace des appels reçus. */
  class FakeGraph implements MailGraph {
    pages: Record<MailFolder, DeltaPage[]> = { inbox: [], sentitems: [] };
    failures: Record<MailFolder, Error[]> = { inbox: [], sentitems: [] };
    calls: { folder: MailFolder; cursor: string | null; token: string }[] = [];
    profileId = "ext-user-1";
    profileEmail = "profil@sim.test";

    async profile() {
      return { id: this.profileId, email: this.profileEmail };
    }
    async messagesDelta(token: string, input: { folder: MailFolder; cursor: string | null; since: Date }) {
      this.calls.push({ folder: input.folder, cursor: input.cursor, token });
      const failure = this.failures[input.folder].shift();
      if (failure) throw failure;
      return this.pages[input.folder].shift() ?? { messages: [], cursor: `https://graph.microsoft.com/v1.0/delta/${input.folder}-vide`, done: true };
    }
    subscriptionCalls: { notificationUrl: string; clientState: string; expiresAt: Date }[] = [];
    renewals: string[] = [];
    createFails = false;
    renewFails = false;
    private counter = 0;

    async createSubscription(_token: string, input: { notificationUrl: string; clientState: string; expiresAt: Date }) {
      if (this.createFails) throw new GraphError("unavailable", "Microsoft Graph est injoignable pour le moment.");
      this.subscriptionCalls.push(input);
      return { id: `sub-${++this.counter}-${uniq()}`, expiresAt: input.expiresAt };
    }
    async renewSubscription(_token: string, id: string, expiresAt: Date) {
      if (this.renewFails) throw new GraphError("unavailable", "abonnement introuvable");
      this.renewals.push(id);
      return { id, expiresAt };
    }
    async deleteSubscription() {}
  }

  const page = (messages: MailMessage[], done = true, cursor = `https://graph.microsoft.com/v1.0/delta/${uniq()}`): DeltaPage => ({ messages, cursor, done });

  const message = (over: Partial<MailMessage> = {}): MailMessage => ({
    id: `graph-${uniq()}`,
    internetMessageId: `<${uniq()}@mail.test>`,
    subject: "Proposition commerciale",
    from: "client@acme.ci",
    to: [owner.email],
    cc: [],
    receivedAt: new Date(Date.UTC(2026, 9, 14, 8, 30)),
    sentAt: new Date(Date.UTC(2026, 9, 14, 8, 29)),
    webLink: "https://outlook.office.com/mail/item",
    sensitivity: "normal",
    isDraft: false,
    removed: false,
    ...over,
  });

  const tokenResponse = (over: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600, scope: "Mail.ReadBasic User.Read", ...over }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  async function makeUser(role: Role, label: string, team: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, teamId: team, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: team, mustChangePassword: false };
  }

  /** Connexion déjà établie (sans passer par la page Microsoft), jetons chiffrés comme en production. */
  async function connect(user: CurrentUser, over: Record<string, unknown> = {}) {
    const id = randomUUID();
    return db.integrationConnection.create({
      data: {
        id,
        userId: user.id,
        provider: "microsoft",
        status: "active",
        accountEmail: user.email,
        externalUserId: "ext-user-1",
        scopes: "Mail.ReadBasic User.Read",
        accessTokenEnc: crypto.encryptSecret("at-initial", key, `${id}:access`),
        refreshTokenEnc: crypto.encryptSecret("rt-initial", key, `${id}:refresh`),
        accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
        syncSince: new Date(Date.UTC(2026, 8, 15)),
        consentedAt: now,
        webhookSecret: "secret-webhook",
        ...over,
      },
    });
  }

  async function contactAt(user: CurrentUser, email: string, forAccount = accountId) {
    return (await con.createContact(user, { firstName: "Awa", lastName: `Nom${uniq()}`, email, status: "active", forceDuplicate: false, accountId: forAccount })).id;
  }

  const activitiesOf = (user: CurrentUser) => db.activity.findMany({ where: { authorUserId: user.id, origin: "sync" }, orderBy: { occurredAt: "asc" } });

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    conn = await import("@/features/integrations/connection");
    sync = await import("@/features/integrations/sync");
    excl = await import("@/features/integrations/exclusions");
    subs = await import("@/features/integrations/subscriptions");
    hook = await import("@/features/integrations/webhook");
    acc = await import("@/features/accounts/service");
    con = await import("@/features/contacts/service");
    crypto = await import("@/lib/crypto");
    GraphError = (await import("@/features/integrations/microsoft/graph")).GraphError;

    const team = await db.team.create({ data: { name: `Équipe intégrations ${uniq()}` } });
    owner = await makeUser("commercial", "Commercial Intégration", team.id);
    other = await makeUser("commercial", "Commercial Étranger");
    manager = await makeUser("manager", "Manager Intégration", team.id);
    admin = await makeUser("admin", "Admin Intégration");
    audit = await makeUser("audit", "Audit Intégration");
  });

  beforeEach(async () => {
    await db.activity.deleteMany();
    await db.syncEvent.deleteMany();
    await db.integrationConnection.deleteMany();
    await db.oAuthState.deleteMany();
    await db.notification.deleteMany({ where: { source: "integration" } });
    await db.setting.deleteMany({ where: { key: "integrations.mail.excluded_domains" } });
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
    await db.task.deleteMany();
    await db.opportunityContact.deleteMany();
    await db.opportunityEvent.deleteMany();
    await db.opportunity.deleteMany();
    await db.contactRole.deleteMany();
    await db.accountContact.deleteMany();
    await db.contact.deleteMany();
    await db.crmAccount.updateMany({ data: { parentAccountId: null, mergedIntoId: null } });
    await db.crmAccount.deleteMany();

    accountId = (await acc.createAccount(owner, { legalName: `Acme ${uniq()}`, sector: "Santé", status: "client", country: "CI", forceDuplicate: false })).id;
    graph = new FakeGraph();
    fetchImpl = vi.fn(async () => tokenResponse());
    deps = { setup, graph, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now };
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("connexion OAuth (CDC 7.3)", () => {
    it("enregistre la connexion avec des jetons chiffrés, lie l'état à l'utilisateur et trace l'opération", async () => {
      const url = new URL(await conn.beginMicrosoftConnection(owner, setup, now));
      expect(url.searchParams.get("scope")).toBe("offline_access User.Read Mail.ReadBasic");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      const state = url.searchParams.get("state")!;
      const pending = await db.oAuthState.findUniqueOrThrow({ where: { state } });
      expect(pending.userId).toBe(owner.id);
      expect(pending.expiresAt.getTime()).toBe(now.getTime() + 10 * 60_000);

      graph.profileEmail = owner.email;
      const { id } = await conn.completeMicrosoftConnection(owner, { code: "code-1", state }, deps);

      const row = await db.integrationConnection.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "active", accountEmail: owner.email, externalUserId: "ext-user-1" });
      // Chiffrés : jamais en clair en base, et déchiffrables seulement avec la clé ET le bon contexte.
      expect(row.accessTokenEnc).not.toContain("at-new");
      expect(crypto.decryptSecret(row.accessTokenEnc!, key, `${id}:access`)).toBe("at-new");
      expect(crypto.decryptSecret(row.refreshTokenEnc!, key, `${id}:refresh`)).toBe("rt-new");
      expect(() => crypto.decryptSecret(row.refreshTokenEnc!, key, `${id}:access`)).toThrow();
      expect(row.syncSince.getTime()).toBe(now.getTime() - 30 * 86_400_000);

      expect(await db.oAuthState.count({ where: { state } })).toBe(0);
      expect(await db.syncEvent.count({ where: { connectionId: id, kind: "connected", status: "success" } })).toBe(1);
      const trace = await db.auditLog.findFirstOrThrow({ where: { action: "integration.connected", entityId: id } });
      expect(JSON.stringify(trace.metadata)).not.toContain("at-new");
    });

    it("refuse un état rejoué, expiré, ou celui d'un autre utilisateur", async () => {
      const state = new URL(await conn.beginMicrosoftConnection(owner, setup, now)).searchParams.get("state")!;
      await expect(conn.completeMicrosoftConnection(other, { code: "c", state }, deps)).rejects.toMatchObject({ code: "VALIDATION" });
      await conn.completeMicrosoftConnection(owner, { code: "c", state }, deps);
      await expect(conn.completeMicrosoftConnection(owner, { code: "c", state }, deps)).rejects.toMatchObject({ code: "VALIDATION" });

      const stale = new URL(await conn.beginMicrosoftConnection(owner, setup, new Date(now.getTime() - 3_600_000))).searchParams.get("state")!;
      await expect(conn.completeMicrosoftConnection(owner, { code: "c", state: stale }, deps)).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("refuse une connexion sans le droit de lecture des e-mails", async () => {
      const state = new URL(await conn.beginMicrosoftConnection(owner, setup, now)).searchParams.get("state")!;
      fetchImpl.mockResolvedValueOnce(tokenResponse({ scope: "User.Read" }));
      await expect(conn.completeMicrosoftConnection(owner, { code: "c", state }, deps)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await db.integrationConnection.count({ where: { userId: owner.id } })).toBe(0);
    });

    it("reconnecter le même compte conserve les curseurs ; un autre compte repart de zéro", async () => {
      const existing = await connect(owner, { cursors: { inbox: "https://graph.microsoft.com/v1.0/delta/ancien" } });

      const same = new URL(await conn.beginMicrosoftConnection(owner, setup, now)).searchParams.get("state")!;
      await conn.completeMicrosoftConnection(owner, { code: "c", state: same }, deps);
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: existing.id } })).cursors).toEqual({ inbox: "https://graph.microsoft.com/v1.0/delta/ancien" });

      graph.profileId = "ext-user-2";
      const changed = new URL(await conn.beginMicrosoftConnection(owner, setup, now)).searchParams.get("state")!;
      await conn.completeMicrosoftConnection(owner, { code: "c", state: changed }, deps);
      const row = await db.integrationConnection.findUniqueOrThrow({ where: { id: existing.id } });
      expect(row.cursors).toEqual({});
      expect(row.externalUserId).toBe("ext-user-2");
    });

    it("réserve la connexion aux profils autorisés (l'audit n'a pas d'accès)", async () => {
      await expect(conn.beginMicrosoftConnection(audit, setup, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(conn.getMyConnection(audit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("la déconnexion efface les jetons, arrête la lecture et garde les activités déjà importées", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      graph.pages.inbox = [page([message()])];
      await sync.syncConnection(row.id, "manual", deps);
      expect(await activitiesOf(owner)).toHaveLength(1);

      await conn.disconnectMicrosoft(owner, deps);
      const after = await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, webhookSecret: null, cursors: {} });
      expect((await sync.syncConnection(row.id, "manual", deps)).status).toBe("skipped");
      expect(await activitiesOf(owner)).toHaveLength(1);
      expect(await db.auditLog.count({ where: { action: "integration.disconnected", entityId: row.id } })).toBe(1);
    });
  });

  describe("synchronisation des e-mails (CDC 7.1)", () => {
    it("crée une activité « e-mail » pour un message reçu d'un contact connu, avec lien et origine « synchronisation »", async () => {
      const row = await connect(owner);
      const contactId = await contactAt(owner, "client@acme.ci");
      const received = message({ subject: "Devis santé", webLink: "https://outlook.office.com/mail/abc" });
      graph.pages.inbox = [page([received])];

      const outcome = await sync.syncConnection(row.id, "manual", deps);
      expect(outcome).toMatchObject({ status: "success", fetched: 1, imported: 1, skipped: 0, duplicates: 0 });

      const [activity] = await activitiesOf(owner);
      expect(activity).toMatchObject({
        type: "email",
        subject: "Devis santé",
        accountId,
        contactId,
        origin: "sync",
        externalProvider: "microsoft",
        externalUrl: "https://outlook.office.com/mail/abc",
        outcome: "Reçu de client@acme.ci",
      });
      expect(activity.externalId).toBe(`msgid:${received.internetMessageId!.replace(/^<|>$/g, "")}`);
      expect(activity.occurredAt.getTime()).toBe(received.receivedAt!.getTime());
    });

    it("résume un message envoyé (destinataires) et le date à l'envoi", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      const sent = message({ from: owner.email, to: ["client@acme.ci", "autre@exemple.ci"], receivedAt: new Date(Date.UTC(2026, 9, 14, 9)), sentAt: new Date(Date.UTC(2026, 9, 14, 8, 55)) });
      graph.pages.sentitems = [page([sent])];

      await sync.syncConnection(row.id, "manual", deps);
      const [activity] = await activitiesOf(owner);
      expect(activity.outcome).toBe("Envoyé à client@acme.ci, autre@exemple.ci");
      expect(activity.occurredAt.getTime()).toBe(sent.sentAt!.getTime());
    });

    it("est idempotente : relire les mêmes messages ne crée rien de plus, et un message présent dans deux dossiers compte une fois", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      const shared = message({ from: "client@acme.ci" });
      graph.pages.inbox = [page([shared])];
      graph.pages.sentitems = [page([{ ...shared, id: "autre-id-graph" }])];

      const first = await sync.syncConnection(row.id, "manual", deps);
      expect(first).toMatchObject({ imported: 1, duplicates: 1 });

      // Resynchronisation complète (curseurs perdus) : mêmes messages → aucun doublon.
      await db.integrationConnection.update({ where: { id: row.id }, data: { cursors: {} } });
      graph.pages.inbox = [page([shared])];
      const second = await sync.syncConnection(row.id, "manual", deps);
      expect(second).toMatchObject({ imported: 0, duplicates: 1 });
      expect(await activitiesOf(owner)).toHaveLength(1);
    });

    it("n'importe pas les brouillons, messages privés, supprimés, inconnus ni les domaines exclus", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      await contactAt(owner, "ami@perso.fr");
      await excl.updateExcludedDomains(admin, "perso.fr");

      graph.pages.inbox = [
        page([
          message({ isDraft: true }),
          message({ sensitivity: "private" }),
          message({ sensitivity: "personal" }),
          message({ removed: true }),
          message({ from: "inconnu@nulle-part.com" }),
          message({ from: "ami@perso.fr" }),
          message({ from: "client@acme.ci", subject: "Le seul retenu" }),
        ]),
      ];
      const outcome = await sync.syncConnection(row.id, "manual", deps);

      expect(outcome).toMatchObject({ fetched: 7, imported: 1, skipped: 6 });
      expect((await activitiesOf(owner)).map((a) => a.subject)).toEqual(["Le seul retenu"]);
    });

    it("respecte le périmètre : un contact d'un compte hors périmètre n'est jamais journalisé", async () => {
      const foreignAccount = (await acc.createAccount(other, { legalName: `Étranger ${uniq()}`, sector: "Banque et finance", status: "client", country: "CI", forceDuplicate: false })).id;
      await contactAt(other, "secret@etranger.ci", foreignAccount);
      const row = await connect(owner);
      graph.pages.inbox = [page([message({ from: "secret@etranger.ci" })])];

      const outcome = await sync.syncConnection(row.id, "manual", deps);
      expect(outcome).toMatchObject({ imported: 0, skipped: 1 });
      expect(await db.activity.count({ where: { accountId: foreignAccount } })).toBe(0);
    });

    it("un manager retrouve les comptes de son équipe ; un contact partagé par deux comptes donne deux activités", async () => {
      const second = (await acc.createAccount(owner, { legalName: `Second ${uniq()}`, sector: "Santé", status: "client", country: "CI", forceDuplicate: false })).id;
      const contactId = await contactAt(owner, "client@acme.ci");
      await db.accountContact.create({ data: { accountId: second, contactId } });

      const row = await connect(manager);
      graph.pages.inbox = [page([message({ from: "client@acme.ci", to: [manager.email] })])];
      const outcome = await sync.syncConnection(row.id, "manual", deps);

      expect(outcome.imported).toBe(2);
      const accounts = (await activitiesOf(manager)).map((a) => a.accountId).sort();
      expect(accounts).toEqual([accountId, second].sort());
    });

    it("enregistre le curseur à chaque page, puis le réutilise à la synchronisation suivante", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      graph.pages.inbox = [page([message()], false, "https://graph.microsoft.com/v1.0/next/1"), page([message()], true, "https://graph.microsoft.com/v1.0/delta/final")];

      await sync.syncConnection(row.id, "manual", deps);
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).cursors).toMatchObject({ inbox: "https://graph.microsoft.com/v1.0/delta/final" });
      expect(graph.calls.filter((c) => c.folder === "inbox").map((c) => c.cursor)).toEqual([null, "https://graph.microsoft.com/v1.0/next/1"]);

      graph.calls = [];
      await sync.syncConnection(row.id, "manual", deps);
      expect(graph.calls.find((c) => c.folder === "inbox")?.cursor).toBe("https://graph.microsoft.com/v1.0/delta/final");
    });

    it("repart d'une synchronisation complète quand le curseur est perdu (410)", async () => {
      const row = await connect(owner, { cursors: { inbox: "https://graph.microsoft.com/v1.0/delta/perime" } });
      await contactAt(owner, "client@acme.ci");
      graph.failures.inbox = [new GraphError("gone", "périmé")];
      graph.pages.inbox = [page([message()])];

      const outcome = await sync.syncConnection(row.id, "manual", deps);
      expect(outcome).toMatchObject({ status: "success", imported: 1 });
      expect(graph.calls.filter((c) => c.folder === "inbox").map((c) => c.cursor)).toEqual(["https://graph.microsoft.com/v1.0/delta/perime", null]);
    });

    it("signale une limitation de débit comme une synchronisation partielle, sans basculer la connexion en erreur", async () => {
      const row = await connect(owner);
      graph.failures.inbox = [new GraphError("throttled", "trop", 45)];

      const outcome = await sync.syncConnection(row.id, "manual", deps);
      expect(outcome.status).toBe("partial");
      expect(outcome.message).toContain("45 s");
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("active");
    });

    it("renouvelle une fois le jeton refusé (401) puis relit ; un second refus demande la reconnexion", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      graph.failures.inbox = [new GraphError("unauthorized", "401")];
      graph.pages.inbox = [page([message()])];

      const ok = await sync.syncConnection(row.id, "manual", deps);
      expect(ok).toMatchObject({ status: "success", imported: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(graph.calls.filter((c) => c.folder === "inbox").map((c) => c.token)).toEqual(["at-initial", "at-new"]);
      // Jeton d'actualisation tourné : le nouveau remplace l'ancien, toujours chiffré.
      const rotated = await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
      expect(crypto.decryptSecret(rotated.refreshTokenEnc!, key, `${row.id}:refresh`)).toBe("rt-new");

      graph.failures.inbox = [new GraphError("unauthorized", "401"), new GraphError("unauthorized", "401")];
      const refused = await sync.syncConnection(row.id, "manual", deps);
      expect(refused.status).toBe("error");
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("needs_reconnect");
    });

    it("passe la connexion à « À reconnecter » quand Microsoft révoque l'accès, prévient l'utilisateur une seule fois et journalise", async () => {
      const row = await connect(owner, { accessTokenExpiresAt: new Date(now.getTime() - 60_000) });
      fetchImpl.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "Content-Type": "application/json" } }));

      const outcome = await sync.syncConnection(row.id, "schedule", deps);
      expect(outcome).toMatchObject({ status: "error", message: "Reconnexion Microsoft nécessaire." });
      expect(graph.calls).toHaveLength(0);

      const after = await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe("needs_reconnect");
      expect(after.lastError).toBeTruthy();
      expect(await db.notification.count({ where: { userId: owner.id, source: "integration" } })).toBe(1);
      expect(await db.syncEvent.count({ where: { connectionId: row.id, kind: "token_refresh", status: "error" } })).toBe(1);

      // Une connexion à reconnecter n'est plus lue, et la notification n'est pas répétée.
      expect((await sync.syncConnection(row.id, "schedule", deps)).status).toBe("skipped");
      await conn.markNeedsReconnect(row.id, "encore", now);
      expect(await db.notification.count({ where: { userId: owner.id, source: "integration" } })).toBe(1);
    });

    it("traite une clé de chiffrement modifiée comme une reconnexion à faire, sans exposer de détail", async () => {
      const row = await connect(owner, { accessTokenExpiresAt: new Date(now.getTime() - 60_000) });
      const wrong: IntegrationDeps = { ...deps, setup: { ...setup, key: randomBytes(32) } };

      const outcome = await sync.syncConnection(row.id, "manual", wrong);
      expect(outcome.status).toBe("error");
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("needs_reconnect");
    });

    it("une seule synchronisation à la fois par connexion ; un verrou orphelin est repris", async () => {
      const row = await connect(owner, { syncingSince: new Date(now.getTime() - 60_000) });
      expect((await sync.syncConnection(row.id, "manual", deps)).status).toBe("skipped");
      expect(graph.calls).toHaveLength(0);

      await db.integrationConnection.update({ where: { id: row.id }, data: { syncingSince: new Date(now.getTime() - 3_600_000) } });
      expect((await sync.syncConnection(row.id, "manual", deps)).status).toBe("success");
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).syncingSince).toBeNull();
    });

    it("journalise chaque synchronisation (compteurs, déclencheur, durée) et met à jour l'état de la connexion", async () => {
      const row = await connect(owner);
      await contactAt(owner, "client@acme.ci");
      graph.pages.inbox = [page([message(), message({ from: "inconnu@x.com" })])];
      await sync.syncConnection(row.id, "schedule", deps);

      const event = await db.syncEvent.findFirstOrThrow({ where: { connectionId: row.id, kind: "mail_sync" } });
      expect(event).toMatchObject({ trigger: "schedule", status: "success", fetched: 2, imported: 1, skipped: 1, duplicates: 0, error: null });
      expect(event.finishedAt).not.toBeNull();
      const after = await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.lastSuccessAt?.getTime()).toBe(now.getTime());
      expect(after.lastError).toBeNull();

      const mine = await conn.listMyEvents(owner);
      expect(mine[0]).toMatchObject({ kind: "mail_sync", imported: 1 });
      expect(await conn.listMyEvents(other)).toEqual([]);
    });

    it("la synchronisation manuelle exige une connexion active et respecte un délai minimal", async () => {
      await expect(sync.syncMyMailbox(owner, deps)).rejects.toMatchObject({ code: "VALIDATION" });

      const row = await connect(owner, { status: "needs_reconnect" });
      await expect(sync.syncMyMailbox(owner, deps)).rejects.toMatchObject({ code: "VALIDATION" });

      await db.integrationConnection.update({ where: { id: row.id }, data: { status: "active", lastSyncAt: new Date(now.getTime() - 5_000) } });
      await expect(sync.syncMyMailbox(owner, deps)).rejects.toMatchObject({ code: "RATE_LIMITED" });

      await db.integrationConnection.update({ where: { id: row.id }, data: { lastSyncAt: new Date(now.getTime() - 120_000) } });
      expect((await sync.syncMyMailbox(owner, deps)).status).toBe("success");
      await expect(sync.syncMyMailbox(audit, deps)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("l'exécution planifiée ne traite que les connexions échues, actives, ou signalées par un webhook", async () => {
      await connect(owner, { lastSyncAt: new Date(now.getTime() - 20 * 60_000) });
      const recent = await connect(manager, { lastSyncAt: new Date(now.getTime() - 2 * 60_000) });
      const inactive = await connect(other, { status: "needs_reconnect" });

      const first = await sync.runDueSyncs(deps);
      expect(first).toMatchObject({ processed: 1, success: 1 });
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: recent.id } })).lastSyncAt?.getTime()).toBe(now.getTime() - 2 * 60_000);
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: inactive.id } })).lastSyncAt).toBeNull();

      // Un webhook signale la connexion récente : elle est reprise tout de suite, et la demande est soldée ensuite.
      await db.integrationConnection.update({ where: { id: recent.id }, data: { syncRequestedAt: new Date(now.getTime() - 1_000) } });
      const second = await sync.runDueSyncs(deps);
      expect(second.processed).toBe(1);
      const solved = await db.integrationConnection.findUniqueOrThrow({ where: { id: recent.id } });
      expect(solved.syncRequestedAt).toBeNull();
      expect(await db.syncEvent.count({ where: { connectionId: recent.id, trigger: "webhook" } })).toBe(1);
    });
  });

  describe("notifications Microsoft et abonnements (CDC 7.3)", () => {
    const publicDeps = (): IntegrationDeps => ({ ...deps, setup: { ...setup, baseUrl: "https://crm.example.test" } });

    it("crée un abonnement avec le secret de la connexion, le laisse tel quel, puis le renouvelle avant son expiration", async () => {
      const row = await connect(owner);
      expect(await subs.ensureSubscription(row.id, publicDeps())).toBe("created");

      const created = await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
      expect(created.subscriptionId).toBeTruthy();
      expect(created.subscriptionExpiresAt?.getTime()).toBe(now.getTime() + 4200 * 60_000);
      expect(graph.subscriptionCalls[0]).toMatchObject({
        notificationUrl: "https://crm.example.test/api/integrations/microsoft/webhook",
        clientState: "secret-webhook",
      });

      expect(await subs.ensureSubscription(row.id, publicDeps())).toBe("unchanged");

      await db.integrationConnection.update({ where: { id: row.id }, data: { subscriptionExpiresAt: new Date(now.getTime() + 3_600_000) } });
      expect(await subs.ensureSubscription(row.id, publicDeps())).toBe("renewed");
      expect(graph.renewals).toEqual([created.subscriptionId]);
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).subscriptionId).toBe(created.subscriptionId);
    });

    it("recrée l'abonnement quand Microsoft ne le retrouve plus", async () => {
      const row = await connect(owner, { subscriptionId: "sub-disparu", subscriptionExpiresAt: new Date(now.getTime() + 3_600_000) });
      graph.renewFails = true;

      expect(await subs.ensureSubscription(row.id, publicDeps())).toBe("created");
      const after = await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.subscriptionId).not.toBe("sub-disparu");
    });

    it("ignore l'abonnement quand l'adresse du CRM n'est pas publique (développement local)", async () => {
      const row = await connect(owner);
      expect(await subs.ensureSubscription(row.id, deps)).toBe("skipped");
      expect(await subs.maintainSubscriptions(deps)).toEqual({ created: 0, renewed: 0, unchanged: 0, skipped: 0, unavailable: 0 });
      expect(graph.subscriptionCalls).toHaveLength(0);
    });

    it("un échec d'abonnement n'est pas bloquant et n'est inscrit qu'une fois par période", async () => {
      const row = await connect(owner);
      graph.createFails = true;

      expect(await subs.ensureSubscription(row.id, publicDeps())).toBe("unavailable");
      expect(await subs.ensureSubscription(row.id, publicDeps())).toBe("unavailable");
      expect(await db.syncEvent.count({ where: { connectionId: row.id, kind: "subscription", status: "error" } })).toBe(1);
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("active");
      // La synchronisation régulière continue de fonctionner sans abonnement.
      expect((await sync.syncConnection(row.id, "schedule", deps)).status).toBe("success");
    });

    it("l'entretien ne traite que les connexions actives sans abonnement ou qui expire bientôt", async () => {
      const missing = await connect(owner);
      await connect(manager, { subscriptionId: "sub-ok", subscriptionExpiresAt: new Date(now.getTime() + 48 * 3_600_000) });
      await connect(other, { status: "needs_reconnect" });

      expect(await subs.maintainSubscriptions(publicDeps())).toMatchObject({ created: 1, renewed: 0, unavailable: 0 });
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: missing.id } })).subscriptionId).toBeTruthy();
    });

    it("le webhook ne signale la connexion qu'avec le bon secret, et ne lit jamais la boîte lui-même", async () => {
      const row = await connect(owner, { subscriptionId: "sub-x", subscriptionExpiresAt: new Date(now.getTime() + 3_600_000) });
      const flagged = async () => (await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).syncRequestedAt;

      expect(await hook.handleNotifications({ value: [{ subscriptionId: "sub-x", clientState: "mauvais-secret" }] }, now)).toEqual({ valid: true, flagged: 0 });
      expect(await hook.handleNotifications({ value: [{ subscriptionId: "sub-x" }] }, now)).toEqual({ valid: true, flagged: 0 });
      expect(await hook.handleNotifications({ value: [{ subscriptionId: "inconnu", clientState: "secret-webhook" }] }, now)).toEqual({ valid: true, flagged: 0 });
      expect(await flagged()).toBeNull();

      expect(await hook.handleNotifications({ value: [{ subscriptionId: "sub-x", clientState: "secret-webhook" }, { subscriptionId: "sub-x", clientState: "secret-webhook" }] }, now)).toEqual({
        valid: true,
        flagged: 1,
      });
      expect((await flagged())?.getTime()).toBe(now.getTime());
      expect(graph.calls).toHaveLength(0);
    });

    it("refuse un corps mal formé et ignore une connexion déconnectée", async () => {
      expect((await hook.handleNotifications({ pas: "de value" })).valid).toBe(false);
      expect((await hook.handleNotifications("texte")).valid).toBe(false);
      expect((await hook.handleNotifications({ value: [{ subscriptionId: "" }] })).valid).toBe(false);
      expect((await hook.handleNotifications({ value: Array.from({ length: 201 }, () => ({ subscriptionId: "x" })) })).valid).toBe(false);

      const row = await connect(owner, { status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null, subscriptionId: "sub-revoque" });
      expect(await hook.handleNotifications({ value: [{ subscriptionId: "sub-revoque", clientState: "secret-webhook" }] }, now)).toEqual({ valid: true, flagged: 0 });
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).syncRequestedAt).toBeNull();
    });

    it("de la notification à l'activité : le webhook demande, la synchronisation planifiée relit et importe", async () => {
      const row = await connect(owner, { subscriptionId: "sub-y", lastSyncAt: new Date(now.getTime() - 60_000) });
      await contactAt(owner, "client@acme.ci");
      graph.pages.inbox = [page([message()])];

      // Lue il y a une minute : la synchronisation planifiée n'a rien à faire…
      expect((await sync.runDueSyncs(deps)).processed).toBe(0);
      // … jusqu'à ce que Microsoft prévienne.
      await hook.handleNotifications({ value: [{ subscriptionId: "sub-y", clientState: "secret-webhook" }] }, new Date(now.getTime() - 1_000));
      const summary = await sync.runDueSyncs(deps);

      expect(summary).toMatchObject({ processed: 1, success: 1, imported: 1 });
      expect(await db.syncEvent.count({ where: { connectionId: row.id, kind: "mail_sync", trigger: "webhook" } })).toBe(1);
      expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: row.id } })).syncRequestedAt).toBeNull();
    });
  });

  describe("vue d'ensemble (REC-11)", () => {
    it("liste les connexions de tous, à reconnecter d'abord, sans aucun jeton, pour l'administration et l'audit seulement", async () => {
      await connect(owner);
      const broken = await connect(manager, { status: "needs_reconnect", lastError: "Accès retiré" });

      const rows = await conn.listConnectionsOverview(admin, now);
      expect(rows.map((row) => row.id)[0]).toBe(broken.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ status: "needs_reconnect", lastError: "Accès retiré", userEmail: manager.email });
      expect(JSON.stringify(rows)).not.toMatch(/at-initial|rt-initial|secret-webhook|v1\./);

      expect(await conn.listConnectionsOverview(audit, now)).toHaveLength(2);
      await expect(conn.listConnectionsOverview(owner, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(conn.listConnectionsOverview(manager, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("domaines exclus (CDC 7.1)", () => {
    it("normalise la liste, la trace à l'audit et la réserve à l'administrateur", async () => {
      const result = await excl.updateExcludedDomains(admin, "Perso.FR, @gmail.com\nhttps://banque.ci/page  perso.fr");
      expect(result.domains).toEqual(["perso.fr", "gmail.com", "banque.ci"]);
      expect(await excl.getExcludedDomains()).toEqual(["perso.fr", "gmail.com", "banque.ci"]);
      expect(await db.auditLog.count({ where: { action: "integration.exclusions_updated", actorUserId: admin.id } })).toBeGreaterThan(0);

      await expect(excl.updateExcludedDomains(owner, "x.fr")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(excl.updateExcludedDomains(admin, "pas un domaine")).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});
