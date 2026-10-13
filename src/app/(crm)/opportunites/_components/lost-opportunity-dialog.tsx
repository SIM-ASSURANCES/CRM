"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { markOpportunityLostAction, type OpportunityFormState } from "@/app/(crm)/opportunites/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { LOSS_REASONS } from "@/features/leads/config";

const INITIAL_STATE: OpportunityFormState = {};

/** Clôture en perte : le motif est obligatoire (CDC 5.4), un commentaire est exigé pour « Autre ». Monté à la demande. */
export function LostOpportunityDialog({
  opportunity,
  returnTo,
  onClose,
}: {
  opportunity: { id: string; version: number; name: string };
  returnTo: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(markOpportunityLostAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <dialog
      ref={(element) => {
        if (element && !element.open) element.showModal();
      }}
      onClose={onClose}
      aria-labelledby="lost-opp-title"
      className="m-auto w-full max-w-md rounded-2xl border border-line p-6 shadow-xl backdrop:bg-black/40"
    >
      <form action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="id" value={opportunity.id} />
        <input type="hidden" name="version" value={opportunity.version} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <div>
          <h2 id="lost-opp-title" className="text-xl font-bold text-ink">
            Marquer comme perdue
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{opportunity.name}</p>
        </div>

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
          <label htmlFor="lost-opp-comment" className="mb-1.5 block text-sm font-medium text-ink">
            Commentaire
          </label>
          <textarea
            id="lost-opp-comment"
            name="comment"
            rows={3}
            defaultValue={state.values?.comment}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
          />
          {error("comment") && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error("comment")}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={(event) => event.currentTarget.closest("dialog")?.close()}>
            Annuler
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Confirmer la perte
          </Button>
        </div>
      </form>
    </dialog>
  );
}
