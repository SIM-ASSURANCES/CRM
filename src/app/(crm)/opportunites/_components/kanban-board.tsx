"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LostOpportunityDialog } from "@/app/(crm)/opportunites/_components/lost-opportunity-dialog";
import { StageMoveDialog } from "@/app/(crm)/opportunites/_components/stage-move-dialog";
import { STAGE_LABELS } from "@/features/opportunities/config";
import type { BoardData, OpportunityCard } from "@/features/opportunities/service";
import { formatDate, formatFcfa } from "@/lib/format";
import { cn } from "@/lib/utils";

type KanbanBoardProps = {
  board: BoardData;
  canWrite: boolean;
  qualifiedAbove: number;
  /** Chemin (avec filtres) où revenir après une action : les filtres sont conservés. */
  returnTo: string;
};

type Pending = { card: OpportunityCard; target: number } | null;

const stageName = (stage: number) => STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? String(stage);

/**
 * Tableau Kanban : une colonne par étape ouverte. Le déplacement se fait par glisser-déposer OU par le sélecteur de
 * chaque carte (accessible au clavier). Dans les deux cas, rien n'est écrit tant que la boîte de confirmation (checklist
 * des critères de sortie, motif de perte) n'a pas été validée : le serveur reste seul juge des règles.
 */
export function KanbanBoard({ board, canWrite, qualifiedAbove, returnTo }: KanbanBoardProps) {
  const [pending, setPending] = useState<Pending>(null);
  const [losing, setLosing] = useState<OpportunityCard | null>(null);
  const [dragged, setDragged] = useState<OpportunityCard | null>(null);
  const [overZone, setOverZone] = useState<string | null>(null);

  const requestMove = (card: OpportunityCard, target: number) => {
    if (target !== card.stage) setPending({ card, target });
  };

  const dropOn = (zone: string, handler: (card: OpportunityCard) => void) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragged) return;
      event.preventDefault();
      setOverZone(zone);
    },
    onDragLeave: () => setOverZone((current) => (current === zone ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setOverZone(null);
      if (dragged) handler(dragged);
      setDragged(null);
    },
  });

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4" role="list" aria-label="Étapes du pipeline">
        {board.columns.map((column) => (
          <section
            key={column.stage}
            role="listitem"
            aria-label={`${stageName(column.stage)} (${column.stage} %)`}
            {...(canWrite ? dropOn(`stage-${column.stage}`, (card) => requestMove(card, column.stage)) : {})}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-2xl border bg-surface p-3 transition-colors",
              overZone === `stage-${column.stage}` ? "border-brand-500 bg-brand-50" : "border-line",
            )}
          >
            <header className="mb-3 px-1">
              <h3 className="flex items-center justify-between text-sm font-semibold text-ink">
                <span>
                  {stageName(column.stage)} <span className="text-muted">({column.stage} %)</span>
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-soft">{column.totals.count}</span>
              </h3>
              <p className="mt-1 text-xs text-muted">
                Brut {formatFcfa(column.totals.gross)} · Pondéré {formatFcfa(column.totals.weighted)}
              </p>
            </header>

            <ul className="flex flex-1 flex-col gap-3">
              {column.cards.length === 0 && <li className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">Aucune opportunité</li>}
              {column.cards.map((card) => (
                <li
                  key={card.id}
                  draggable={canWrite}
                  onDragStart={() => setDragged(card)}
                  onDragEnd={() => {
                    setDragged(null);
                    setOverZone(null);
                  }}
                  className={cn(
                    "rounded-xl border bg-white p-3 text-sm shadow-sm",
                    canWrite && "cursor-grab active:cursor-grabbing",
                    card.overdue ? "border-danger/50" : "border-line",
                    dragged?.id === card.id && "opacity-50",
                  )}
                >
                  <Link href={`/opportunites/${card.id}`} className="font-semibold text-brand-700 hover:underline">
                    {card.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-soft">{card.accountName}</p>
                  <p className="mt-2 font-semibold text-ink">{formatFcfa(card.amount)}</p>
                  <p className="text-xs text-muted">Pondéré {formatFcfa(card.weighted)}</p>
                  <p className="mt-2 text-xs text-ink-soft">
                    {card.nextAction}
                    {card.nextActionDate && (
                      <span className={cn("ml-1 inline-flex items-center gap-1", card.overdue && "font-semibold text-danger")}>
                        {card.overdue && <AlertTriangle className="size-3" aria-hidden="true" />}
                        {formatDate(card.nextActionDate)}
                        {card.overdue && " (en retard)"}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted">{card.ownerName}</p>

                  {canWrite && (
                    <label className="mt-3 block text-xs text-muted">
                      <span className="sr-only">Déplacer {card.name}</span>
                      <select
                        value=""
                        aria-label={`Déplacer ${card.name}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "lost") setLosing(card);
                          else if (value) requestMove(card, Number(value));
                        }}
                        className="h-8 w-full rounded-md border border-line bg-white px-2 text-xs text-ink"
                      >
                        <option value="">Déplacer vers…</option>
                        {board.columns
                          .filter((other) => other.stage !== card.stage)
                          .map((other) => (
                            <option key={other.stage} value={other.stage}>
                              {stageName(other.stage)} ({other.stage} %)
                            </option>
                          ))}
                        <option value="100">Gagnée (100 %)</option>
                        <option value="lost">Perdue…</option>
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {canWrite && (
        <div className="mt-2 grid gap-4 sm:grid-cols-2" aria-label="Clôturer par glisser-déposer">
          <div
            {...dropOn("won", (card) => requestMove(card, 100))}
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-sm font-semibold text-emerald-800",
              overZone === "won" ? "border-emerald-500 bg-emerald-100" : "border-emerald-300 bg-emerald-50",
            )}
          >
            <CheckCircle2 className="size-5" aria-hidden="true" /> Déposer ici : gagnée
          </div>
          <div
            {...dropOn("lost", (card) => setLosing(card))}
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-sm font-semibold text-danger",
              overZone === "lost" ? "border-danger bg-red-100" : "border-danger/40 bg-red-50",
            )}
          >
            <XCircle className="size-5" aria-hidden="true" /> Déposer ici : perdue
          </div>
        </div>
      )}

      {pending && (
        <StageMoveDialog
          opportunity={{
            id: pending.card.id,
            version: pending.card.version,
            name: pending.card.name,
            stage: pending.card.stage,
            amount: pending.card.amount,
            productLabel: pending.card.productLabel,
          }}
          targetStage={pending.target}
          qualifiedAbove={qualifiedAbove}
          returnTo={returnTo}
          onClose={() => setPending(null)}
        />
      )}
      {losing && (
        <LostOpportunityDialog
          opportunity={{ id: losing.id, version: losing.version, name: losing.name }}
          returnTo={returnTo}
          onClose={() => setLosing(null)}
        />
      )}
    </>
  );
}
