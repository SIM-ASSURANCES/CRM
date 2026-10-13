"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "@/app/(crm)/change-password/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const INITIAL_STATE: ChangePasswordState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL_STATE);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <Field
        label="Mot de passe actuel"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={errors?.currentPassword?.join(" ")}
      />
      <Field
        label="Nouveau mot de passe"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors?.newPassword?.join(" ")}
      />
      <p className="-mt-3 text-xs text-muted">Au moins {PASSWORD_MIN_LENGTH} caractères, avec des lettres et des chiffres.</p>
      <Field
        label="Confirmer le nouveau mot de passe"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors?.confirmPassword?.join(" ")}
      />

      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </Button>
    </form>
  );
}
