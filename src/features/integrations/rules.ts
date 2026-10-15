import type { MailMessage } from "@/features/integrations/microsoft/graph";

// Règles pures de la synchronisation des e-mails (CDC 7.1) : quels messages retenir, avec qui les rapprocher, comment
// les dédoublonner. Aucune lecture de base : tout est testable sans réseau.

/** Domaine d'une adresse (« marie@Client.CI » → « client.ci »), ou null si l'adresse est invalide. */
export function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) return null;
  return address.slice(at + 1).trim().toLowerCase();
}

/** Une adresse est exclue si son domaine, ou un domaine parent, figure dans la liste (« filiale.banque.ci » ← « banque.ci »). */
export function isExcludedAddress(address: string, excludedDomains: readonly string[]): boolean {
  const domain = domainOf(address);
  if (!domain) return true;
  return excludedDomains.some((excluded) => domain === excluded || domain.endsWith(`.${excluded}`));
}

/**
 * Clé de dédoublonnage d'un message : l'identifiant international (Message-ID, stable même si le message change de
 * dossier) ; à défaut, l'identifiant Graph. Préfixée pour ne jamais confondre les deux espaces d'identifiants.
 */
export function dedupeKey(message: Pick<MailMessage, "id" | "internetMessageId">): string {
  const internet = message.internetMessageId?.trim().replace(/^<|>$/g, "").toLowerCase();
  return internet ? `msgid:${internet}` : `graph:${message.id}`;
}

export type SkipReason = "removed" | "draft" | "private" | "undated";

/**
 * Raison d'écarter un message AVANT tout rapprochement, ou null s'il doit être examiné. Les messages marqués
 * « personnel », « privé » ou « confidentiel » dans Outlook ne sont jamais importés (CDC 7.1 : exclure les messages personnels).
 */
export function skipReason(message: MailMessage): SkipReason | null {
  if (message.removed) return "removed";
  if (message.isDraft) return "draft";
  if (message.sensitivity !== "normal") return "private";
  if (!message.receivedAt && !message.sentAt) return "undated";
  return null;
}

/** Date de l'échange : envoi pour un message envoyé, réception sinon. */
export function messageDate(message: MailMessage, ownAddress: string): Date {
  const sentByOwner = message.from === ownAddress;
  return ((sentByOwner ? message.sentAt : message.receivedAt) ?? message.receivedAt ?? message.sentAt) as Date;
}

/**
 * Interlocuteurs d'un message : expéditeur et destinataires, sans l'adresse de l'utilisateur lui-même ni les domaines
 * exclus. Ce sont eux que l'on rapproche des contacts du CRM.
 */
export function counterparts(message: MailMessage, ownAddress: string, excludedDomains: readonly string[]): string[] {
  const all = [message.from, ...message.to, ...message.cc].filter((value): value is string => Boolean(value));
  return [...new Set(all)].filter((candidate) => candidate !== ownAddress && !isExcludedAddress(candidate, excludedDomains));
}

/**
 * Lien vers le message d'origine, ou null s'il n'est pas sûr : seule une adresse `https:` est conservée (jamais
 * `javascript:`, `data:` ni `http:`), avec une longueur raisonnable. Appliqué à l'import ET à l'affichage.
 */
export function safeWebLink(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** « Envoyé à a@x.ci, b@y.ci (+2) » / « Reçu de a@x.ci » : résumé du message, sans son contenu. */
export function describeMessage(message: MailMessage, ownAddress: string, max = 3): string {
  if (message.from === ownAddress) {
    const recipients = [...message.to, ...message.cc];
    const shown = recipients.slice(0, max).join(", ");
    return `Envoyé à ${shown}${recipients.length > max ? ` (+${recipients.length - max})` : ""}`;
  }
  return `Reçu de ${message.from ?? "expéditeur inconnu"}`;
}

/**
 * Liste de domaines saisie dans un champ de texte (un par ligne, ou séparés par des virgules ou des espaces) :
 * normalisée en minuscules, sans doublon ; les valeurs invalides sont renvoyées à part pour être signalées.
 */
export function parseDomainList(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    // On tolère « @banque.ci » et « https://banque.ci/ » collés depuis ailleurs.
    const cleaned = raw.trim().toLowerCase().replace(/^@/, "").replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
    if (cleaned === "") continue;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleaned)) invalid.push(raw.trim());
    else if (!domains.includes(cleaned)) domains.push(cleaned);
  }
  return { domains, invalid };
}
