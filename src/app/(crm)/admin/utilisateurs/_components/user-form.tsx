"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { createUserAction, updateUserAction } from "@/app/(crm)/admin/utilisateurs/actions";
import { CredentialNotice } from "@/app/(crm)/admin/utilisateurs/_components/credential-notice";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import type { AdminFormState } from "@/lib/action-result";
import { ROLES, ROLE_LABELS } from "@/lib/auth/roles";

type UserFormProps = {
  mode: "create" | "update";
  teams: { id: string; name: string }[];
  initial: Record<string, string>;
  userId?: string;
  /** Un administrateur ne peut pas modifier son propre rôle. */
  isSelf?: boolean;
};

const INITIAL_STATE: AdminFormState = {};

export function UserForm({ mode, teams, initial, userId, isSelf }: UserFormProps) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createUserAction : updateUserAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  if (state.credential) {
    return <CredentialNotice credential={state.credential} heading="Compte créé" />;
  }

  return (
    <form action={formAction} noValidate className="space-y-6">
      {mode === "update" && <input type="hidden" name="id" value={userId} />}

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom complet" name="name" required autoComplete="off" defaultValue={values.name} error={error("name")} />
        {mode === "create" ? (
          <Field
            label="Adresse e-mail"
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={values.email}
            error={error("email")}
          />
        ) : (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Adresse e-mail</p>
            <p className="flex h-10 items-center rounded-lg border border-line bg-surface px-3 text-sm text-ink-soft">
              {values.email}
            </p>
          </div>
        )}

        <SelectField
          // La liste est recréée si le serveur renvoie une autre valeur : React ne met pas à jour l'option par défaut.
          key={`role-${state.values?.role ?? "initial"}`}
          label="Rôle"
          name="role"
          required
          defaultValue={values.role ?? "commercial"}
          disabled={isSelf}
          options={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
          error={error("role")}
        />
        {/* Un champ désactivé n'est pas envoyé : on renvoie le rôle actuel pour que la validation passe. */}
        {isSelf && <input type="hidden" name="role" value={values.role} />}

        <SelectField
          key={`team-${state.values?.teamId ?? "initial"}`}
          label="Équipe"
          name="teamId"
          placeholder="Aucune équipe"
          defaultValue={values.teamId ?? ""}
          options={teams.map((team) => ({ value: team.id, label: team.name }))}
          error={error("teamId")}
        />
      </div>

      {isSelf && <p className="text-xs text-muted">Vous ne pouvez pas modifier votre propre rôle.</p>}
      {mode === "create" && (
        <p className="text-xs text-muted">
          Un mot de passe temporaire sera généré et affiché une seule fois. L&apos;utilisateur devra le changer à sa
          première connexion.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {mode === "create" ? "Créer le compte" : "Enregistrer les modifications"}
        </Button>
        <Link href="/admin/utilisateurs" className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
