"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { createTaskAction, updateTaskAction, type TaskFormState } from "@/app/(crm)/taches/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { TASK_PRIORITIES } from "@/features/tasks/config";

type TaskFormProps = {
  mode: "create" | "update";
  /** Comptes proposés à la création (une tâche peut aussi n'être liée à aucun compte). */
  accounts?: { id: string; label: string }[];
  /** Responsables proposés : renseigné seulement pour ceux qui peuvent confier une tâche à quelqu'un d'autre. */
  assignees?: { id: string; name: string }[];
  /** Objets déjà liés (opportunité ou contact d'origine, ou lien d'une tâche existante) : affichés, non modifiables. */
  linked?: { account?: string; contact?: string; opportunity?: string };
  /** Identifiants à renvoyer tels quels pour les liens pré-remplis à la création. */
  hidden?: { contactId?: string; opportunityId?: string };
  initial: Record<string, string>;
  returnTo: string;
  taskId?: string;
  version?: number;
};

const INITIAL_STATE: TaskFormState = {};

export function TaskForm({ mode, accounts, assignees, linked, hidden, initial, returnTo, taskId, version }: TaskFormProps) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createTaskAction : updateTaskAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  // Les listes déroulantes ne se réinitialisent pas comme les champs texte : la clé les recrée avec la valeur renvoyée.
  const keyOf = (name: string) => `${name}-${state.values?.[name] ?? "initial"}`;
  const linkedLines = [
    linked?.account && `Compte : ${linked.account}`,
    linked?.opportunity && `Opportunité : ${linked.opportunity}`,
    linked?.contact && `Contact : ${linked.contact}`,
  ].filter(Boolean);

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="returnTo" value={returnTo} />
      {mode === "update" && (
        <>
          <input type="hidden" name="id" value={taskId} />
          <input type="hidden" name="version" value={version} />
        </>
      )}
      {mode === "create" && hidden?.contactId && <input type="hidden" name="contactId" value={hidden.contactId} />}
      {mode === "create" && hidden?.opportunityId && <input type="hidden" name="opportunityId" value={hidden.opportunityId} />}

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {(error("contactId") || error("opportunityId")) && (
        <p role="alert" className="text-sm text-danger">
          {[error("contactId"), error("opportunityId")].filter(Boolean).join(" ")}
        </p>
      )}

      {linkedLines.length > 0 && (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink">
          {linkedLines.map((line, index) => (
            <span key={index} className="block">
              {line}
            </span>
          ))}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Titre" name="title" required defaultValue={values.title} error={error("title")} />
        </div>
        <Field label="Échéance" name="dueDate" type="date" required defaultValue={values.dueDate} error={error("dueDate")} />
        <SelectField
          key={keyOf("priority")}
          label="Priorité"
          name="priority"
          defaultValue={values.priority ?? "normal"}
          options={TASK_PRIORITIES.map((p) => ({ value: p.code, label: p.label }))}
          error={error("priority")}
        />
        {mode === "create" && accounts && !hidden?.opportunityId && (
          <SelectField
            key={keyOf("accountId")}
            label="Compte concerné"
            name="accountId"
            placeholder="Aucun compte"
            defaultValue={values.accountId ?? ""}
            options={accounts.map((a) => ({ value: a.id, label: a.label }))}
            error={error("accountId")}
          />
        )}
        {assignees && (
          <SelectField
            key={keyOf("assigneeUserId")}
            label="Responsable"
            name="assigneeUserId"
            defaultValue={values.assigneeUserId ?? ""}
            options={assignees.map((a) => ({ value: a.id, label: a.name }))}
            error={error("assigneeUserId")}
          />
        )}
      </div>

      <div>
        <label htmlFor="task-description" className="mb-1.5 block text-sm font-medium text-ink">
          Description
        </label>
        <textarea
          id="task-description"
          name="description"
          rows={3}
          defaultValue={values.description}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
        />
        {error("description") && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {error("description")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {mode === "create" ? "Créer la tâche" : "Enregistrer les modifications"}
        </Button>
        <Link href={returnTo} className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
