import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Chiffrement des secrets stockés en base (jetons d'accès et d'actualisation des intégrations).
// AES-256-GCM : confidentialité ET intégrité (toute altération est détectée au déchiffrement). Format :
// « v1.<iv>.<étiquette>.<chiffré> » en base64url. Un « contexte » (identifiant de la connexion, nom de la colonne) est
// lié au chiffré : un jeton recopié dans une autre ligne ou une autre colonne ne se déchiffre plus.

const VERSION = "v1";

/**
 * Comparaison de secrets en temps constant : on compare des empreintes SHA-256 de même longueur, jamais les valeurs
 * brutes, pour qu'ni le contenu ni la longueur du secret ne se déduisent du temps de réponse.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** Décode une clé AES-256 fournie en base64 (32 octets). */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("La clé de chiffrement doit faire 32 octets (base64).");
  return key;
}

export function encryptSecret(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Déchiffre un secret. Lève une erreur si le format, la clé, le contexte ou le contenu ne correspondent pas. */
export function decryptSecret(payload: string, key: Buffer, context: string): string {
  const [version, iv, tag, encrypted] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !encrypted) throw new Error("Secret chiffré illisible.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Message volontairement générique : ne révèle pas pourquoi le déchiffrement échoue.
    throw new Error("Secret chiffré illisible.");
  }
}
