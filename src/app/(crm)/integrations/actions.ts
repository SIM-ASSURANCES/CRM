"use server";

import { redirect } from "next/navigation";
import { beginMicrosoftConnection, disconnectMicrosoft } from "@/features/integrations/connection";
import { updateExcludedDomains } from "@/features/integrations/exclusions";
import { defaultDeps, loadIntegrationSetup } from "@/features/integrations/setup";
import { syncMyMailbox } from "@/features/integrations/sync";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Server Actions de la page « Messagerie ». Chaque action relit la session et les permissions (jamais seulement
// l'interface) et n'agit que sur la connexion de l'utilisateur connecté. Seul un code de résultat passe dans l'adresse
// de redirection : la page le traduit en message.

const PAGE = "/integrations";

async function connectedUser() {
  const user = await requireUser();
  if (!can(user.role, "integration:connect")) redirect(`${PAGE}?erreur=acces`);
  return user;
}

/** Envoie l'utilisateur vers la page de consentement Microsoft (droits minimaux, lecture des en-têtes seulement). */
export async function connectAction(): Promise<void> {
  const user = await connectedUser();
  const setup = loadIntegrationSetup();
  if (!setup) redirect(`${PAGE}?erreur=config`);

  let url: string;
  try {
    url = await beginMicrosoftConnection(user, setup);
  } catch (error) {
    logger.error({ err: error }, "Impossible de préparer la connexion Microsoft");
    redirect(`${PAGE}?erreur=connexion`);
  }
  // redirect() lève une exception : il reste en dehors du try/catch.
  redirect(url);
}

export async function syncNowAction(): Promise<void> {
  const user = await connectedUser();
  const setup = loadIntegrationSetup();
  if (!setup) redirect(`${PAGE}?erreur=config`);

  let target = `${PAGE}?erreur=sync_echec`;
  try {
    const outcome = await syncMyMailbox(user, defaultDeps(setup));
    if (outcome.status === "success") target = `${PAGE}?ok=sync`;
    else if (outcome.status === "partial") target = `${PAGE}?ok=sync_partielle`;
  } catch (error) {
    if (error instanceof AppError) target = `${PAGE}?erreur=${error.code === "RATE_LIMITED" ? "sync_trop_vite" : "sync_inactive"}`;
    else logger.error({ err: error }, "Échec de la synchronisation manuelle");
  }
  redirect(target);
}

export async function disconnectAction(): Promise<void> {
  const user = await connectedUser();
  const setup = loadIntegrationSetup();
  if (!setup) redirect(`${PAGE}?erreur=config`);

  try {
    await disconnectMicrosoft(user, defaultDeps(setup));
  } catch (error) {
    logger.error({ err: error }, "Échec de la déconnexion Microsoft");
    redirect(`${PAGE}?erreur=deconnexion`);
  }
  redirect(`${PAGE}?ok=disconnected`);
}

/** Domaines dont les échanges ne sont jamais importés : réservé à l'administrateur (revérifié dans le service). */
export async function excludedDomainsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!can(user.role, "settings:manage")) redirect(`${PAGE}?erreur=acces`);

  const text = formData.get("domains");
  try {
    await updateExcludedDomains(user, typeof text === "string" ? text : "");
  } catch (error) {
    if (!(error instanceof AppError)) logger.error({ err: error }, "Échec de l'enregistrement des domaines exclus");
    redirect(`${PAGE}?erreur=domaines`);
  }
  redirect(`${PAGE}?ok=domains`);
}
