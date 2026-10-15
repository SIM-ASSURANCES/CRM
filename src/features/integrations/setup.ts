import "server-only";
import { parseKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createHttpMailGraph, type MailGraph } from "@/features/integrations/microsoft/graph";
import type { MicrosoftConfig } from "@/features/integrations/microsoft/oauth";

// Configuration et dépendances de l'intégration Microsoft. Regroupées ici pour que les services (connexion, synchronisation)
// ne lisent jamais l'environnement eux-mêmes : les tests leur passent un faux fournisseur et une clé de test.

export type IntegrationSetup = {
  microsoft: MicrosoftConfig;
  /** Clé AES-256 qui chiffre les jetons stockés en base. */
  key: Buffer;
  /** URL publique de l'application, sans slash final (adresse de retour OAuth et des webhooks). */
  baseUrl: string;
};

export type IntegrationDeps = {
  setup: IntegrationSetup;
  graph: MailGraph;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

/** Configuration issue de l'environnement, ou null si l'intégration n'est pas configurée (variables MS_* absentes). */
export function loadIntegrationSetup(): IntegrationSetup | null {
  if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) return null;
  return {
    microsoft: { clientId: env.MS_CLIENT_ID, clientSecret: env.MS_CLIENT_SECRET, tenant: env.MS_TENANT_ID },
    key: parseKey(env.TOKEN_ENCRYPTION_KEY),
    baseUrl: env.BETTER_AUTH_URL.replace(/\/$/, ""),
  };
}

export function defaultDeps(setup: IntegrationSetup): IntegrationDeps {
  return { setup, graph: createHttpMailGraph() };
}

export const redirectUri = (setup: IntegrationSetup) => `${setup.baseUrl}/api/integrations/microsoft/callback`;
export const webhookUrl = (setup: IntegrationSetup) => `${setup.baseUrl}/api/integrations/microsoft/webhook`;

export const clock = (deps: Pick<IntegrationDeps, "now">): Date => deps.now?.() ?? new Date();
