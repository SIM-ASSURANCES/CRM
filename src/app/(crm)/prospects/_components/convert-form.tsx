"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { convertLeadAction, type OpportunityFormState } from "@/app/(crm)/opportunites/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";

type ConvertFormProps = {
  leadId: string;
  /** Comptes visibles où rattacher l'opportunité à la place d'en créer un nouveau. */
  accounts: { id: string; label: string }[];
  initial: Record<string, string>;
};

const INITIAL_STATE: OpportunityFormState = {};

/** Conversion d'un prospect (CDC A.8) : compte, contact et opportunité créés ensemble, ou rien n'est créé. */
export function ConvertForm({ leadId, accounts, initial }: ConvertFormProps) {
  const [state, formAction, pending] = useActionState(convertLeadAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  const duplicates = state.duplicates ?? [];

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="leadId" value={leadId} />

      {state.error && duplicates.length === 0 && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}{" "}
          {state.opportunityId && (
            <Link href={`/opportunites/${state.opportunityId}`} className="font-medium underline">
              Ouvrir l&apos;opportunité
            </Link>
          )}
        </p>
      )}

      {duplicates.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          <p className="font-semibold">Un compte similaire existe déjà :</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {duplicates.map((duplicate) => (
              <li key={`${duplicate.legalName}-${duplicate.ownerName}`}>
                {duplicate.id ? (
                  <Link href={`/comptes/${duplicate.id}`} className="font-medium text-brand-700 underline">
                    {duplicate.legalName}
                  </Link>
                ) : (
                  <strong>{duplicate.legalName}</strong>
                )}{" "}
                (suivi par {duplicate.ownerName}) — correspondance sur {duplicate.matchedOn.join(", ")}
              </li>
            ))}
          </ul>
          <p className="mt-3">
            Choisissez ce compte ci-dessous pour y rattacher l&apos;opportunité, ou confirmez qu&apos;il s&apos;agit d&apos;une autre entreprise.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2">
            <input type="checkbox" name="forceDuplicate" className="size-4 accent-brand-700" />
            Ce n&apos;est pas un doublon : créer un nouveau compte
          </label>
        </div>
      )}

      <SelectField
        key={`account-${state.values?.existingAccountId ?? "initial"}`}
        label="Compte"
        name="existingAccountId"
        placeholder="Créer un nouveau compte à partir du prospect"
        defaultValue={values.existingAccountId ?? ""}
        options={accounts.map((a) => ({ value: a.id, label: a.label }))}
        error={error("existingAccountId")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
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
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Convertir le prospect
        </Button>
        <Link href={`/prospects/${leadId}`} className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
