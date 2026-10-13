import type { Prisma } from "@/generated/prisma/client";
import type { LeadThresholds } from "@/features/leads/config";

// Les « onglets » du parcours Excel sont des VUES d'un même enregistrement : un prospect n'est jamais copié.
// Il apparaît dans l'écran qui correspond à son pourcentage d'avancement et à son statut.

export const LEAD_VIEWS = ["prospects", "qualifies", "propositions", "pipeline", "gagnes"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const VIEW_META: Record<
  LeadView,
  { title: string; navLabel: string; description: string; href: string; empty: string }
> = {
  prospects: {
    title: "Reporting prospect",
    navLabel: "Prospects",
    description: "Prospects en cours de prise de contact et de qualification.",
    href: "/prospects",
    empty: "Aucun prospect pour le moment. Enregistrez votre premier prospect.",
  },
  qualifies: {
    title: "Prospects qualifiés",
    navLabel: "Prospects qualifiés",
    description: "Prospects dont le besoin, l'interlocuteur et le potentiel sont évalués.",
    href: "/prospects/qualifies",
    empty: "Aucun prospect qualifié pour le moment.",
  },
  propositions: {
    title: "Propositions envoyées",
    navLabel: "Propositions envoyées",
    description: "Offres transmises aux prospects, en attente d'accord.",
    href: "/prospects/propositions",
    empty: "Aucune proposition envoyée pour le moment.",
  },
  pipeline: {
    title: "Valeur du pipeline",
    navLabel: "Valeur du pipeline",
    description: "Offres en négociation, finalisation ou signature (80 % et 90 %).",
    href: "/prospects/pipeline",
    empty: "Aucune offre en négociation pour le moment.",
  },
  gagnes: {
    title: "Taux de transformation",
    navLabel: "Taux de transformation",
    description: "Affaires gagnées : contrat signé et premier paiement validé.",
    href: "/prospects/gagnes",
    empty: "Aucune affaire gagnée pour le moment.",
  },
};

export function isLeadView(value: string): value is LeadView {
  return (LEAD_VIEWS as readonly string[]).includes(value);
}

/** Filtre Prisma d'une vue. Les prospects « perdus » n'apparaissent dans aucune vue (ils sont clôturés). */
export function viewWhere(view: LeadView, t: LeadThresholds): Prisma.LeadWhereInput {
  switch (view) {
    case "prospects":
      return { status: "open", progress: { lte: t.qualifiedAbove } };
    case "qualifies":
      return { status: "open", progress: { gt: t.qualifiedAbove, lte: t.proposalAbove } };
    case "propositions":
      return { status: "open", progress: { gt: t.proposalAbove, lt: 100 } };
    case "pipeline":
      return { status: "open", progress: { gte: t.pipelineMin, lt: 100 } };
    case "gagnes":
      return { status: "won" };
  }
}

/** Écrans dans lesquels un prospect apparaît (utile pour informer l'utilisateur après une modification). */
export function destinationViews(progress: number, status: string, t: LeadThresholds): LeadView[] {
  if (status === "won") return ["gagnes"];
  if (status !== "open") return [];

  const views: LeadView[] = [];
  if (progress <= t.qualifiedAbove) views.push("prospects");
  else if (progress <= t.proposalAbove) views.push("qualifies");
  else if (progress < 100) views.push("propositions");
  if (progress >= t.pipelineMin && progress < 100) views.push("pipeline");
  return views;
}
