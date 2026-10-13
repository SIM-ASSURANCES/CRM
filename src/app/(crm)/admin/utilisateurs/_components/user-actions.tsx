"use client";

import { useActionState } from "react";
import { resetPasswordAction, toggleActiveAction } from "@/app/(crm)/admin/utilisateurs/actions";
import { CredentialNotice } from "@/app/(crm)/admin/utilisateurs/_components/credential-notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AdminFormState } from "@/lib/action-result";

const INITIAL_STATE: AdminFormState = {};

/** Réinitialisation du mot de passe : confirmation, puis affichage unique du mot de passe temporaire. */
export function ResetPasswordControl({
  userId,
  userName,
  disabledReason,
}: {
  userId: string;
  userName: string;
  /** Si renseigné, l'action est indisponible et la raison est affichée (compte désactivé, compte personnel). */
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL_STATE);

  if (state.credential) {
    return <CredentialNotice credential={state.credential} heading="Mot de passe réinitialisé" />;
  }

  return (
    <div>
      <ConfirmDialog
        triggerLabel="Réinitialiser le mot de passe"
        triggerDisabled={Boolean(disabledReason)}
        title={`Réinitialiser le mot de passe de ${userName} ?`}
        description="Un mot de passe temporaire sera généré. Toutes les sessions ouvertes de cet utilisateur seront fermées immédiatement, et il devra choisir un nouveau mot de passe à sa prochaine connexion."
        confirmLabel="Réinitialiser"
        action={formAction}
        pending={pending}
        error={state.error}
        fields={{ id: userId }}
      />
      {disabledReason && <p className="mt-2 text-xs text-muted">{disabledReason}</p>}
    </div>
  );
}

/** Désactivation (immédiate, réversible) ou réactivation d'un compte. */
export function ToggleActiveControl({
  userId,
  userName,
  active,
  disabledReason,
}: {
  userId: string;
  userName: string;
  /** État actuel du compte : « true » = actif, l'action le désactive. */
  active: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(toggleActiveAction, INITIAL_STATE);

  return (
    <div>
      <ConfirmDialog
        triggerLabel={active ? "Désactiver le compte" : "Réactiver le compte"}
        triggerVariant={active ? "secondary" : "primary"}
        triggerDisabled={Boolean(disabledReason)}
        title={active ? `Désactiver le compte de ${userName} ?` : `Réactiver le compte de ${userName} ?`}
        description={
          active
            ? "L'utilisateur ne pourra plus se connecter et ses sessions ouvertes seront fermées immédiatement. Ses données sont conservées et le compte peut être réactivé."
            : "L'utilisateur pourra de nouveau se connecter avec son mot de passe actuel."
        }
        confirmLabel={active ? "Désactiver" : "Réactiver"}
        confirmVariant={active ? "danger" : "primary"}
        action={formAction}
        pending={pending}
        error={state.error}
        fields={{ id: userId, active: String(!active) }}
      />
      {disabledReason && <p className="mt-2 text-xs text-muted">{disabledReason}</p>}
    </div>
  );
}
