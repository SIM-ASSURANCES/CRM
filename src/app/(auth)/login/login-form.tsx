"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

const INITIAL_STATE: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);
  const next = useSearchParams().get("next") ?? "";

  return (
    <form action={formAction} noValidate className="mt-6 space-y-5">
      <input type="hidden" name="next" value={next} />

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
        error={state.fieldErrors?.email}
      />

      <Field
        label="Mot de passe"
        name="password"
        type={showPassword ? "text" : "password"}
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
        adornment={
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="flex size-7 items-center justify-center rounded text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        }
      />

      <div className="flex items-center justify-between gap-4 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
          <input type="checkbox" name="rememberMe" className="size-4 rounded border-line accent-brand-700" />
          Se souvenir de moi
        </label>
        <Link href="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
