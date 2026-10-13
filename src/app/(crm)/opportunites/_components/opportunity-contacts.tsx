"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import {
  addOpportunityContactAction,
  removeOpportunityContactAction,
  type OpportunityFormState,
} from "@/app/(crm)/opportunites/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { ROLE_TYPES, labelOf } from "@/features/accounts/config";

type OpportunityContactsProps = {
  opportunityId: string;
  contacts: { contactId: string; name: string; jobTitle: string | null; roleType: string | null; isMain: boolean }[];
  /** Contacts du compte pas encore impliqués ; vide si l'utilisateur ne peut pas modifier. */
  candidates: { id: string; label: string }[];
  editable: boolean;
};

const INITIAL_STATE: OpportunityFormState = {};

/** Contacts impliqués dans l'opportunité (CDC 5.1) : décideur, validateur, etc., avec un seul contact principal. */
export function OpportunityContacts({ opportunityId, contacts, candidates, editable }: OpportunityContactsProps) {
  const [state, formAction, pending] = useActionState(addOpportunityContactAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <div>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted">Aucun contact associé à cette opportunité.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {contacts.map((contact) => (
            <li key={contact.contactId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <p>
                <Link href={`/contacts/${contact.contactId}`} className="font-semibold text-brand-700 hover:underline">
                  {contact.name}
                </Link>
                {contact.isMain && (
                  <span className="ml-2 rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white">Principal</span>
                )}
                <span className="ml-2 text-ink-soft">
                  {[contact.jobTitle, contact.roleType ? labelOf(ROLE_TYPES, contact.roleType) : null].filter(Boolean).join(" · ")}
                </span>
              </p>
              {editable && (
                <form action={removeOpportunityContactAction}>
                  <input type="hidden" name="opportunityId" value={opportunityId} />
                  <input type="hidden" name="contactId" value={contact.contactId} />
                  <Button type="submit" variant="ghost" aria-label={`Retirer ${contact.name}`}>
                    Retirer
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && candidates.length > 0 && (
        <form action={formAction} noValidate className="mt-6 space-y-4 border-t border-line pt-6">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <h3 className="text-sm font-semibold text-ink">Associer un contact du compte</h3>
          {state.error && !state.fieldErrors && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              key={`contact-${state.values?.contactId ?? "initial"}`}
              label="Contact"
              name="contactId"
              required
              placeholder="Sélectionner…"
              defaultValue={state.values?.contactId ?? ""}
              options={candidates.map((c) => ({ value: c.id, label: c.label }))}
              error={error("contactId")}
            />
            <SelectField
              key={`role-${state.values?.roleType ?? "initial"}`}
              label="Rôle dans l'achat"
              name="roleType"
              placeholder="Non précisé"
              defaultValue={state.values?.roleType ?? ""}
              options={ROLE_TYPES.map((r) => ({ value: r.code, label: r.label }))}
              error={error("roleType")}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="isMain" className="size-4 accent-brand-700" />
            Contact principal de l&apos;opportunité
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Associer
          </Button>
        </form>
      )}
    </div>
  );
}
