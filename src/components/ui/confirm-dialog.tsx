"use client";

import { Loader2 } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type ConfirmDialogProps = {
  triggerLabel: string;
  triggerVariant?: Variant;
  triggerDisabled?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: Variant;
  /** Action serveur (celle renvoyée par useActionState) exécutée à la confirmation. */
  action: (formData: FormData) => void;
  pending: boolean;
  /** Message d'erreur du dernier essai : la boîte reste ouverte pour qu'il soit lu. */
  error?: string;
  /** Champs cachés envoyés avec l'action (identifiants, état cible…). */
  fields: Record<string, string>;
};

/** Confirmation explicite avant une action sensible (réinitialisation, désactivation, suppression). */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "secondary",
  triggerDisabled,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  action,
  pending,
  error,
  fields,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <Button variant={triggerVariant} disabled={triggerDisabled} onClick={() => ref.current?.showModal()}>
        {triggerLabel}
      </Button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-full max-w-md rounded-2xl border border-line p-6 shadow-xl backdrop:bg-black/40"
      >
        <form action={action} className="space-y-5">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <h2 id={titleId} className="text-xl font-bold text-ink">
            {title}
          </h2>
          <p className="text-sm text-ink-soft">{description}</p>

          {error && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => ref.current?.close()}>
              Annuler
            </Button>
            <Button type="submit" variant={confirmVariant} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
