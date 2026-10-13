"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { moveStageAction, type OpportunityFormState } from "@/app/(crm)/opportunites/actions";
import { Button } from "@/components/ui/button";
import { STAGE_CRITERIA, STAGE_LABELS } from "@/features/opportunities/config";
import { weightedAmount } from "@/features/opportunities/rules";
import { formatFcfa } from "@/lib/format";

const INITIAL_STATE: OpportunityFormState = {};

export type MovableOpportunity = {
  id: string;
  version: number;
  name: string;
  stage: number;
  amount: number;
  productLabel: string | null;
};

type StageMoveDialogProps = {
  opportunity: MovableOpportunity;
  targetStage: number;
  /** Seuil au-delà duquel produit et montant sont obligatoires (paramètre de qualification). */
  qualifiedAbove: number;
  returnTo: string;
  onClose: () => void;
};

const labelOf = (stage: number) => `${STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage} (${stage} %)`;

/**
 * Changement d'étape avec checklist (CDC 5.1) : avancer demande de confirmer le critère de l'étape visée, gagner demande
 * de confirmer le contrat signé et le premier paiement. Monté à la demande : il s'ouvre dès son affichage.
 */
export function StageMoveDialog({ opportunity, targetStage, qualifiedAbove, returnTo, onClose }: StageMoveDialogProps) {
  const [state, formAction, pending] = useActionState(moveStageAction, INITIAL_STATE);

  const advancing = targetStage > opportunity.stage;
  const won = targetStage === 100;
  const incomplete = targetStage > qualifiedAbove && (!opportunity.productLabel || !(opportunity.amount > 0));
  const criterion = STAGE_CRITERIA[targetStage as keyof typeof STAGE_CRITERIA];
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");

  return (
    <dialog
      ref={(element) => {
        if (element && !element.open) element.showModal();
      }}
      onClose={onClose}
      aria-labelledby="stage-title"
      className="m-auto w-full max-w-lg rounded-2xl border border-line p-6 shadow-xl backdrop:bg-black/40"
    >
      <form action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="id" value={opportunity.id} />
        <input type="hidden" name="version" value={opportunity.version} />
        <input type="hidden" name="targetStage" value={targetStage} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <div>
          <h2 id="stage-title" className="text-xl font-bold text-ink">
            {won ? "Marquer comme gagnée" : advancing ? "Faire avancer l'opportunité" : "Faire reculer l'opportunité"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{opportunity.name}</p>
        </div>

        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink">
          {labelOf(opportunity.stage)} <span aria-hidden="true">→</span> <strong>{labelOf(targetStage)}</strong>
          <br />
          <span className="text-muted">
            Montant pondéré à cette étape : {formatFcfa(weightedAmount(opportunity.amount, targetStage))}
          </span>
        </p>

        {incomplete && (
          <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
            À cette étape, le <strong>produit</strong> et un <strong>montant estimé</strong> sont obligatoires.{" "}
            <Link href={`/opportunites/${opportunity.id}/modifier`} className="font-medium text-brand-700 underline">
              Compléter la fiche
            </Link>
          </p>
        )}

        {!advancing && !won && (
          <p className="text-sm text-ink-soft">Le recul est enregistré dans l&apos;historique de l&apos;opportunité.</p>
        )}

        {won ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-ink">
            <input type="checkbox" name="wonConfirmed" className="mt-0.5 size-4 accent-brand-700" />
            <span>
              Je confirme que le <strong>contrat est signé par les deux parties</strong> et que le{" "}
              <strong>premier paiement est validé</strong>.
            </span>
          </label>
        ) : (
          advancing && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4 text-sm text-ink">
              <input type="checkbox" name="criteriaConfirmed" className="mt-0.5 size-4 accent-brand-700" />
              <span>
                <strong>Critère de l&apos;étape rempli :</strong> {criterion}
              </span>
            </label>
          )
        )}

        {(error("wonConfirmed") || error("criteriaConfirmed") || error("targetStage") || error("productId") || error("amount")) && (
          <p role="alert" className="text-sm text-danger">
            {[error("wonConfirmed"), error("criteriaConfirmed"), error("targetStage"), error("productId"), error("amount")]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
        {state.error && !state.fieldErrors && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={(event) => event.currentTarget.closest("dialog")?.close()}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending || incomplete}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {won ? "Confirmer le gain" : "Confirmer"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
