"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { analyzeAction } from "@/app/(crm)/admin/import/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import type { AdminFormState } from "@/lib/action-result";

type Option = { value: string; label: string };

type MappingFormProps = {
  batchId: string;
  entity: "accounts" | "contacts" | "leads";
  headers: string[];
  fields: { key: string; label: string; required: boolean; hint?: string }[];
  /** Association de départ : celle déjà enregistrée, sinon la suggestion automatique. */
  initialMapping: Record<string, string>;
  initialDefaults: { ownerUserId?: string; sector?: string; status?: string; country?: string };
  owners: Option[];
  sectors: Option[];
  statuses: Option[];
  countries: Option[];
  /** Libellé du bouton : « Analyser le fichier » la première fois, « Relancer l'analyse » ensuite. */
  submitLabel: string;
};

const INITIAL_STATE: AdminFormState = {};

/**
 * Étape 2 : associer chaque champ du CRM à une colonne du fichier et choisir les valeurs par défaut. L'analyse qui suit
 * ne crée rien : elle produit un rapport de qualité à relire avant l'import.
 */
export function MappingForm({
  batchId,
  entity,
  headers,
  fields,
  initialMapping,
  initialDefaults,
  owners,
  sectors,
  statuses,
  countries,
  submitLabel,
}: MappingFormProps) {
  const [state, formAction, pending] = useActionState(analyzeAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  const value = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  // Les listes déroulantes ne se réinitialisent pas comme les champs texte : la clé les recrée avec la valeur renvoyée.
  const keyOf = (name: string) => `${name}-${state.values?.[name] ?? "initial"}`;

  return (
    <form action={formAction} noValidate className="space-y-8">
      <input type="hidden" name="id" value={batchId} />

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-ink">Association des colonnes</legend>
        <p className="text-sm text-ink-soft">
          Pour chaque information du CRM, choisissez la colonne de votre fichier qui la contient. Les colonnes non associées sont
          ignorées.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <SelectField
              key={keyOf(`map_${field.key}`)}
              label={field.hint ? `${field.label} — ${field.hint}` : field.label}
              name={`map_${field.key}`}
              required={field.required}
              placeholder="— Non importé —"
              defaultValue={value(`map_${field.key}`, initialMapping[field.key] ?? "")}
              options={headers.map((header) => ({ value: header, label: header }))}
              error={error(`mapping_${field.key}`)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-ink">Valeurs par défaut</legend>
        <p className="text-sm text-ink-soft">Utilisées quand la colonne n&apos;est pas associée ou que la cellule est vide.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            key={keyOf("ownerUserId")}
            label="Responsable commercial"
            name="ownerUserId"
            required
            placeholder="Sélectionner…"
            defaultValue={value("ownerUserId", initialDefaults.ownerUserId ?? "")}
            options={owners}
            error={error("ownerUserId")}
          />
          {entity === "accounts" && (
            <SelectField
              key={keyOf("sector")}
              label="Secteur d'activité"
              name="sector"
              placeholder="Aucun (la colonne doit le fournir)"
              defaultValue={value("sector", initialDefaults.sector ?? "")}
              options={sectors}
              error={error("sector")}
            />
          )}
          {/* Prospects : le statut vient du fichier (ou du process de vente), jamais d'une valeur par défaut. */}
          {entity !== "leads" && (
            <SelectField
              key={keyOf("status")}
              label="Statut"
              name="status"
              placeholder={entity === "accounts" ? "Prospect" : "Actif"}
              defaultValue={value("status", initialDefaults.status ?? "")}
              options={statuses}
              error={error("status")}
            />
          )}
          {entity === "accounts" && (
            <SelectField
              key={keyOf("country")}
              label="Pays"
              name="country"
              placeholder="Côte d'Ivoire"
              defaultValue={value("country", initialDefaults.country ?? "")}
              options={countries}
              error={error("country")}
            />
          )}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {submitLabel}
      </Button>
    </form>
  );
}
