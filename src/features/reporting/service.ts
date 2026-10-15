import "server-only";
import { opportunityScopeWhere } from "@/features/opportunities/scope";
import { weightedAmount } from "@/features/opportunities/rules";
import type { LossDimension, Segment } from "@/features/reporting/config";
import {
  annualize,
  attainment,
  bucketKey,
  buildForecast,
  buildLossMatrix,
  emptySegment,
  isMonthKey,
  monthStartDate,
  monthsBetween,
  monthsOfPeriod,
  nextMonthStartDate,
  periodsBetween,
  sizeBandOf,
  targetOfPeriod,
  type Attainment,
  type ForecastReport,
  type LossMatrix,
  type ReportOpportunity,
} from "@/features/reporting/rules";
import type { ForecastFilters, LossFilters } from "@/features/reporting/schemas";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Service du reporting avancé (CDC 8.2 et 8.3). Chaque lecture vérifie la permission et applique le périmètre de
// l'utilisateur ; les écrans et les exports passent par les MÊMES fonctions (REC-10).

const MAX_ROWS = 50_000;

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

// --- Lecture des opportunités -----------------------------------------------------------------------------------

const OPPORTUNITY_SELECT = {
  id: true,
  name: true,
  status: true,
  amount: true,
  revenuePeriod: true,
  stage: true,
  expectedCloseDate: true,
  closedAt: true,
  lossReason: true,
  product: { select: { id: true, label: true } },
  owner: { select: { id: true, name: true, team: { select: { id: true, name: true } } } },
  account: { select: { id: true, legalName: true, sector: true, employeeCount: true, parent: { select: { id: true, legalName: true } } } },
} satisfies Prisma.OpportunitySelect;

type OpportunityRow = Prisma.OpportunityGetPayload<{ select: typeof OPPORTUNITY_SELECT }>;

/** Ligne de détail d'une opportunité (export « Détail des opportunités »). */
export type DetailRow = {
  id: string;
  name: string;
  accountName: string;
  productLabel: string | null;
  ownerName: string;
  teamName: string | null;
  sector: string | null;
  stage: number;
  status: "open" | "won";
  amount: number;
  revenuePeriod: string;
  annualized: number;
  weighted: number;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
};

function segmentOf(axis: Segment | LossDimension, row: OpportunityRow): { key: string; label: string } {
  switch (axis) {
    case "product":
      return row.product ? { key: row.product.id, label: row.product.label } : { key: "none", label: "Sans produit" };
    case "team":
      return row.owner.team ? { key: row.owner.team.id, label: row.owner.team.name } : { key: "none", label: "Sans équipe" };
    case "owner":
      return { key: row.owner.id, label: row.owner.name };
    case "sector":
      return row.account.sector ? { key: row.account.sector, label: row.account.sector } : { key: "none", label: "Secteur non renseigné" };
    case "group": {
      // Le groupe est le compte parent ; un compte sans parent est son propre groupe.
      const root = row.account.parent ?? { id: row.account.id, legalName: row.account.legalName };
      return { key: root.id, label: root.legalName };
    }
    case "size":
      return sizeBandOf(row.account.employeeCount);
    case "none":
      return { key: "all", label: "Toutes les opportunités" };
  }
}

function toReportOpportunity(row: OpportunityRow, axis: Segment | LossDimension): ReportOpportunity {
  const segment = segmentOf(axis, row);
  return {
    status: row.status as ReportOpportunity["status"],
    amount: row.amount.toNumber(),
    revenuePeriod: row.revenuePeriod,
    stage: row.stage,
    expectedCloseDate: row.expectedCloseDate,
    closedAt: row.closedAt,
    lossReason: row.lossReason,
    segmentKey: segment.key,
    segmentLabel: segment.label,
  };
}

function toDetail(row: OpportunityRow): DetailRow {
  const annualized = annualize(row.amount.toNumber(), row.revenuePeriod);
  return {
    id: row.id,
    name: row.name,
    accountName: row.account.legalName,
    productLabel: row.product?.label ?? null,
    ownerName: row.owner.name,
    teamName: row.owner.team?.name ?? null,
    sector: row.account.sector,
    stage: row.stage,
    status: row.status === "won" ? "won" : "open",
    amount: row.amount.toNumber(),
    revenuePeriod: row.revenuePeriod,
    annualized,
    weighted: row.status === "open" ? weightedAmount(annualized, row.stage) : 0,
    expectedCloseDate: row.expectedCloseDate,
    closedAt: row.closedAt,
  };
}

/** Mois couverts par des périodes COMPLÈTES : un trimestre ou une année partiellement demandé est lu en entier. */
function coveredMonths(periods: readonly string[]): string[] {
  const firstMonths = monthsOfPeriod(periods[0]);
  const lastMonths = monthsOfPeriod(periods[periods.length - 1]);
  return monthsBetween(firstMonths[0], lastMonths[lastMonths.length - 1]);
}

const windowOf = (months: readonly string[]) => ({ start: monthStartDate(months[0]), end: nextMonthStartDate(months[months.length - 1]) });

function assertSize(rows: readonly unknown[]): void {
  if (rows.length > MAX_ROWS) throw errors.validation("Trop d'opportunités pour ce rapport : réduisez la période ou ajoutez un filtre.");
}

const sharedFilters = (filters: { productId?: string; ownerId?: string }): Prisma.OpportunityWhereInput => ({
  ...(filters.productId ? { productId: filters.productId } : {}),
  ...(filters.ownerId ? { ownerUserId: filters.ownerId } : {}),
});

async function fetchForecastRows(user: CurrentUser, filters: ForecastFilters, months: readonly string[]): Promise<OpportunityRow[]> {
  const { start, end } = windowOf(months);
  const rows = await db.opportunity.findMany({
    where: {
      AND: [
        opportunityScopeWhere(user),
        sharedFilters(filters),
        {
          OR: [
            // La base garantit une date de clôture prévisionnelle à toute opportunité ouverte.
            { status: "open", expectedCloseDate: { gte: start, lt: end } },
            { status: "won", closedAt: { gte: start, lt: end } },
          ],
        },
      ],
    },
    select: OPPORTUNITY_SELECT,
    orderBy: [{ expectedCloseDate: "asc" }, { id: "asc" }],
    take: MAX_ROWS + 1,
  });
  assertSize(rows);
  return rows;
}

// --- Objectifs : périmètre et lecture ---------------------------------------------------------------------------

/** Utilisateurs dont l'utilisateur courant peut voir et fixer les objectifs (manager : son équipe ; commercial : lui-même). */
function ownerScopeWhere(user: CurrentUser): Prisma.UserWhereInput {
  switch (user.role) {
    case "admin":
    case "direction":
    case "audit":
      return {};
    case "manager":
      return user.teamId ? { OR: [{ id: user.id }, { teamId: user.teamId }] } : { id: user.id };
    case "commercial":
      return { id: user.id };
  }
}

type TargetRow = { ownerUserId: string; ownerName: string; teamId: string | null; teamName: string | null; month: string; amount: number };

async function fetchTargets(user: CurrentUser, months: readonly string[], ownerId?: string): Promise<TargetRow[]> {
  const { start, end } = windowOf(months);
  const rows = await db.salesTarget.findMany({
    where: {
      periodStart: { gte: start, lt: end },
      owner: { AND: [ownerScopeWhere(user), { banned: { not: true } }, ownerId ? { id: ownerId } : {}] },
    },
    select: { ownerUserId: true, periodStart: true, amount: true, owner: { select: { name: true, team: { select: { id: true, name: true } } } } },
  });
  return rows.map((row) => ({
    ownerUserId: row.ownerUserId,
    ownerName: row.owner.name,
    teamId: row.owner.team?.id ?? null,
    teamName: row.owner.team?.name ?? null,
    month: row.periodStart.toISOString().slice(0, 7),
    amount: row.amount.toNumber(),
  }));
}

// --- Forecast ----------------------------------------------------------------------------------------------------

export type TargetComparison = {
  byPeriod: Record<string, Attainment>;
  total: Attainment;
  /** Par segment, seulement quand l'axe est « commercial » ou « équipe » ; sinon null (un objectif n'a pas de sens par produit). */
  bySegment: Record<string, { byPeriod: Record<string, Attainment>; total: Attainment }> | null;
};

export type ForecastView = {
  filters: ForecastFilters;
  report: ForecastReport;
  /** null quand la comparaison n'a pas de sens (filtre produit) ou qu'aucun objectif n'est configuré. */
  targets: TargetComparison | null;
};

/** Objectif par mois, sur l'ensemble d'une liste de lignes d'objectifs. */
function monthMap(rows: readonly TargetRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.month, (map.get(row.month) ?? 0) + row.amount);
  return map;
}

function compare(
  forecast: { periods: Record<string, { forecast: number }>; total: { forecast: number } },
  periods: readonly string[],
  rows: readonly TargetRow[],
) {
  const byMonth = monthMap(rows);
  const byPeriod: Record<string, Attainment> = {};
  let targetTotal = 0;
  for (const period of periods) {
    const target = targetOfPeriod(period, byMonth);
    targetTotal += target;
    byPeriod[period] = attainment(forecast.periods[period]?.forecast ?? 0, target);
  }
  return { byPeriod, total: attainment(forecast.total.forecast, targetTotal) };
}

export async function getForecast(user: CurrentUser, filters: ForecastFilters): Promise<ForecastView> {
  assertCan(user, "report:read");
  const periods = periodsBetween(filters.from, filters.to, filters.granularity);
  const months = coveredMonths(periods);
  const rows = await fetchForecastRows(user, filters, months);
  let report = buildForecast(
    rows.map((row) => toReportOpportunity(row, filters.segment)),
    { granularity: filters.granularity, periods },
  );

  // Comparaison à l'objectif : pas de sens quand on filtre un produit (l'objectif est fixé par commercial, tous produits).
  let targets: TargetComparison | null = null;
  if (!filters.productId) {
    const targetRows = await fetchTargets(user, months, filters.ownerId);

    if (targetRows.length > 0) {
      let bySegment: TargetComparison["bySegment"] = null;
      if (filters.segment === "owner" || filters.segment === "team") {
        const keyOf = (row: TargetRow) => (filters.segment === "owner" ? row.ownerUserId : (row.teamId ?? "none"));
        const labelOf = (row: TargetRow) => (filters.segment === "owner" ? row.ownerName : (row.teamName ?? "Sans équipe"));

        // Les commerciaux ou équipes qui ont un objectif mais aucune opportunité apparaissent quand même, à zéro.
        const present = new Set(report.segments.map((segment) => segment.key));
        const missing = new Map<string, string>();
        for (const row of targetRows) if (!present.has(keyOf(row))) missing.set(keyOf(row), labelOf(row));
        if (missing.size > 0) {
          report = { ...report, segments: [...report.segments, ...[...missing].map(([key, label]) => emptySegment(key, label, periods))] };
        }

        bySegment = {};
        for (const segment of report.segments) {
          bySegment[segment.key] = compare(segment, periods, targetRows.filter((row) => keyOf(row) === segment.key));
        }
      }
      targets = { ...compare({ periods: report.periodTotals, total: report.total }, periods, targetRows), bySegment };
    }
  }
  return { filters, report, targets };
}

/** Détail des opportunités comptées dans le forecast : mêmes lignes, mêmes montants (REC-10), pour l'export. */
export async function getOpportunityDetail(user: CurrentUser, filters: ForecastFilters): Promise<DetailRow[]> {
  assertCan(user, "report:read");
  const periods = periodsBetween(filters.from, filters.to, filters.granularity);
  const rows = await fetchForecastRows(user, filters, coveredMonths(periods));
  const wanted = new Set(periods);

  return rows
    .filter((row) => {
      // Même règle de placement que le forecast : seules comptent les opportunités rangées dans l'une des périodes demandées
      // (la fenêtre lue couvre des périodes entières, elle peut déborder de la plage choisie).
      const key = bucketKey(toReportOpportunity(row, "none"), filters.granularity);
      return key !== null && wanted.has(key);
    })
    .map(toDetail);
}

// --- Motifs de perte ---------------------------------------------------------------------------------------------

export type LossView = { filters: LossFilters; matrix: LossMatrix };

export async function getLosses(user: CurrentUser, filters: LossFilters): Promise<LossView> {
  assertCan(user, "report:read");
  const { start, end } = windowOf(monthsBetween(filters.from, filters.to));
  const rows = await db.opportunity.findMany({
    where: { AND: [opportunityScopeWhere(user), sharedFilters(filters), { status: "lost", closedAt: { gte: start, lt: end } }] },
    select: OPPORTUNITY_SELECT,
    take: MAX_ROWS + 1,
  });
  assertSize(rows);
  return { filters, matrix: buildLossMatrix(rows.map((row) => toReportOpportunity(row, filters.dimension))) };
}

// --- Listes de choix des filtres ---------------------------------------------------------------------------------

export async function listReportOwners(user: CurrentUser): Promise<{ id: string; name: string }[]> {
  assertCan(user, "report:read");
  return db.user.findMany({
    where: { AND: [ownerScopeWhere(user), { role: { in: ["commercial", "manager"] } }, { banned: { not: true } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

// --- Objectifs (CDC 8.2) -----------------------------------------------------------------------------------------

export type TargetGridRow = { userId: string; name: string; teamName: string | null; months: Record<string, number> };
export type TargetGrid = { year: number; monthKeys: string[]; rows: TargetGridRow[] };

const yearMonths = (year: number) => monthsBetween(`${year}-01`, `${year}-12`);

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw errors.validation("Année invalide.");
}

/** Commerciaux et managers dont l'utilisateur courant fixe les objectifs. */
async function targetableUsers(user: CurrentUser) {
  return db.user.findMany({
    where: { AND: [ownerScopeWhere(user), { role: { in: ["commercial", "manager"] } }, { banned: { not: true } }] },
    select: { id: true, name: true, team: { select: { name: true } } },
    orderBy: [{ name: "asc" }],
    take: 500,
  });
}

export async function getTargetGrid(user: CurrentUser, year: number): Promise<TargetGrid> {
  assertCan(user, "target:manage");
  assertYear(year);
  const monthKeys = yearMonths(year);
  const [users, targets] = await Promise.all([targetableUsers(user), fetchTargets(user, monthKeys)]);

  const byOwner = new Map<string, Record<string, number>>();
  for (const target of targets) byOwner.set(target.ownerUserId, { ...(byOwner.get(target.ownerUserId) ?? {}), [target.month]: target.amount });

  return {
    year,
    monthKeys,
    rows: users.map((candidate) => ({
      userId: candidate.id,
      name: candidate.name,
      teamName: candidate.team?.name ?? null,
      months: Object.fromEntries(monthKeys.map((month) => [month, byOwner.get(candidate.id)?.[month] ?? 0])),
    })),
  };
}

const MAX_TARGET = 1_000_000_000_000;

/**
 * Enregistre les 12 objectifs mensuels d'un commercial pour une année. Un manager ne fixe que ceux de son équipe (et les
 * siens) ; un montant vide vaut 0. Tout est écrit dans une transaction avec sa trace d'audit.
 */
export async function saveTargets(
  user: CurrentUser,
  input: { ownerUserId: string; year: number; amounts: Record<string, number> },
): Promise<{ total: number }> {
  assertCan(user, "target:manage");
  assertYear(input.year);
  const monthKeys = yearMonths(input.year);

  for (const month of monthKeys) {
    const amount = input.amounts[month];
    if (amount === undefined || !Number.isFinite(amount) || amount < 0 || amount > MAX_TARGET) {
      throw errors.validation("Montant d'objectif invalide.", { fieldErrors: { [month]: ["Saisissez un montant positif ou nul."] } });
    }
  }
  for (const key of Object.keys(input.amounts)) if (!isMonthKey(key) || !monthKeys.includes(key)) throw errors.validation("Mois inattendu.");

  const allowed = (await targetableUsers(user)).some((candidate) => candidate.id === input.ownerUserId);
  if (!allowed) throw errors.forbidden("Vous ne pouvez pas fixer les objectifs de cet utilisateur.");

  const total = Math.round(monthKeys.reduce((sum, month) => sum + input.amounts[month], 0) * 100) / 100;
  await db.$transaction(async (tx) => {
    for (const month of monthKeys) {
      const amount = Math.round(input.amounts[month] * 100) / 100;
      await tx.salesTarget.upsert({
        where: { ownerUserId_periodStart: { ownerUserId: input.ownerUserId, periodStart: monthStartDate(month) } },
        create: { ownerUserId: input.ownerUserId, periodStart: monthStartDate(month), amount, updatedBy: user.id },
        update: { amount, updatedBy: user.id },
      });
    }
    await writeAudit(
      { actorUserId: user.id, action: "target.updated", entityType: "sales_target", entityId: input.ownerUserId, metadata: { year: input.year, total } },
      tx,
    );
  });
  return { total };
}
