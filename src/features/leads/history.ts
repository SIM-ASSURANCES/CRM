import "server-only";
import { Prisma } from "@/generated/prisma/client";
import {
  addToStageCounts,
  averagePreviousWeeks,
  buildDailySeries,
  buildWeeklySeries,
  dayKey,
  dayWindows,
  earliestNeededDay,
  emptyStageCounts,
  snapshotInstants,
  weekWindows,
  type DayPoint,
  type HistoryParams,
  type StageCounts,
  type WeekPoint,
} from "@/features/leads/history-math";
import { compareValues, type Comparison } from "@/features/leads/kpi-math";
import { leadScopeSql, leadScopeWhere } from "@/features/leads/scope";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Historique des prospects : nombre de nouveaux prospects par jour et par semaine (comparés aux semaines passées) et
// nombre de prospects à chaque étape à la fin de chaque jour / semaine.
//
// Rien n'est « archivé » : le passé est RECONSTITUÉ à partir de l'historique daté de chaque prospect (`lead_events`, une
// ligne par création ou changement d'étape), comme le fait déjà le tableau de bord. L'historique existe donc dès le
// premier jour, y compris pour les prospects importés, et ne peut pas diverger de la réalité.
//
// Définitions :
//  - Nouveau prospect : prospect dont la DATE D'INSERTION (saisie, au plus tard aujourd'hui) tombe dans la période.
//  - Étape à un instant T : dernier événement du prospect jusqu'à T. Un prospect compte à partir de sa date d'insertion
//    (ou de sa saisie si elle est plus ancienne) ; gagné et perdu sont comptés à part des étapes ouvertes.
//  - Périmètre : celui de l'utilisateur (commercial = ses prospects, manager = son équipe, direction/admin/audit = tous).

export type ProspectHistory = {
  generatedAt: string;
  /** Du plus ancien au plus récent ; la dernière semaine est la semaine en cours (incomplète). */
  weeks: WeekPoint[];
  days: DayPoint[];
  summary: {
    thisWeek: Comparison;
    /** Moyenne des 4 dernières semaines complètes ; null s'il n'y en a pas. */
    averagePrevious: number | null;
    vsAverage: Comparison | null;
    today: number;
    /** Situation actuelle des étapes. */
    current: StageCounts;
  };
};

type SnapshotRow = { at: Date; status: string; to_progress: number; n: number };

async function newProspectsByDay(user: CurrentUser, from: Date, to: Date, ownerId: string | undefined): Promise<Map<string, number>> {
  const where: Prisma.LeadWhereInput[] = [leadScopeWhere(user), { insertedOn: { gte: from, lt: to } }];
  if (ownerId) where.push({ ownerUserId: ownerId });
  const rows = await db.lead.groupBy({ by: ["insertedOn"], where: { AND: where }, _count: { _all: true } });
  return new Map(rows.map((row) => [dayKey(row.insertedOn), row._count._all]));
}

/**
 * Nombre de prospects par état aux instants demandés, en UNE requête. Chaque événement d'un prospect est valable de sa
 * date jusqu'à l'événement suivant ; le premier événement commence à la plus ancienne de sa date et de la date d'insertion.
 */
async function stageSnapshots(user: CurrentUser, instants: Date[], ownerId: string | undefined): Promise<Map<number, StageCounts>> {
  const result = new Map<number, StageCounts>();
  for (const instant of instants) result.set(instant.getTime(), emptyStageCounts());
  if (instants.length === 0) return result;

  const owner = ownerId ? Prisma.sql`AND l.owner_user_id = ${ownerId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw<SnapshotRow[]>(Prisma.sql`
    WITH snapshots AS (
      SELECT unnest(${instants.map((instant) => instant.toISOString())}::text[])::timestamptz AS at
    ),
    steps AS (
      SELECT e.to_progress,
             e.status,
             CASE WHEN ROW_NUMBER() OVER w = 1
                  THEN LEAST(e.occurred_at, l.inserted_on::timestamp AT TIME ZONE 'UTC')
                  ELSE e.occurred_at END AS from_at,
             LEAD(e.occurred_at) OVER w AS to_at
      FROM lead_events e
      JOIN leads l ON l.id = e.lead_id
      WHERE TRUE ${leadScopeSql(user)} ${owner}
      WINDOW w AS (PARTITION BY e.lead_id ORDER BY e.occurred_at, e.id)
    )
    SELECT s.at, st.status, st.to_progress, COUNT(*)::int AS n
    FROM snapshots s
    JOIN steps st ON st.from_at <= s.at AND (st.to_at IS NULL OR st.to_at > s.at)
    GROUP BY s.at, st.status, st.to_progress
  `);

  for (const row of rows) {
    const counts = result.get(new Date(row.at).getTime());
    if (counts) addToStageCounts(counts, row.status, row.to_progress, row.n);
  }
  return result;
}

export async function getProspectHistory(
  user: CurrentUser,
  params: HistoryParams,
  now: Date = new Date(),
): Promise<ProspectHistory> {
  if (!can(user.role, "report:read")) throw errors.forbidden();
  // Un commercial ne voit que ses prospects : le filtre « commercial » ne lui sert à rien et n'est pas honoré.
  const ownerId = user.role === "commercial" ? undefined : params.ownerId;

  const dayRange = dayWindows(now, params.days);
  const weekRange = weekWindows(now, params.weeks);
  const from = earliestNeededDay(dayRange, weekRange);
  const to = new Date(Math.max(dayRange.at(-1)!.end.getTime(), weekRange.at(-1)!.end.getTime()));

  const [newByDay, snapshots] = await Promise.all([
    newProspectsByDay(user, from, to, ownerId),
    stageSnapshots(user, snapshotInstants(dayRange, weekRange, now), ownerId),
  ]);

  const days = buildDailySeries(dayRange, newByDay, snapshots, now);
  const weeks = buildWeeklySeries(weekRange, newByDay, snapshots, now);

  const currentWeek = weeks.at(-1)!;
  const averagePrevious = averagePreviousWeeks(weeks);
  return {
    generatedAt: now.toISOString(),
    weeks,
    days,
    summary: {
      thisWeek: currentWeek.comparison,
      averagePrevious,
      vsAverage: averagePrevious === null ? null : compareValues(currentWeek.newProspects, averagePrevious),
      today: days.at(-1)!.newProspects,
      current: currentWeek.stages,
    },
  };
}
