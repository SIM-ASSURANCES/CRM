"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { createActivityAction, updateActivityAction, type ActivityFormState } from "@/app/(crm)/activites/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { ACTIVITY_TYPES } from "@/features/activities/config";

type ActivityFormProps = {
  mode: "create" | "update";
  accountId: string;
  accountName: string;
  contacts: { id: string; label: string }[];
  opportunities: { id: string; label: string }[];
  initial: Record<string, string>;
  /** Chemin où revenir après l'enregistrement (la fiche d'où l'on vient). */
  returnTo: string;
  activityId?: string;
  version?: number;
};

const INITIAL_STATE: ActivityFormState = {};

export function ActivityForm({ mode, accountId, accountName, contacts, opportunities, initial, returnTo, activityId, version }: ActivityFormProps) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createActivityAction : updateActivityAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  // Les listes déroulantes ne se réinitialisent pas comme les champs texte : la clé les recrée avec la valeur renvoyée.
  const keyOf = (name: string) => `${name}-${state.values?.[name] ?? "initial"}`;

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {mode === "update" && (
        <>
          <input type="hidden" name="id" value={activityId} />
          <input type="hidden" name="version" value={version} />
        </>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink">
        Compte : <strong>{accountName}</strong>
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          key={keyOf("type")}
          label="Type d'activité"
          name="type"
          required
          placeholder="Sélectionner…"
          defaultValue={values.type ?? ""}
          options={ACTIVITY_TYPES.map((t) => ({ value: t.code, label: t.label }))}
          error={error("type")}
        />
        <Field
          label="Date et heure"
          name="occurredAt"
          type="datetime-local"
          required
          defaultValue={values.occurredAt}
          error={error("occurredAt")}
        />
        <div className="sm:col-span-2">
          <Field label="Objet" name="subject" required defaultValue={values.subject} error={error("subject")} />
        </div>
        <SelectField
          key={keyOf("contactId")}
          label="Contact"
          name="contactId"
          placeholder="Aucun contact précis"
          defaultValue={values.contactId ?? ""}
          options={contacts.map((c) => ({ value: c.id, label: c.label }))}
          error={error("contactId")}
        />
        <SelectField
          key={keyOf("opportunityId")}
          label="Opportunité"
          name="opportunityId"
          placeholder="Aucune opportunité"
          defaultValue={values.opportunityId ?? ""}
          options={opportunities.map((o) => ({ value: o.id, label: o.label }))}
          error={error("opportunityId")}
        />
      </div>

      <div>
        <label htmlFor="activity-outcome" className="mb-1.5 block text-sm font-medium text-ink">
          Résultat de l&apos;échange
        </label>
        <textarea
          id="activity-outcome"
          name="outcome"
          rows={3}
          defaultValue={values.outcome}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
        />
        {error("outcome") && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {error("outcome")}
          </p>
        )}
      </div>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Prochaine action</legend>
        <Field label="Action à mener" name="nextAction" defaultValue={values.nextAction} error={error("nextAction")} />
        <Field label="Date" name="nextActionDate" type="date" defaultValue={values.nextActionDate} error={error("nextActionDate")} />
        <p className="text-xs text-muted sm:col-span-2">
          Si l&apos;activité est liée à une opportunité encore ouverte, cette action devient sa prochaine action.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {mode === "create" ? "Enregistrer l'activité" : "Enregistrer les modifications"}
        </Button>
        <Link href={returnTo} className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
