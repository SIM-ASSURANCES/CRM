import "server-only";
import { Prisma } from "@/generated/prisma/client";
import {
  compareValues,
  isoWeek,
  weekWindow,
  type Comparison,
  type WeekWindow,
} from "@/features/leads/kpi-math";
import { leadScopeSql, leadScopeWhere } from "@/features/leads/scope";
import { getThresholds } from "@/features/leads/service";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

// KPI du tableau de bord commercial (Excel, feuille « Parcours Tableau de bord » ; CDC 8.1).
// Définitions retenues en attendant la validation métier (plan, section 12, questions 2 à 4) :
//  - Nouveaux prospects : prospects dont la date d'insertion tombe dans la semaine.
//  - RDV obtenus : prospects ayant atteint pour la première fois « Découverte approfondie » (40 %,
//    « réunion de cadrage effectuée ») dans la semaine.
//  - Propositions envoyées : prospects passés au-dessus du seuil « proposition » (60 % par défaut) dans la semaine.
//  - Taux de transformation : gagnées / (gagnées + perdues) clôturées dans la semaine (CDC 1.2).
//  - Valeur du pipeline : somme des montants des offres ouvertes entre le seuil pipeline et 100 % (brut), et pondérée.
//  - Variation : (période − période précédente) / période précédente ; « non calculable » si la précédente vaut 0.

export const APPOINTMENT_PROGRESS = 40;

export type PipelineValue = { gross: number; weighted: number };

export type DashboardKpis = {
  weekLabel: string;
  newProspects: Comparison;
  appointments: Comparison;
  proposals: Comparison;
  conversion: {
    rate: number | null;
    previousRate: number | null;
    /** Écart en points de pourcentage ; null si l'une des deux semaines n'a aucune clôture. */
    pointsDiff: number | null;
    won: number;
    lost: number;
  };
  pipeline: { current: PipelineValue; previous: PipelineValue; comparison: Comparison };
  /** Valeur brute du pipeline à la fin de chacune des 4 dernières semaines (la dernière : à l'instant). */
  pipelineHistory: { label: string; gross: number }[];
};

async function pipelineAsOf(user: CurrentUser, asOf: Date, pipelineMin: number): Promise<PipelineValue> {
  // Dernier instantané connu de chaque prospect avant `asOf` : permet de comparer au passé sans table d'archives.
  const rows = await db.$queryRaw<{ gross: Prisma.Decimal; weighted: Prisma.Decimal }[]>(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (e.lead_id) e.lead_id, e.to_progress, e.status, e.expected_revenue
      FROM lead_events e
      JOIN leads l ON l.id = e.lead_id
      WHERE e.occurred_at < ${asOf}::timestamptz ${leadScopeSql(user)}
      ORDER BY e.lead_id, e.occurred_at DESC, e.id DESC
    )
    SELECT COALESCE(SUM(expected_revenue), 0) AS gross,
           COALESCE(SUM(expected_revenue * to_progress / 100.0), 0) AS weighted
    FROM latest
    WHERE status = 'open'
      AND to_progress >= ${pipelineMin}::int
      AND to_progress < 100
      AND expected_revenue IS NOT NULL
  `);
  return { gross: Number(rows[0]?.gross ?? 0), weighted: Number(rows[0]?.weighted ?? 0) };
}

export async function getDashboardKpis(user: CurrentUser, now: Date = new Date()): Promise<DashboardKpis> {
  const thresholds = await getThresholds();
  const scope = leadScopeWhere(user);
  const current = weekWindow(now, 0);
  const previous = weekWindow(now, 1);

  const countNewProspects = (w: WeekWindow) =>
    db.lead.count({ where: { AND: [scope, { insertedOn: { gte: w.start, lt: w.end } }] } });

  // Nombre de prospects distincts concernés par au moins un événement de la fenêtre.
  const countDistinctLeads = async (w: WeekWindow, where: Prisma.LeadEventWhereInput) => {
    const events = await db.leadEvent.findMany({
      where: { AND: [{ occurredAt: { gte: w.start, lt: w.end } }, { lead: scope }, where] },
      distinct: ["leadId"],
      select: { leadId: true },
    });
    return events.length;
  };

  const appointmentsWhere: Prisma.LeadEventWhereInput = {
    toProgress: { gte: APPOINTMENT_PROGRESS },
    OR: [{ fromProgress: null }, { fromProgress: { lt: APPOINTMENT_PROGRESS } }],
  };
  const proposalsWhere: Prisma.LeadEventWhereInput = {
    toProgress: { gt: thresholds.proposalAbove },
    OR: [{ fromProgress: null }, { fromProgress: { lte: thresholds.proposalAbove } }],
  };

  const historyWindows = [3, 2, 1, 0].map((weeksAgo) => weekWindow(now, weeksAgo));

  const [
    newCur,
    newPrev,
    rdvCur,
    rdvPrev,
    propCur,
    propPrev,
    wonCur,
    lostCur,
    wonPrev,
    lostPrev,
    pipelineCur,
    pipelinePrev,
    history,
  ] = await Promise.all([
    countNewProspects(current),
    countNewProspects(previous),
    countDistinctLeads(current, appointmentsWhere),
    countDistinctLeads(previous, appointmentsWhere),
    countDistinctLeads(current, proposalsWhere),
    countDistinctLeads(previous, proposalsWhere),
    countDistinctLeads(current, { type: "won" }),
    countDistinctLeads(current, { type: "lost" }),
    countDistinctLeads(previous, { type: "won" }),
    countDistinctLeads(previous, { type: "lost" }),
    pipelineAsOf(user, now, thresholds.pipelineMin),
    pipelineAsOf(user, current.start, thresholds.pipelineMin),
    Promise.all(
      historyWindows.map((w, index) =>
        pipelineAsOf(user, index === historyWindows.length - 1 ? now : w.end, thresholds.pipelineMin),
      ),
    ),
  ]);

  const rate = wonCur + lostCur === 0 ? null : (wonCur / (wonCur + lostCur)) * 100;
  const previousRate = wonPrev + lostPrev === 0 ? null : (wonPrev / (wonPrev + lostPrev)) * 100;

  return {
    weekLabel: `S${isoWeek(current.start)}`,
    newProspects: compareValues(newCur, newPrev),
    appointments: compareValues(rdvCur, rdvPrev),
    proposals: compareValues(propCur, propPrev),
    conversion: {
      rate,
      previousRate,
      pointsDiff: rate === null || previousRate === null ? null : rate - previousRate,
      won: wonCur,
      lost: lostCur,
    },
    pipeline: {
      current: pipelineCur,
      previous: pipelinePrev,
      comparison: compareValues(pipelineCur.gross, pipelinePrev.gross),
    },
    pipelineHistory: historyWindows.map((w, index) => ({
      label: `S${isoWeek(w.start)}`,
      gross: history[index].gross,
    })),
  };
}
