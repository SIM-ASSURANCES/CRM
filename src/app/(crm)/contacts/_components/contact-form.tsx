"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { createContactAction, updateContactAction, type ContactFormState } from "@/app/(crm)/contacts/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { CONTACT_STATUSES, PREFERRED_CHANNELS } from "@/features/accounts/config";

type ContactFormProps = {
  mode: "create" | "update";
  initial: Record<string, string>;
  contactId?: string;
  version?: number;
  /** Création depuis la fiche d'un compte : le contact y est rattaché dès l'enregistrement. */
  account?: { id: string; name: string };
};

const INITIAL_STATE: ContactFormState = {};

export function ContactForm({ mode, initial, contactId, version, account }: ContactFormProps) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createContactAction : updateContactAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  const duplicates = state.duplicates ?? [];

  return (
    <form action={formAction} noValidate className="space-y-6">
      {mode === "update" && (
        <>
          <input type="hidden" name="id" value={contactId} />
          <input type="hidden" name="version" value={version} />
        </>
      )}
      {account && <input type="hidden" name="accountId" value={account.id} />}

      {state.error && duplicates.length === 0 && !state.fieldErrors && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {duplicates.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          <p className="font-semibold">Un contact similaire existe déjà :</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {duplicates.map((duplicate) => (
              <li key={`${duplicate.name}-${duplicate.ownerName}`}>
                {duplicate.name} (suivi par {duplicate.ownerName}) — correspondance sur {duplicate.matchedOn.join(", ")}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input type="checkbox" name="forceDuplicate" className="size-4 accent-brand-700" />
            Ce n&apos;est pas un doublon : créer quand même ce contact
          </label>
        </div>
      )}

      {account && (
        <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-ink">
          Ce contact sera rattaché au compte <strong>{account.name}</strong>.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Prénom" name="firstName" required autoComplete="off" defaultValue={values.firstName} error={error("firstName")} />
        <Field label="Nom" name="lastName" required autoComplete="off" defaultValue={values.lastName} error={error("lastName")} />
        <Field label="Fonction" name="jobTitle" defaultValue={values.jobTitle} error={error("jobTitle")} />
        <Field label="Service" name="department" defaultValue={values.department} error={error("department")} />
        <Field label="E-mail professionnel" name="email" type="email" autoComplete="off" defaultValue={values.email} error={error("email")} />
        <Field label="Téléphone" name="phone" type="tel" inputMode="tel" autoComplete="off" defaultValue={values.phone} error={error("phone")} />
        <SelectField
          key={`status-${state.values?.status ?? "initial"}`}
          label="Statut"
          name="status"
          required
          defaultValue={values.status ?? "active"}
          options={CONTACT_STATUSES.map((s) => ({ value: s.code, label: s.label }))}
          error={error("status")}
        />
        <SelectField
          key={`channel-${state.values?.preferredChannel ?? "initial"}`}
          label="Canal privilégié"
          name="preferredChannel"
          placeholder="Non renseigné"
          defaultValue={values.preferredChannel ?? ""}
          options={PREFERRED_CHANNELS.map((c) => ({ value: c.code, label: c.label }))}
          error={error("preferredChannel")}
        />
        {mode === "create" && account && (
          <Field label="Fonction chez ce compte" name="relationshipTitle" defaultValue={values.relationshipTitle} error={error("relationshipTitle")} />
        )}
      </div>

      <div>
        <label htmlFor="contactRestrictions" className="mb-1.5 block text-sm font-medium text-ink">
          Disponibilités et restrictions de contact
        </label>
        <textarea
          id="contactRestrictions"
          name="contactRestrictions"
          rows={3}
          defaultValue={values.contactRestrictions}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
        />
        {error("contactRestrictions") && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {error("contactRestrictions")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {mode === "create" ? "Créer le contact" : "Enregistrer les modifications"}
        </Button>
        <Link href={account ? `/comptes/${account.id}` : contactId ? `/contacts/${contactId}` : "/contacts"} className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
