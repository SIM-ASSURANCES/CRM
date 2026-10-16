import { describe, expect, it } from "vitest";
import {
  canMoveInstantly,
  daysInStageLabel,
  initials,
  moveCard,
  staleness,
  withVersion,
} from "@/features/opportunities/board";
import { OPEN_STAGES } from "@/features/opportunities/config";
import { summarize } from "@/features/opportunities/rules";
import type { BoardCard, BoardData } from "@/features/opportunities/service";

function card(id: string, stage: number, amount: number, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    name: `Opportunité ${id}`,
    accountId: "compte",
    accountName: "Compte",
    ownerName: "Awa Koné",
    productLabel: "RELAX Auto",
    amount,
    weighted: (amount * stage) / 100,
    stage,
    status: "open",
    expectedCloseDate: null,
    nextAction: "Relancer",
    nextActionDate: null,
    overdue: false,
    version: 1,
    daysInStage: 20,
    contact: null,
    ...extra,
  };
}

function board(cards: BoardCard[]): BoardData["columns"] {
  return OPEN_STAGES.map((stage) => {
    const stageCards = cards.filter((c) => c.stage === stage);
    return { stage, cards: stageCards, totals: summarize(stageCards) };
  });
}

describe("moveCard", () => {
  const columns = board([card("a", 60, 1000), card("b", 60, 500), card("c", 20, 200)]);

  it("change la carte de colonne et recalcule le pondéré et l'ancienneté", () => {
    const next = moveCard(columns, "a", 20);
    const from = next.find((c) => c.stage === 60)!;
    const to = next.find((c) => c.stage === 20)!;

    expect(from.cards.map((c) => c.id)).toEqual(["b"]);
    expect(to.cards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(to.cards[0]).toMatchObject({ stage: 20, weighted: 200, daysInStage: 0 });
  });

  it("recalcule les totaux des deux colonnes et conserve le total du portefeuille", () => {
    const next = moveCard(columns, "a", 20);
    expect(next.find((c) => c.stage === 60)!.totals).toEqual({ count: 1, gross: 500, weighted: 300 });
    expect(next.find((c) => c.stage === 20)!.totals).toEqual({ count: 2, gross: 1200, weighted: 240 });
    expect(summarize(next.flatMap((c) => c.cards)).gross).toBe(summarize(columns.flatMap((c) => c.cards)).gross);
  });

  it("ne modifie pas les colonnes d'origine (état immuable)", () => {
    const snapshot = JSON.stringify(columns);
    moveCard(columns, "a", 20);
    expect(JSON.stringify(columns)).toBe(snapshot);
  });

  it("ignore une carte inconnue, une étape inconnue et une étape identique", () => {
    expect(moveCard(columns, "zzz", 20)).toBe(columns);
    expect(moveCard(columns, "a", 100)).toBe(columns);
    expect(moveCard(columns, "a", 60)).toBe(columns);
  });

  it("applique la version fournie, sinon garde l'actuelle", () => {
    expect(moveCard(columns, "a", 20, 7).find((c) => c.stage === 20)!.cards[0].version).toBe(7);
    expect(moveCard(columns, "a", 20).find((c) => c.stage === 20)!.cards[0].version).toBe(1);
  });
});

describe("withVersion", () => {
  it("met à jour la version de la seule carte visée", () => {
    const next = withVersion(board([card("a", 60, 1000), card("b", 60, 500)]), "a", 4);
    const versions = next.flatMap((c) => c.cards).map((c) => [c.id, c.version]);
    expect(versions).toEqual([["a", 4], ["b", 1]]);
  });
});

describe("canMoveInstantly", () => {
  it("autorise un recul quand la fiche est complète", () => {
    expect(canMoveInstantly(card("a", 60, 1000), 20, 40)).toBe(true);
  });

  it("refuse l'avancement et le gain : le critère de l'étape doit être confirmé", () => {
    expect(canMoveInstantly(card("a", 20, 1000), 60, 40)).toBe(false);
    expect(canMoveInstantly(card("a", 90, 1000), 100, 40)).toBe(false);
  });

  it("refuse un recul vers une étape qualifiée si le produit ou le montant manque", () => {
    expect(canMoveInstantly(card("a", 90, 1000, { productLabel: null }), 60, 40)).toBe(false);
    expect(canMoveInstantly(card("a", 90, 0), 60, 40)).toBe(false);
  });

  it("autorise un recul vers une étape sous le seuil même sans produit", () => {
    expect(canMoveInstantly(card("a", 60, 0, { productLabel: null }), 20, 40)).toBe(true);
  });
});

describe("ancienneté et initiales", () => {
  it("signale les cartes qui stagnent", () => {
    expect(staleness(3)).toBe("fresh");
    expect(staleness(14)).toBe("stale");
    expect(staleness(30)).toBe("very-stale");
  });

  it("libellé de l'ancienneté", () => {
    expect(daysInStageLabel(0)).toBe("Dans l'étape depuis aujourd'hui");
    expect(daysInStageLabel(12)).toBe("Dans l'étape depuis 12 j");
  });

  it("initiales du responsable", () => {
    expect(initials("Awa Koné")).toBe("AK");
    expect(initials("Jean Marc Yao")).toBe("JY");
    expect(initials("Admin")).toBe("AD");
    expect(initials("  ")).toBe("?");
  });
});
