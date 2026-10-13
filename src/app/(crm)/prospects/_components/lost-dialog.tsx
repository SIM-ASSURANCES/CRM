"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { markLostAction, type LeadFormState } from "@/app/(crm)/prospects/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { LOSS_REASONS } from "@/features/leads/config";

const INITIAL_STATE: LeadFormState = {};

/** Clôture en perte : le motif est obligatoire (CDC 5.4) ; un commentaire est exigé pour « Autre ». */
export function LostDialog({ leadId, version, companyName }: { leadId: string; version: number; companyName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(markLostAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <>
      <Button variant="secondary" onClick={() => dialogRef.current?.showModal()} className="text-danger">
        Marquer comme perdu
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="lost-title"
        className="m-auto w-full max-w-md rounded-2xl border border-line p-6 shadow-xl backdrop:bg-black/40"
      >
        <form action={formAction} noValidate className="space-y-5">
          <h2 id="lost-title" className="text-xl font-bold text-ink">
            Marquer {companyName} comme perdu
          </h2>
          <input type="hidden" name="id" value={leadId} />
          <input type="hidden" name="version" value={version} />

          {state.error && !state.fieldErrors && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}

          <SelectField
            label="Motif de perte"
            name="reason"
            required
            placeholder="Sélectionner…"
            defaultValue={state.values?.reason ?? ""}
            options={LOSS_REASONS.map((reason) => ({ value: reason.code, label: reason.label }))}
            error={error("reason")}
          />

          <div>
            <label htmlFor="lost-comment" className="mb-1.5 block text-sm font-medium text-ink">
              Commentaire
            </label>
            <textarea
              id="lost-comment"
              name="comment"
              rows={3}
              defaultValue={state.values?.comment}
              aria-invalid={error("comment") ? true : undefined}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
            />
            {error("comment") && (
              <p role="alert" className="mt-1 text-xs text-danger">
                {error("comment")}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Confirmer la perte
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
