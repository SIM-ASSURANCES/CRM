"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { createTeamAction, deleteTeamAction, updateTeamAction } from "@/app/(crm)/admin/equipes/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import type { AdminFormState } from "@/lib/action-result";

const INITIAL_STATE: AdminFormState = {};

export function TeamForm({
  mode,
  managers,
  initial,
  teamId,
}: {
  mode: "create" | "update";
  managers: { id: string; name: string }[];
  initial: Record<string, string>;
  teamId?: string;
}) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createTeamAction : updateTeamAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <form action={formAction} noValidate className="space-y-5">
      {mode === "update" && <input type="hidden" name="id" value={teamId} />}

      {state.error && !state.fieldErrors && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom de l'équipe" name="name" required autoComplete="off" defaultValue={values.name} error={error("name")} />
        <SelectField
          key={`manager-${state.values?.managerUserId ?? "initial"}`}
          label="Responsable (manager)"
          name="managerUserId"
          placeholder="Aucun responsable"
          defaultValue={values.managerUserId ?? ""}
          options={managers.map((manager) => ({ value: manager.id, label: manager.name }))}
          error={error("managerUserId")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {mode === "create" ? "Créer l'équipe" : "Enregistrer"}
        </Button>
        {mode === "update" && (
          <Link href="/admin/equipes" className={buttonClasses("secondary")}>
            Annuler
          </Link>
        )}
      </div>
    </form>
  );
}

/** Suppression d'une équipe sans membre, après confirmation. */
export function DeleteTeamControl({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [state, formAction, pending] = useActionState(deleteTeamAction, INITIAL_STATE);

  return (
    <ConfirmDialog
      triggerLabel="Supprimer l'équipe"
      title={`Supprimer l'équipe ${teamName} ?`}
      description="Cette action est définitive. Une équipe qui a encore des membres ne peut pas être supprimée."
      confirmLabel="Supprimer"
      confirmVariant="danger"
      action={formAction}
      pending={pending}
      error={state.error}
      fields={{ id: teamId }}
    />
  );
}
