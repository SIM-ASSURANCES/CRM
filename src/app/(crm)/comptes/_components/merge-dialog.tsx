"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { mergeAccountsAction, type AccountFormState } from "@/app/(crm)/comptes/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";

const INITIAL_STATE: AccountFormState = {};

/**
 * Fusion de doublons (CDC 3.2) : ce compte est archivé et ses filiales, contacts et rôles passent au compte choisi.
 * Réservé aux profils autorisés ; l'opération est atomique et tracée.
 */
export function MergeDialog({
  sourceId,
  sourceName,
  options,
}: {
  sourceId: string;
  sourceName: string;
  options: { id: string; label: string }[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(mergeAccountsAction, INITIAL_STATE);
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <>
      <Button variant="secondary" onClick={() => ref.current?.showModal()}>
        Fusionner dans un autre compte
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="merge-title"
        className="m-auto w-full max-w-lg rounded-2xl border border-line p-6 shadow-xl backdrop:bg-black/40"
      >
        <form action={formAction} noValidate className="space-y-5">
          <input type="hidden" name="sourceId" value={sourceId} />
          <h2 id="merge-title" className="text-xl font-bold text-ink">
            Fusionner {sourceName}
          </h2>
          <p className="text-sm text-ink-soft">
            Ce compte sera <strong>archivé</strong>. Ses filiales, ses contacts et leurs rôles d&apos;achat seront transférés
            au compte que vous choisissez ci-dessous, qui complète aussi ses champs vides. L&apos;opération est tracée et le
            compte archivé garde un renvoi vers le compte conservé.
          </p>

          {state.error && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}

          <SelectField
            label="Compte à conserver"
            name="targetId"
            required
            placeholder="Sélectionner…"
            options={options.map((o) => ({ value: o.id, label: o.label }))}
            error={error("targetId")}
          />

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => ref.current?.close()}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Fusionner et archiver
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
