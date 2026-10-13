"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { linkContactAction, type ContactFormState } from "@/app/(crm)/contacts/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";

const INITIAL_STATE: ContactFormState = {};

/** Rattache à ce compte un contact qui existe déjà (un contact peut appartenir à plusieurs comptes). */
export function LinkExistingContact({ accountId, contacts }: { accountId: string; contacts: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(linkContactAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  if (contacts.length === 0) {
    return <p className="text-sm text-muted">Aucun autre contact disponible à rattacher.</p>;
  }

  return (
    <form action={formAction} noValidate className="grid gap-4 sm:grid-cols-[2fr_2fr_auto_auto] sm:items-end">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="returnTo" value={`/comptes/${accountId}`} />

      <SelectField
        key={`contact-${state.values?.contactId ?? "initial"}`}
        label="Associer un contact existant"
        name="contactId"
        required
        placeholder="Sélectionner…"
        defaultValue={state.values?.contactId ?? ""}
        options={contacts.map((c) => ({ value: c.id, label: c.label }))}
        error={error("contactId")}
      />
      <Field label="Fonction chez ce compte" name="relationshipTitle" defaultValue={state.values?.relationshipTitle} error={error("relationshipTitle")} />
      <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="isPrimary" className="size-4 accent-brand-700" />
        Contact principal
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Associer
      </Button>

      {state.error && !state.fieldErrors && (
        <p role="alert" className="text-sm text-danger sm:col-span-4">
          {state.error}
        </p>
      )}
    </form>
  );
}
