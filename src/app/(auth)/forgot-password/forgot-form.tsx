"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { requestPasswordResetAction, type ForgotState } from "@/app/(auth)/forgot-password/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

const INITIAL_STATE: ForgotState = {};

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL_STATE);

  if (state.submitted) {
    return (
      <p role="status" className="mt-6 rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-sm text-ink">
        Si un compte correspond à cette adresse, votre demande a été transmise à l&apos;administrateur du CRM.
        Il vous communiquera un mot de passe temporaire.
      </p>
    );
  }

  return (
    <form action={formAction} noValidate className="mt-6 space-y-5">
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={state.email}
        error={state.fieldError}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Envoi…" : "Envoyer la demande"}
      </Button>
    </form>
  );
}
