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
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Configuration invalide (${issues})`);
}

export const env = parsed.data;
