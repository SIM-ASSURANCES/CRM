import "server-only";
import { z } from "zod";

// Validation des variables d'environnement au démarrage : l'application refuse de démarrer si une valeur manque
// ou est invalide. Ces valeurs ne sont jamais exposées au navigateur (pas de préfixe NEXT_PUBLIC_).
const schema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET doit contenir au moins 32 caractères"),
  BETTER_AUTH_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Secret du planificateur des automatisations (facultatif : sans lui, la route planifiée est désactivée).
  CRON_SECRET: z.string().min(32, "CRON_SECRET doit contenir au moins 32 caractères").optional(),
  // Intégration Microsoft 365 (facultative : sans ces variables, la connexion Microsoft est désactivée).
  MS_CLIENT_ID: z.string().min(1).optional(),
  MS_CLIENT_SECRET: z.string().min(1).optional(),
  // « organizations » accepte tout compte professionnel Microsoft ; un identifiant de locataire restreint à SIM.
  MS_TENANT_ID: z.string().min(1).default("organizations"),
  // Clé AES-256 (32 octets en base64) qui chiffre les jetons en base : openssl rand -base64 32. Ne jamais la perdre ni la
  // committer : sans elle, les connexions doivent être refaites.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "TOKEN_ENCRYPTION_KEY doit être une clé de 32 octets en base64")
    .optional(),
}).superRefine((value, context) => {
  if (value.MS_CLIENT_ID && (!value.MS_CLIENT_SECRET || !value.TOKEN_ENCRYPTION_KEY)) {
    context.addIssue({
      code: "custom",
      path: ["MS_CLIENT_SECRET"],
      message: "MS_CLIENT_ID exige aussi MS_CLIENT_SECRET et TOKEN_ENCRYPTION_KEY",
    });
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Configuration invalide (${issues})`);
}

export const env = parsed.data;
