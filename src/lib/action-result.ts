import "server-only";
import type { CredentialResult } from "@/features/users/service";
import { AppError } from "@/lib/errors";
import type { FieldErrors } from "@/lib/forms";
import { logger } from "@/lib/logger";

// État renvoyé par les Server Actions d'administration aux formulaires (useActionState).
export type AdminFormState = {
  error?: string;
  fieldErrors?: FieldErrors;
  /** Valeurs saisies, renvoyées pour que le formulaire ne se vide pas après une erreur. */
  values?: Record<string, string>;
  /** Mot de passe temporaire à afficher UNE fois à l'administrateur (jamais stocké, jamais journalisé). */
  credential?: CredentialResult;
};

/** Transforme une exception en état de formulaire : les erreurs métier sont montrées, les autres masquées. */
export function failureState(error: unknown, values?: Record<string, string>): AdminFormState {
  if (error instanceof AppError) {
    const details = error.details as { fieldErrors?: FieldErrors } | undefined;
    return { error: error.message, fieldErrors: details?.fieldErrors, values };
  }
  logger.error({ err: error }, "Erreur inattendue dans une action d'administration");
  return { error: "Une erreur est survenue. Réessayez dans un instant.", values };
}
