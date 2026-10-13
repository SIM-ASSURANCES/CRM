import "server-only";
import pino from "pino";
import { env } from "@/lib/env";

// Logs structurés (JSON). Les champs sensibles sont masqués : aucun mot de passe, jeton, cookie ni e-mail
// ne doit apparaître dans les journaux (CDC 10 et A.2).
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "crm" },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "accessToken",
      "refreshToken",
      "email",
      "*.email",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[MASQUÉ]",
  },
});
