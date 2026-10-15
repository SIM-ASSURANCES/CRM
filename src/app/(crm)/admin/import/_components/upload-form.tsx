"use client";

import { Loader2, Upload } from "lucide-react";
import { useActionState } from "react";
import { uploadAction } from "@/app/(crm)/admin/import/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { IMPORT_ENTITIES, IMPORT_ENTITY_LABELS } from "@/features/imports/config";
import type { AdminFormState } from "@/lib/action-result";

const INITIAL_STATE: AdminFormState = {};

/** Étape 1 : choisir ce que l'on importe et déposer le fichier. Rien n'est créé à ce stade. */
export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.error && !state.fieldErrors && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          key={`entity-${state.values?.entity ?? "initial"}`}
          label="Que voulez-vous importer ?"
          name="entity"
          required
          placeholder="Sélectionner…"
          defaultValue={state.values?.entity ?? ""}
          options={IMPORT_ENTITIES.map((entity) => ({ value: entity, label: IMPORT_ENTITY_LABELS[entity] }))}
          error={error("entity")}
        />
        <div>
          <label htmlFor="import-file" className="mb-1.5 block text-sm font-medium text-ink">
            Fichier (.csv ou .xlsx)
            <span className="ml-0.5 text-danger" aria-hidden="true">*</span>
          </label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".csv,.xlsx,.txt"
            required
            aria-invalid={error("file") ? true : undefined}
            aria-describedby={error("file") ? "import-file-error" : undefined}
            className="block w-full rounded-lg border border-line bg-white text-sm text-ink file:mr-3 file:h-10 file:border-0 file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink"
          />
          {error("file") && (
            <p id="import-file-error" role="alert" className="mt-1 text-xs text-danger">
              {error("file")}
            </p>
          )}
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
        Déposer et continuer
      </Button>
    </form>
  );
}
