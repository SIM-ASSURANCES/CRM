"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import {
  createOpportunityAction,
  updateOpportunityAction,
  type OpportunityFormState,
} from "@/app/(crm)/opportunites/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { OPEN_STAGES, REVENUE_PERIODS, STAGE_LABELS } from "@/features/opportunities/config";

type OpportunityFormProps = {
  mode: "create" | "update";
  accounts: { id: string; label: string }[];
  products: { id: string; label: string }[];
  /** Propriétaires proposés : renseigné seulement pour ceux qui peuvent réaffecter. */
  owners?: { id: string; name: string }[];
  initial: Record<string, string>;
  opportunityId?: string;
  version?: number;
};

const INITIAL_STATE: OpportunityFormState = {};

export function OpportunityForm({ mode, accounts, products, owners, initial, opportunityId, version }: OpportunityFormProps) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createOpportunityAction : updateOpportunityAction,
    INITIAL_STATE,
  );
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  // Les listes déroulantes ne se réinitialisent pas comme les champs texte : la clé les recrée avec la valeur renvoyée.
  const keyOf = (name: string) => `${name}-${state.values?.[name] ?? "initial"}`;

  return (
    <form action={formAction} noValidate className="space-y-8">
      {mode === "update" && (
        <>
          <input type="hidden" name="id" value={opportunityId} />
          <input type="hidden" name="version" value={version} />
        </>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Opportunité</legend>
        <SelectField
          key={keyOf("accountId")}
          label="Compte"
          name="accountId"
          required
          placeholder="Sélectionner…"
          defaultValue={values.accountId ?? ""}
          options={accounts.map((a) => ({ value: a.id, label: a.label }))}
          error={error("accountId")}
        />
        <Field
          label="Nom (généré si vide)"
          name="name"
          placeholder="Compte – produit – MM/AAAA"
          defaultValue={values.name}
          error={error("name")}
        />
        <SelectField
          key={keyOf("productId")}
          label="Produit"
          name="productId"
          placeholder="Non précisé"
          defaultValue={values.productId ?? ""}
          options={products.map((p) => ({ value: p.id, label: p.label }))}
          error={error("productId")}
        />
        {mode === "create" ? (
          <SelectField
            key={keyOf("stage")}
            label="Étape initiale"
            name="stage"
            required
            defaultValue={values.stage ?? "10"}
            options={OPEN_STAGES.map((stage) => ({ value: stage, label: `${STAGE_LABELS[stage]} (${stage} %)` }))}
            error={error("stage")}
          />
        ) : (
          <p className="self-end text-sm text-ink-soft">
            L&apos;étape se change depuis le Kanban ou la fiche, avec ses critères de sortie.
          </p>
        )}
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Montant et échéances</legend>
        <Field
          label="Montant estimé (FCFA)"
          name="amount"
          required
          inputMode="decimal"
          placeholder="12 500 000"
          defaultValue={values.amount}
          error={error("amount")}
        />
        <SelectField
          key={keyOf("revenuePeriod")}
          label="Période du revenu"
          name="revenuePeriod"
          required
          defaultValue={values.revenuePeriod ?? "annual"}
          options={REVENUE_PERIODS.map((p) => ({ value: p.code, label: p.label }))}
          error={error("revenuePeriod")}
        />
        <Field label="Méthode d'estimation" name="estimationMethod" defaultValue={values.estimationMethod} error={error("estimationMethod")} />
        <Field
          label="Clôture prévisionnelle"
          name="expectedCloseDate"
          type="date"
          required
          defaultValue={values.expectedCloseDate}
          error={error("expectedCloseDate")}
        />
        <Field label="Prochaine action" name="nextAction" required defaultValue={values.nextAction} error={error("nextAction")} />
        <Field
          label="Date de la prochaine action"
          name="nextActionDate"
          type="date"
          required
          defaultValue={values.nextActionDate}
          error={error("nextActionDate")}
        />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Contexte commercial</legend>
        <Field label="Concurrent" name="competitor" defaultValue={values.competitor} error={error("competitor")} />
        <Field label="Solution actuelle du client" name="currentSolution" defaultValue={values.currentSolution} error={error("currentSolution")} />
        {owners && (
          <SelectField
            key={keyOf("ownerUserId")}
            label="Propriétaire commercial"
            name="ownerUserId"
            defaultValue={values.ownerUserId ?? ""}
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
            error={error("ownerUserId")}
          />
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {mode === "create" ? "Créer l'opportunité" : "Enregistrer les modifications"}
        </Button>
        <Link
          href={mode === "update" && opportunityId ? `/opportunites/${opportunityId}` : "/opportunites"}
          className={buttonClasses("secondary")}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
