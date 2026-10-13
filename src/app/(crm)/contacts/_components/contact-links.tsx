"use client";

import { Loader2, X } from "lucide-react";
import { useActionState } from "react";
import {
  addRoleAction,
  linkContactAction,
  removeRoleAction,
  unlinkContactAction,
  type ContactFormState,
} from "@/app/(crm)/contacts/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { INFLUENCE_LEVELS, ROLE_TYPES, labelOf } from "@/features/accounts/config";

const INITIAL_STATE: ContactFormState = {};

type Option = { id: string; label: string };

/** Rattache le contact à un compte (ou met à jour ce rattachement : fonction, dates, contact principal). */
export function LinkAccountForm({ contactId, accounts }: { contactId: string; accounts: Option[] }) {
  const [state, formAction, pending] = useActionState(linkContactAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <form action={formAction} noValidate className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="returnTo" value={`/contacts/${contactId}`} />

      <SelectField
        key={`account-${state.values?.accountId ?? "initial"}`}
        label="Compte"
        name="accountId"
        required
        placeholder="Sélectionner…"
        defaultValue={state.values?.accountId ?? ""}
        options={accounts.map((a) => ({ value: a.id, label: a.label }))}
        error={error("accountId")}
      />
      <Field label="Fonction chez ce compte" name="relationshipTitle" defaultValue={state.values?.relationshipTitle} error={error("relationshipTitle")} />
      <Field label="Début" name="startDate" type="date" defaultValue={state.values?.startDate} error={error("startDate")} />
      <Field label="Fin" name="endDate" type="date" defaultValue={state.values?.endDate} error={error("endDate")} />
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink sm:col-span-2">
        <input type="checkbox" name="isPrimary" className="size-4 accent-brand-700" />
        Contact principal de ce compte
      </label>

      {state.error && !state.fieldErrors && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {state.error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Rattacher
        </Button>
      </div>
    </form>
  );
}

/** Qualifie le rôle d'achat du contact chez l'un de ses comptes, éventuellement pour un produit (CDC 3.3). */
export function AddRoleForm({
  contactId,
  links,
  products,
}: {
  contactId: string;
  links: Option[];
  products: Option[];
}) {
  const [state, formAction, pending] = useActionState(addRoleAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  if (links.length === 0) {
    return <p className="text-sm text-muted">Rattachez d&apos;abord ce contact à un compte pour qualifier son rôle d&apos;achat.</p>;
  }

  return (
    <form action={formAction} noValidate className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="contactId" value={contactId} />

      <SelectField
        key={`role-account-${state.values?.accountId ?? "initial"}`}
        label="Compte concerné"
        name="accountId"
        required
        placeholder="Sélectionner…"
        defaultValue={state.values?.accountId ?? (links.length === 1 ? links[0].id : "")}
        options={links.map((l) => ({ value: l.id, label: l.label }))}
        error={error("accountId")}
      />
      <SelectField
        key={`role-type-${state.values?.roleType ?? "initial"}`}
        label="Rôle d'achat"
        name="roleType"
        required
        placeholder="Sélectionner…"
        defaultValue={state.values?.roleType ?? ""}
        options={ROLE_TYPES.map((r) => ({ value: r.code, label: r.label }))}
        error={error("roleType")}
      />
      <SelectField
        key={`role-product-${state.values?.productId ?? "initial"}`}
        label="Produit ou risque concerné"
        name="productId"
        placeholder="Tous produits"
        defaultValue={state.values?.productId ?? ""}
        options={products.map((p) => ({ value: p.id, label: p.label }))}
        error={error("productId")}
      />
      <SelectField
        key={`role-influence-${state.values?.influence ?? "initial"}`}
        label="Influence"
        name="influence"
        placeholder="Non renseignée"
        defaultValue={state.values?.influence ?? ""}
        options={INFLUENCE_LEVELS.map((i) => ({ value: i.code, label: i.label }))}
        error={error("influence")}
      />

      {state.error && !state.fieldErrors && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {state.error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Ajouter le rôle
        </Button>
      </div>
    </form>
  );
}

/** Détache le contact d'un compte, après confirmation (ses rôles d'achat chez ce compte disparaissent). */
export function UnlinkControl({ contactId, accountId, accountName }: { contactId: string; accountId: string; accountName: string }) {
  const [state, formAction, pending] = useActionState(unlinkContactAction, INITIAL_STATE);

  return (
    <ConfirmDialog
      triggerLabel="Détacher"
      triggerVariant="ghost"
      title={`Détacher ce contact de ${accountName} ?`}
      description="Le contact n'est pas supprimé. Ses rôles d'achat chez ce compte seront supprimés avec le rattachement."
      confirmLabel="Détacher"
      confirmVariant="danger"
      action={formAction}
      pending={pending}
      error={state.error}
      fields={{ contactId, accountId, returnTo: `/contacts/${contactId}` }}
    />
  );
}

/** Pastille d'un rôle d'achat avec son bouton de suppression. */
export function RoleChip({
  roleId,
  roleType,
  productLabel,
  influence,
  returnTo,
  editable,
}: {
  roleId: string;
  roleType: string;
  productLabel: string | null;
  influence: string | null;
  returnTo: string;
  editable: boolean;
}) {
  const label = [labelOf(ROLE_TYPES, roleType), productLabel, influence ? `influence ${labelOf(INFLUENCE_LEVELS, influence).toLowerCase()}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-xs font-medium text-brand-700">
      {label}
      {editable && (
        <form action={removeRoleAction} className="inline-flex">
          <input type="hidden" name="roleId" value={roleId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            aria-label={`Retirer le rôle : ${label}`}
            className="flex size-5 items-center justify-center rounded-full hover:bg-brand-500/20 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </form>
      )}
    </span>
  );
}
