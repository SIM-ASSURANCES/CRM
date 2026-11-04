"use client";

import { useActionState } from "react";
import { deleteLeadAction, type LeadFormState } from "@/app/(crm)/prospects/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const INITIAL_STATE: LeadFormState = {};

/** Suppression définitive d'un prospect : confirmation explicite, l'opération est irréversible. */
export function DeleteLeadDialog({ leadId, companyName, converted }: { leadId: string; companyName: string; converted: boolean }) {
  const [state, formAction, pending] = useActionState(deleteLeadAction, INITIAL_STATE);

  return (
    <ConfirmDialog
      triggerLabel="Supprimer"
      triggerVariant="secondary"
      title={`Supprimer ${companyName} ?`}
      description={
        "Le prospect et tout son historique d'étapes seront supprimés définitivement : les statistiques des semaines passées ne le compteront plus. " +
        (converted
          ? "Le compte, le contact et l'opportunité créés à sa conversion sont conservés. "
          : "") +
        "Cette action ne peut pas être annulée ; elle est tracée dans le journal d'audit."
      }
      confirmLabel="Supprimer définitivement"
      confirmVariant="danger"
      action={formAction}
      pending={pending}
      error={state.error}
      fields={{ id: leadId }}
    />
  );
}
