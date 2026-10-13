"use client";

import { useState } from "react";
import { LostOpportunityDialog } from "@/app/(crm)/opportunites/_components/lost-opportunity-dialog";
import { StageMoveDialog, type MovableOpportunity } from "@/app/(crm)/opportunites/_components/stage-move-dialog";
import { Button } from "@/components/ui/button";
import { OPEN_STAGES } from "@/features/opportunities/config";

type OpportunityActionsProps = {
  opportunity: MovableOpportunity;
  qualifiedAbove: number;
  returnTo: string;
};

/** Boutons de la fiche : étape suivante / précédente, gagnée, perdue. Chaque action passe par sa boîte de confirmation. */
export function OpportunityActions({ opportunity, qualifiedAbove, returnTo }: OpportunityActionsProps) {
  const [target, setTarget] = useState<number | null>(null);
  const [losing, setLosing] = useState(false);

  const index = (OPEN_STAGES as readonly number[]).indexOf(opportunity.stage);
  const previous = index > 0 ? OPEN_STAGES[index - 1] : null;
  const next = index >= 0 && index < OPEN_STAGES.length - 1 ? OPEN_STAGES[index + 1] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {previous !== null && (
          <Button variant="secondary" onClick={() => setTarget(previous)}>
            Reculer ({previous} %)
          </Button>
        )}
        {next !== null && <Button onClick={() => setTarget(next)}>Étape suivante ({next} %)</Button>}
        <Button variant="secondary" onClick={() => setTarget(100)}>
          Marquer gagnée
        </Button>
        <Button variant="danger" onClick={() => setLosing(true)}>
          Marquer perdue
        </Button>
      </div>

      {target !== null && (
        <StageMoveDialog
          opportunity={opportunity}
          targetStage={target}
          qualifiedAbove={qualifiedAbove}
          returnTo={returnTo}
          onClose={() => setTarget(null)}
        />
      )}
      {losing && (
        <LostOpportunityDialog opportunity={opportunity} returnTo={returnTo} onClose={() => setLosing(false)} />
      )}
    </>
  );
}
