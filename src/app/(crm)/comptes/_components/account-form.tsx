"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { createAccountAction, updateAccountAction, type AccountFormState } from "@/app/(crm)/comptes/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { ACCOUNT_SOURCES, ACCOUNT_STATUSES, COUNTRIES } from "@/features/accounts/config";
import { SECTORS } from "@/features/leads/config";

type Option = { id: string; label: string };

type AccountFormProps = {
  mode: "create" | "update";
  /** Comptes pouvant devenir le parent (le compte lui-même et ses filiales sont exclus). */
  parents: Option[];
  /** Propriétaires proposés : renseigné seulement pour ceux qui peuvent réaffecter. */
  owners?: { id: string; name: string }[];
  initial: Record<string, string>;
  accountId?: string;
  version?: number;
};

const INITIAL_STATE: AccountFormState = {};

export function AccountForm({ mode, parents, owners, initial, accountId, version }: AccountFormProps) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createAccountAction : updateAccountAction, INITIAL_STATE);
  const values = { ...initial, ...state.values };
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  // Un champ désactivé ne se réinitialise pas comme les autres : la clé recrée les listes avec la valeur renvoyée.
  const keyOf = (name: string) => `${name}-${state.values?.[name] ?? "initial"}`;

  const duplicates = state.duplicates ?? [];
  const identifierClash = duplicates.some((d) => d.matchedOn.includes("identifiant légal"));

  return (
    <form action={formAction} noValidate className="space-y-8">
      {mode === "update" && (
        <>
          <input type="hidden" name="id" value={accountId} />
          <input type="hidden" name="version" value={version} />
        </>
      )}

      {state.error && duplicates.length === 0 && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
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
          {identifierClash ? (
            <p className="mt-3">
              Un même identifiant légal ne peut pas exister deux fois : consultez le compte existant, ou demandez sa fusion
              à la direction.
            </p>
          ) : (
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input type="checkbox" name="forceDuplicate" className="size-4 accent-brand-700" />
              Ce n&apos;est pas un doublon : créer quand même ce compte
            </label>
          )}
        </div>
      )}

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Identité</legend>
        <Field label="Raison sociale" name="legalName" required defaultValue={values.legalName} error={error("legalName")} />
        <Field label="Nom commercial" name="tradeName" defaultValue={values.tradeName} error={error("tradeName")} />
        <Field
          label="Identifiant légal (RCCM, n° de compte contribuable…)"
          name="legalIdentifier"
          defaultValue={values.legalIdentifier}
          error={error("legalIdentifier")}
        />
        <SelectField
          key={keyOf("sector")}
          label="Secteur d'activité"
          name="sector"
          required
          placeholder="Sélectionner…"
          defaultValue={values.sector ?? ""}
          options={SECTORS.map((sector) => ({ value: sector, label: sector }))}
          error={error("sector")}
        />
        <SelectField
          key={keyOf("status")}
          label="Statut"
          name="status"
          required
          defaultValue={values.status ?? "prospect"}
          options={ACCOUNT_STATUSES.map((s) => ({ value: s.code, label: s.label }))}
          error={error("status")}
        />
        <SelectField
          key={keyOf("source")}
          label="Source d'acquisition"
          name="source"
          placeholder="Non renseignée"
          defaultValue={values.source ?? ""}
          options={ACCOUNT_SOURCES.map((s) => ({ value: s.code, label: s.label }))}
          error={error("source")}
        />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Taille et chiffre d&apos;affaires</legend>
        <Field label="Effectif" name="employeeCount" inputMode="numeric" defaultValue={values.employeeCount} error={error("employeeCount")} />
        <Field label="Convention collective" name="collectiveAgreement" defaultValue={values.collectiveAgreement} error={error("collectiveAgreement")} />
        <Field
          label="Chiffre d'affaires (FCFA)"
          name="revenueAmount"
          inputMode="decimal"
          placeholder="1 250 000 000"
          defaultValue={values.revenueAmount}
          error={error("revenueAmount")}
        />
        <Field label="Année de référence" name="revenueYear" inputMode="numeric" placeholder="2025" defaultValue={values.revenueYear} error={error("revenueYear")} />
        <Field label="Source du chiffre d'affaires" name="revenueSource" placeholder="Bilan, déclaration, estimation…" defaultValue={values.revenueSource} error={error("revenueSource")} />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Coordonnées</legend>
        <Field label="Adresse" name="addressLine" defaultValue={values.addressLine} error={error("addressLine")} />
        <Field label="Ville" name="city" defaultValue={values.city} error={error("city")} />
        <SelectField
          key={keyOf("country")}
          label="Pays"
          name="country"
          defaultValue={values.country || "CI"}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))}
          error={error("country")}
        />
        <Field label="Téléphone" name="phone" type="tel" inputMode="tel" defaultValue={values.phone} error={error("phone")} />
        <Field label="Domaine e-mail de l'entreprise" name="emailDomain" placeholder="client.ci" defaultValue={values.emailDomain} error={error("emailDomain")} />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Rattachement</legend>
        <SelectField
          key={keyOf("parentAccountId")}
          label="Compte parent (groupe)"
          name="parentAccountId"
          placeholder="Aucun : compte indépendant ou tête de groupe"
          defaultValue={values.parentAccountId ?? ""}
          options={parents.map((p) => ({ value: p.id, label: p.label }))}
          error={error("parentAccountId")}
        />
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
          {mode === "create" ? "Créer le compte" : "Enregistrer les modifications"}
        </Button>
        <Link href={mode === "update" && accountId ? `/comptes/${accountId}` : "/comptes"} className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
