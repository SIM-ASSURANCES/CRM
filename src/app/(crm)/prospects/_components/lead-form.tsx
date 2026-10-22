"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createLeadAction,
  updateLeadAction,
  type LeadFormState,
} from "@/app/(crm)/prospects/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import {
  PROGRESS_STEPS,
  SECTORS,
  STAGE_CRITERIA,
  STAGE_LABELS,
  type LeadThresholds,
} from "@/features/leads/config";

type LeadFormProps = {
  mode: "create" | "update";
  products: { id: string; label: string }[];
  thresholds: LeadThresholds;
  /** Date du jour (AAAA-MM-JJ) : borne maximale du champ « date d'insertion ». */
  today: string;
  initial: Record<string, string>;
  leadId?: string;
  version?: number;
};

const INITIAL_STATE: LeadFormState = {};

export function LeadForm({ mode, products, thresholds, today, initial, leadId, version }: LeadFormProps) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createLeadAction : updateLeadAction,
    INITIAL_STATE,
  );
  // Après une erreur, on réaffiche ce que l'utilisateur avait saisi ; sinon les valeurs de départ.
  const values = { ...initial, ...state.values };
  const [progress, setProgress] = useState(Number(values.progress ?? 10));
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  const needsQualification = progress > thresholds.qualifiedAbove;
  const isWon = progress === 100;
  const criteria = (STAGE_CRITERIA as Record<number, string>)[progress];

  return (
    <form action={formAction} noValidate className="space-y-8">
      {mode === "update" && (
        <>
          <input type="hidden" name="id" value={leadId} />
          <input type="hidden" name="version" value={version} />
        </>
      )}

      {state.error && !state.duplicates?.length && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {state.duplicates && state.duplicates.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          <p className="font-semibold">Un prospect similaire existe déjà :</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {state.duplicates.map((duplicate) => (
              <li key={`${duplicate.companyName}-${duplicate.ownerName}`}>
                {duplicate.companyName} (suivi par {duplicate.ownerName}) — correspondance sur{" "}
                {duplicate.matchedOn.join(", ")}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input type="checkbox" name="forceDuplicate" className="size-4 accent-brand-700" />
            Ce n&apos;est pas un doublon : créer quand même ce prospect
          </label>
        </div>
      )}

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Entreprise</legend>
        <Field label="Nom de l'entreprise" name="companyName" required defaultValue={values.companyName} error={error("companyName")} />
        <SelectField
          label="Secteur d'activité"
          name="sector"
          required
          placeholder="Sélectionner…"
          defaultValue={values.sector ?? ""}
          options={SECTORS.map((sector) => ({ value: sector, label: sector }))}
          error={error("sector")}
        />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Contact</legend>
        <Field label="Nom du prospect" name="contactLastName" required autoComplete="off" defaultValue={values.contactLastName} error={error("contactLastName")} />
        <Field label="Prénom du prospect" name="contactFirstName" required autoComplete="off" defaultValue={values.contactFirstName} error={error("contactFirstName")} />
        <Field label="Fonction du prospect" name="jobTitle" required defaultValue={values.jobTitle} error={error("jobTitle")} />
        <Field label="Contact téléphonique" name="phone" type="tel" inputMode="tel" required autoComplete="off" defaultValue={values.phone} error={error("phone")} />
        <Field label="Adresse e-mail" name="email" type="email" required autoComplete="off" defaultValue={values.email} error={error("email")} />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-ink">Suivi commercial</legend>
        {/* Non modifiable : la date d'insertion d'un nouveau prospect est celle du jour (ni passée ni future), et elle ne change
            plus ensuite. Le champ reste envoyé avec le formulaire (readOnly, pas disabled) ; le serveur revérifie la règle. */}
        <Field
          label={mode === "create" ? "Date d'insertion (date du jour)" : "Date d'insertion (non modifiable)"}
          name="insertedOn"
          type="date"
          readOnly
          min={mode === "create" ? today : undefined}
          max={today}
          required
          className="cursor-not-allowed bg-surface text-ink-soft"
          defaultValue={values.insertedOn}
          error={error("insertedOn")}
        />
        <div>
          <SelectField
            label="Process de vente"
            name="progress"
            required
            // Non contrôlé : React vide les champs après une action. Pour une liste déroulante, un changement de
            // `defaultValue` ne met pas à jour l'option sélectionnée : la `key` recrée le champ avec la valeur
            // renvoyée par le serveur. `progress` ne sert qu'à afficher les panneaux conditionnels.
            key={`progress-${state.values?.progress ?? "initial"}`}
            defaultValue={String(values.progress ?? "10")}
            onChange={(event) => setProgress(Number(event.target.value))}
            options={PROGRESS_STEPS.map((step) => ({ value: step, label: `${step} % — ${STAGE_LABELS[step]}` }))}
            error={error("progress")}
          />
          {criteria && <p className="mt-1 text-xs text-muted">{criteria}</p>}
        </div>
      </fieldset>

      {/* Fenêtre de qualification de l'Excel : produit proposé + chiffre d'affaires, exigés au-delà du seuil.
          Les champs restent dans le formulaire (masqués) pour ne pas perdre les valeurs si l'étape est abaissée. */}
      <fieldset className={needsQualification ? "rounded-xl border border-brand-500/40 bg-brand-50 p-5" : "hidden"}>
        <legend className="px-2 text-lg font-semibold text-ink">Qualification</legend>
        <p className="mb-4 text-sm text-ink-soft">
          À cette étape, renseignez le produit proposé et le chiffre d&apos;affaires attendu de l&apos;offre.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label="Produit proposé"
            name="productId"
            required={needsQualification}
            placeholder="Sélectionner…"
            defaultValue={values.productId ?? ""}
            options={products.map((product) => ({ value: product.id, label: product.label }))}
            error={error("productId")}
          />
          <Field
            label="Chiffre d'affaires attendu (FCFA)"
            name="expectedRevenue"
            inputMode="decimal"
            required={needsQualification}
            placeholder="6 245 790"
            defaultValue={values.expectedRevenue}
            error={error("expectedRevenue")}
          />
        </div>
      </fieldset>

      <div className={isWon ? "rounded-xl border border-emerald-300 bg-emerald-50 p-5" : "hidden"}>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
          <input type="checkbox" name="wonConfirmed" defaultChecked={values.wonConfirmed === "on"} className="mt-0.5 size-4 accent-brand-700" />
          <span>
            Je confirme que le <strong>contrat est signé par les deux parties</strong> et que le{" "}
            <strong>premier paiement est validé</strong>. Le prospect sera clôturé comme gagné.
          </span>
        </label>
        {error("wonConfirmed") && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error("wonConfirmed")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {pending ? "Enregistrement…" : mode === "create" ? "Enregistrer le prospect" : "Enregistrer les modifications"}
        </Button>
        <Link href="/prospects" className={buttonClasses("secondary")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
