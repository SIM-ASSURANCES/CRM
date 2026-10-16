import { summarize, weightedAmount } from "@/features/opportunities/rules";
import type { BoardCard, BoardData } from "@/features/opportunities/service";

// Logique pure du tableau Kanban (sans accès base, sans React) : testable sans navigateur. Le composant s'en sert pour
// afficher le résultat d'un déplacement AVANT la réponse du serveur ; le serveur reste seul juge (s'il refuse, le tableau
// revient à l'état d'origine).

type Columns = BoardData["columns"];

/** Au-delà de ces durées dans la même étape, la carte est signalée (« qui stagne », comme chez HubSpot). */
export const STALE_AFTER_DAYS = 14;
export const VERY_STALE_AFTER_DAYS = 30;

export type Staleness = "fresh" | "stale" | "very-stale";

export function staleness(daysInStage: number): Staleness {
  if (daysInStage >= VERY_STALE_AFTER_DAYS) return "very-stale";
  if (daysInStage >= STALE_AFTER_DAYS) return "stale";
  return "fresh";
}

export function daysInStageLabel(days: number): string {
  if (days <= 0) return "Dans l'étape depuis aujourd'hui";
  return `Dans l'étape depuis ${days} j`;
}

/**
 * Déplace une carte vers une étape ouverte : nouvelle colonne, montant pondéré recalculé, ancienneté remise à zéro, totaux
 * des deux colonnes recalculés. Renvoie les colonnes d'origine si la carte ou l'étape n'existe pas.
 */
export function moveCard(columns: Columns, cardId: string, targetStage: number, version?: number): Columns {
  const source = columns.find((column) => column.cards.some((card) => card.id === cardId));
  const destination = columns.find((column) => column.stage === targetStage);
  const card = source?.cards.find((candidate) => candidate.id === cardId);
  if (!source || !destination || !card || source.stage === destination.stage) return columns;

  const moved: BoardCard = {
    ...card,
    stage: destination.stage,
    weighted: weightedAmount(card.amount, destination.stage),
    daysInStage: 0,
    version: version ?? card.version,
  };

  return columns.map((column) => {
    if (column.stage === source.stage) {
      const cards = column.cards.filter((candidate) => candidate.id !== cardId);
      return { ...column, cards, totals: summarize(cards) };
    }
    if (column.stage === destination.stage) {
      const cards = [moved, ...column.cards];
      return { ...column, cards, totals: summarize(cards) };
    }
    return column;
  });
}

/** Met à jour la version d'une carte après un déplacement confirmé par le serveur (verrou optimiste). */
export function withVersion(columns: Columns, cardId: string, version: number): Columns {
  return columns.map((column) => ({
    ...column,
    cards: column.cards.map((card) => (card.id === cardId ? { ...card, version } : card)),
  }));
}

/** Un recul sans information manquante peut être appliqué immédiatement ; le reste passe par la boîte de dialogue. */
export function canMoveInstantly(card: Pick<BoardCard, "stage" | "productLabel" | "amount">, target: number, qualifiedAbove: number): boolean {
  const backward = target < card.stage && target !== 100;
  // Même règle que le serveur (validateStageMove) : au-delà du seuil de qualification, produit et montant sont exigés.
  const complete = target <= qualifiedAbove || (Boolean(card.productLabel) && card.amount > 0);
  return backward && complete;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return letters.toLocaleUpperCase("fr-FR");
}
