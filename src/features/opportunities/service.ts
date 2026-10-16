import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { accountScopeWhere } from "@/features/accounts/scope";
import { getThresholds } from "@/features/leads/service";
import { OPEN_STAGES, type OpenStage } from "@/features/opportunities/config";
import {
  defaultOpportunityName,
  isOverdue,
  summarize,
  validateStageMove,
  weightedAmount,
} from "@/features/opportunities/rules";
import type {
  AddOpportunityContactInput,
  CreateOpportunityInput,
  MarkOpportunityLostInput,
  MoveStageInput,
  UpdateOpportunityInput,
} from "@/features/opportunities/schemas";
import { opportunityScopeWhere } from "@/features/opportunities/scope";
import { notifyAssigned } from "@/features/notifications/service";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { FieldErrors } from "@/lib/forms";

// Service des opportunités (CDC 5). Toute opération : vérifie la permission, applique le périmètre de l'utilisateur,
// valide les règles métier, puis écrit la donnée, son historique et la trace d'audit dans la MÊME transaction.
// Le montant pondéré est CALCULÉ ici (montant × probabilité de l'étape), jamais accepté du navigateur.

export type OpportunityCard = {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  ownerName: string;
  productLabel: string | null;
  amount: number;
  weighted: number;
  stage: number;
  status: string;
  expectedCloseDate: Date | null;
  nextAction: string | null;
  nextActionDate: Date | null;
  overdue: boolean;
  version: number;
};

export type Totals = { count: number; gross: number; weighted: number };

/** Carte du tableau Kanban : la carte + ce qui aide à agir sans ouvrir la fiche (ancienneté dans l'étape, contact). */
export type BoardCard = OpportunityCard & {
  /** Jours écoulés depuis l'entrée dans l'étape actuelle (création ou dernier changement d'étape). */
  daysInStage: number;
  /** Contact principal du dossier (ou le premier rattaché) ; coordonnées seulement si l'utilisateur peut lire les contacts. */
  contact: { name: string; phone: string | null; email: string | null } | null;
};

export type BoardData = {
  columns: { stage: OpenStage; cards: BoardCard[]; totals: Totals }[];
  /** Pipeline ouvert : brut et pondéré (CDC 5.3 : « distinguer montant brut, montant pondéré et revenu signé »). */
  open: Totals;
  /** Revenu signé : opportunités gagnées depuis le début de l'année en cours. */
  signedThisYear: { count: number; amount: number };
  lostThisYear: number;
  truncated: boolean;
};

export type OpportunityDetail = OpportunityCard & {
  accountStatus: string;
  productId: string | null;
  currency: string;
  revenuePeriod: string;
  estimationMethod: string | null;
  competitor: string | null;
  currentSolution: string | null;
  lossReason: string | null;
  lossComment: string | null;
  closedAt: Date | null;
  createdAt: Date;
  ownerUserId: string;
  contacts: { contactId: string; name: string; jobTitle: string | null; roleType: string | null; isMain: boolean }[];
  events: {
    id: string;
    occurredAt: Date;
    type: string;
    fromStage: number | null;
    toStage: number;
    amount: number;
    actorName: string | null;
  }[];
};

const cardInclude = {
  account: { select: { id: true, legalName: true } },
  owner: { select: { name: true } },
  product: { select: { label: true } },
} satisfies Prisma.OpportunityInclude;

type OpportunityWithCard = Prisma.OpportunityGetPayload<{ include: typeof cardInclude }>;

function toCard(opportunity: OpportunityWithCard, now: Date = new Date()): OpportunityCard {
  const amount = Number(opportunity.amount);
  return {
    id: opportunity.id,
    name: opportunity.name,
    accountId: opportunity.accountId,
    accountName: opportunity.account.legalName,
    ownerName: opportunity.owner.name,
    productLabel: opportunity.product?.label ?? null,
    amount,
    weighted: weightedAmount(amount, opportunity.stage),
    stage: opportunity.stage,
    status: opportunity.status,
    expectedCloseDate: opportunity.expectedCloseDate,
    nextAction: opportunity.nextAction,
    nextActionDate: opportunity.nextActionDate,
    overdue: opportunity.status === "open" && isOverdue(opportunity.nextActionDate, now),
    version: opportunity.version,
  };
}

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

function fail(fieldErrors: FieldErrors, message = "Certaines informations sont manquantes."): never {
  throw errors.validation(message, { fieldErrors });
}

// --- Lecture -----------------------------------------------------------------------------------------------------

export async function listBoard(
  user: CurrentUser,
  filters: { ownerId?: string; productId?: string; q?: string } = {},
  now: Date = new Date(),
): Promise<BoardData> {
  assertCan(user, "opportunity:read");

  const where: Prisma.OpportunityWhereInput[] = [{ status: "open" }, opportunityScopeWhere(user)];
  if (filters.ownerId) where.push({ ownerUserId: filters.ownerId });
  if (filters.productId) where.push({ productId: filters.productId });
  const q = filters.q?.trim();
  if (q) {
    where.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { account: { legalName: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const LIMIT = 500;
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const scope = opportunityScopeWhere(user);

  const [rows, wonThisYear, lostThisYear] = await Promise.all([
    db.opportunity.findMany({
      where: { AND: where },
      include: cardInclude,
      orderBy: [{ expectedCloseDate: "asc" }, { createdAt: "asc" }],
      take: LIMIT + 1,
    }),
    db.opportunity.findMany({
      where: { AND: [{ status: "won", closedAt: { gte: yearStart } }, scope] },
      select: { amount: true },
    }),
    db.opportunity.count({ where: { AND: [{ status: "lost", closedAt: { gte: yearStart } }, scope] } }),
  ]);

  const truncated = rows.length > LIMIT;
  const visibleRows = rows.slice(0, LIMIT);
  const ids = visibleRows.map((row) => row.id);

  // Deux requêtes groupées pour tout le tableau (jamais une par carte) : date d'entrée dans l'étape et contact principal.
  const showContact = can(user.role, "contact:read");
  const [stageEntries, contactLinks] = await Promise.all([
    db.opportunityEvent.groupBy({
      by: ["opportunityId"],
      where: { opportunityId: { in: ids }, type: { in: ["created", "stage_changed"] } },
      _max: { occurredAt: true },
    }),
    showContact
      ? db.opportunityContact.findMany({
          where: { opportunityId: { in: ids } },
          select: {
            opportunityId: true,
            contact: { select: { firstName: true, lastName: true, phone: true, email: true } },
          },
          orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const enteredAt = new Map(stageEntries.map((entry) => [entry.opportunityId, entry._max.occurredAt]));
  const mainContact = new Map<string, BoardCard["contact"]>();
  for (const link of contactLinks) {
    // Triés « principal d'abord » : le premier lien rencontré est celui à afficher.
    if (mainContact.has(link.opportunityId)) continue;
    mainContact.set(link.opportunityId, {
      name: `${link.contact.firstName} ${link.contact.lastName}`,
      phone: link.contact.phone,
      email: link.contact.email,
    });
  }

  const cards: BoardCard[] = visibleRows.map((row) => {
    const since = enteredAt.get(row.id) ?? row.createdAt;
    return {
      ...toCard(row, now),
      daysInStage: Math.max(Math.floor((now.getTime() - since.getTime()) / 86_400_000), 0),
      contact: mainContact.get(row.id) ?? null,
    };
  });

  return {
    columns: OPEN_STAGES.map((stage) => {
      const stageCards = cards.filter((card) => card.stage === stage);
      return { stage, cards: stageCards, totals: summarize(stageCards) };
    }),
    open: summarize(cards),
    signedThisYear: { count: wonThisYear.length, amount: wonThisYear.reduce((sum, o) => sum + Number(o.amount), 0) },
    lostThisYear,
    truncated,
  };
}

export async function listOpportunities(
  user: CurrentUser,
  options: { status?: "open" | "won" | "lost"; q?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: OpportunityCard[]; total: number; page: number; pageSize: number }> {
  assertCan(user, "opportunity:read");

  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const filters: Prisma.OpportunityWhereInput[] = [opportunityScopeWhere(user)];
  if (options.status) filters.push({ status: options.status });
  const q = options.q?.trim();
  if (q) {
    filters.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { account: { legalName: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.OpportunityWhereInput = { AND: filters };
  const [total, rows] = await Promise.all([
    db.opportunity.count({ where }),
    db.opportunity.findMany({
      where,
      include: cardInclude,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { rows: rows.map((row) => toCard(row)), total, page, pageSize };
}

export async function getOpportunity(user: CurrentUser, id: string): Promise<OpportunityDetail> {
  assertCan(user, "opportunity:read");

  const opportunity = await db.opportunity.findFirst({
    where: { AND: [{ id }, opportunityScopeWhere(user)] },
    include: {
      ...cardInclude,
      account: { select: { id: true, legalName: true, status: true } },
      contacts: { include: { contact: true }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }] },
      events: { include: { actor: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!opportunity) throw errors.notFound("Opportunité introuvable.");

  return {
    ...toCard(opportunity),
    accountStatus: opportunity.account.status,
    productId: opportunity.productId,
    currency: opportunity.currency,
    revenuePeriod: opportunity.revenuePeriod,
    estimationMethod: opportunity.estimationMethod,
    competitor: opportunity.competitor,
    currentSolution: opportunity.currentSolution,
    lossReason: opportunity.lossReason,
    lossComment: opportunity.lossComment,
    closedAt: opportunity.closedAt,
    createdAt: opportunity.createdAt,
    ownerUserId: opportunity.ownerUserId,
    contacts: opportunity.contacts.map((link) => ({
      contactId: link.contactId,
      name: `${link.contact.firstName} ${link.contact.lastName}`,
      jobTitle: link.contact.jobTitle,
      roleType: link.roleType,
      isMain: link.isMain,
    })),
    events: opportunity.events.map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      type: event.type,
      fromStage: event.fromStage,
      toStage: event.toStage,
      amount: Number(event.amount),
      actorName: event.actor?.name ?? null,
    })),
  };
}

/** Contacts du compte qui ne sont pas encore impliqués dans l'opportunité. */
export async function listContactCandidates(user: CurrentUser, opportunityId: string): Promise<{ id: string; label: string }[]> {
  assertCan(user, "opportunity:read");
  const opportunity = await db.opportunity.findFirst({
    where: { AND: [{ id: opportunityId }, opportunityScopeWhere(user)] },
    select: { accountId: true },
  });
  if (!opportunity) throw errors.notFound("Opportunité introuvable.");

  const links = await db.accountContact.findMany({
    where: { accountId: opportunity.accountId, contact: { archivedAt: null, opportunities: { none: { opportunityId } } } },
    include: { contact: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => ({
    id: l.contact.id,
    label: `${l.contact.firstName} ${l.contact.lastName}${l.contact.jobTitle ? ` — ${l.contact.jobTitle}` : ""}`,
  }));
}

// --- Écriture ----------------------------------------------------------------------------------------------------

async function assertAccountUsable(tx: Prisma.TransactionClient, user: CurrentUser, accountId: string) {
  const account = await tx.crmAccount.findFirst({
    where: { AND: [{ id: accountId, archivedAt: null }, accountScopeWhere(user)] },
    select: { id: true, legalName: true },
  });
  if (!account) fail({ accountId: ["Compte introuvable ou hors de votre périmètre."] }, "Compte invalide.");
  return account;
}

async function resolveProduct(tx: Prisma.TransactionClient, productId?: string) {
  if (!productId) return null;
  const product = await tx.product.findFirst({ where: { id: productId, active: true }, select: { id: true, label: true } });
  if (!product) fail({ productId: ["Produit invalide."] }, "Produit invalide.");
  return product;
}

async function resolveOwner(tx: Prisma.TransactionClient, user: CurrentUser, requested: string | undefined, current: string) {
  if (!requested || requested === current || !can(user.role, "account:assign")) return current;
  const owner = await tx.user.findFirst({
    where: { id: requested, role: { not: "audit" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true },
  });
  if (!owner) fail({ ownerUserId: ["Le propriétaire doit être un utilisateur actif pouvant gérer des opportunités."] });
  return owner.id;
}

export async function createOpportunity(user: CurrentUser, input: CreateOpportunityInput): Promise<{ id: string }> {
  assertCan(user, "opportunity:write");
  const thresholds = await getThresholds();

  // Au-delà du seuil de qualification, produit et montant sont obligatoires (même règle que pour un changement d'étape).
  const stageErrors = validateStageMove(
    { from: 0, to: input.stage, productId: input.productId, amount: input.amount, criteriaConfirmed: true, wonConfirmed: true },
    thresholds.qualifiedAbove,
  );
  if (stageErrors) fail(stageErrors);

  return db.$transaction(async (tx) => {
    const account = await assertAccountUsable(tx, user, input.accountId);
    const product = await resolveProduct(tx, input.productId);
    const ownerUserId = await resolveOwner(tx, user, input.ownerUserId, user.id);

    const opportunity = await tx.opportunity.create({
      data: {
        name: input.name ?? defaultOpportunityName(account.legalName, product?.label ?? null, input.expectedCloseDate),
        accountId: account.id,
        ownerUserId,
        productId: product?.id ?? null,
        amount: input.amount,
        revenuePeriod: input.revenuePeriod,
        estimationMethod: input.estimationMethod ?? null,
        stage: input.stage,
        expectedCloseDate: input.expectedCloseDate,
        nextAction: input.nextAction,
        nextActionDate: input.nextActionDate,
        competitor: input.competitor ?? null,
        currentSolution: input.currentSolution ?? null,
      },
    });
    await tx.opportunityEvent.create({
      data: {
        opportunityId: opportunity.id,
        actorUserId: user.id,
        type: "created",
        toStage: opportunity.stage,
        status: "open",
        amount: opportunity.amount,
        expectedCloseDate: opportunity.expectedCloseDate,
      },
    });
    await writeAudit(
      { actorUserId: user.id, action: "opportunity.created", entityType: "opportunity", entityId: opportunity.id, metadata: { stage: opportunity.stage } },
      tx,
    );
    return { id: opportunity.id };
  });
}

export async function updateOpportunity(user: CurrentUser, input: UpdateOpportunityInput): Promise<{ id: string }> {
  assertCan(user, "opportunity:write");
  const thresholds = await getThresholds();

  return db.$transaction(async (tx) => {
    const existing = await tx.opportunity.findFirst({ where: { AND: [{ id: input.id }, opportunityScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Opportunité introuvable.");
    if (existing.status !== "open") throw errors.validation("Cette opportunité est clôturée : elle ne peut plus être modifiée.");

    // L'étape actuelle impose déjà produit et montant : on ne peut pas les retirer.
    if (existing.stage > thresholds.qualifiedAbove) {
      const stageErrors: FieldErrors = {};
      if (!input.productId) stageErrors.productId = ["Le produit est obligatoire à cette étape."];
      if (!(input.amount > 0)) stageErrors.amount = ["Le montant est obligatoire à cette étape."];
      if (Object.keys(stageErrors).length > 0) fail(stageErrors);
    }

    const account = await assertAccountUsable(tx, user, input.accountId);
    const product = await resolveProduct(tx, input.productId);
    const ownerUserId = await resolveOwner(tx, user, input.ownerUserId, existing.ownerUserId);

    // Concurrence optimiste : si quelqu'un a modifié la fiche entre-temps, la version ne correspond plus (409).
    const updated = await tx.opportunity.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        name: input.name ?? defaultOpportunityName(account.legalName, product?.label ?? null, input.expectedCloseDate),
        accountId: account.id,
        ownerUserId,
        productId: product?.id ?? null,
        amount: input.amount,
        revenuePeriod: input.revenuePeriod,
        estimationMethod: input.estimationMethod ?? null,
        expectedCloseDate: input.expectedCloseDate,
        nextAction: input.nextAction,
        nextActionDate: input.nextActionDate,
        competitor: input.competitor ?? null,
        currentSolution: input.currentSolution ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Cette opportunité a été modifiée par quelqu'un d'autre. Rechargez la page.");

    const oldAmount = Number(existing.amount);
    const changedFields = [
      existing.accountId !== account.id && "accountId",
      existing.productId !== (product?.id ?? null) && "productId",
      oldAmount !== input.amount && "amount",
      existing.revenuePeriod !== input.revenuePeriod && "revenuePeriod",
      existing.expectedCloseDate?.getTime() !== input.expectedCloseDate.getTime() && "expectedCloseDate",
      existing.nextAction !== input.nextAction && "nextAction",
      existing.nextActionDate?.getTime() !== input.nextActionDate.getTime() && "nextActionDate",
      existing.ownerUserId !== ownerUserId && "ownerUserId",
    ].filter((field): field is string => typeof field === "string");

    // Le montant et la date de clôture expliquent les variations du forecast : on en garde un instantané daté.
    if (oldAmount !== input.amount || existing.expectedCloseDate?.getTime() !== input.expectedCloseDate.getTime()) {
      await tx.opportunityEvent.create({
        data: {
          opportunityId: existing.id,
          actorUserId: user.id,
          type: "updated",
          fromStage: existing.stage,
          toStage: existing.stage,
          status: "open",
          amount: input.amount,
          expectedCloseDate: input.expectedCloseDate,
        },
      });
    }

    await writeAudit(
      { actorUserId: user.id, action: "opportunity.updated", entityType: "opportunity", entityId: existing.id, metadata: { changedFields } },
      tx,
    );
    if (existing.ownerUserId !== ownerUserId) {
      await writeAudit(
        {
          actorUserId: user.id,
          action: "opportunity.owner_changed",
          entityType: "opportunity",
          entityId: existing.id,
          metadata: { fromOwnerId: existing.ownerUserId, toOwnerId: ownerUserId },
        },
        tx,
      );
      await notifyAssigned(tx, {
        actorUserId: user.id,
        toUserId: ownerUserId,
        kind: "opportunity",
        entityId: existing.id,
        name: existing.name,
        href: `/opportunites/${existing.id}`,
      });
    }
    return { id: existing.id };
  });
}

/** Changement d'étape (CDC A.8 : « critères de sortie, historique, mise à jour forecast »). 100 % = gagné. */
export async function moveStage(
  user: CurrentUser,
  input: MoveStageInput,
): Promise<{ id: string; stage: number; status: string; version: number }> {
  assertCan(user, "opportunity:write");
  const thresholds = await getThresholds();

  return db.$transaction(async (tx) => {
    const existing = await tx.opportunity.findFirst({ where: { AND: [{ id: input.id }, opportunityScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Opportunité introuvable.");
    if (existing.status !== "open") throw errors.validation("Cette opportunité est clôturée : son étape ne peut plus changer.");

    const stageErrors = validateStageMove(
      {
        from: existing.stage,
        to: input.targetStage,
        productId: existing.productId,
        amount: Number(existing.amount),
        criteriaConfirmed: input.criteriaConfirmed,
        wonConfirmed: input.wonConfirmed,
      },
      thresholds.qualifiedAbove,
    );
    if (stageErrors) fail(stageErrors);

    const won = input.targetStage === 100;
    const updated = await tx.opportunity.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        stage: input.targetStage,
        status: won ? "won" : "open",
        closedAt: won ? new Date() : null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Cette opportunité a été modifiée par quelqu'un d'autre. Rechargez la page.");

    await tx.opportunityEvent.create({
      data: {
        opportunityId: existing.id,
        actorUserId: user.id,
        type: won ? "won" : "stage_changed",
        fromStage: existing.stage,
        toStage: input.targetStage,
        status: won ? "won" : "open",
        amount: existing.amount,
        expectedCloseDate: existing.expectedCloseDate,
      },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        action: won ? "opportunity.won" : "opportunity.stage_changed",
        entityType: "opportunity",
        entityId: existing.id,
        metadata: { fromStage: existing.stage, toStage: input.targetStage },
      },
      tx,
    );
    return { id: existing.id, stage: input.targetStage, status: won ? "won" : "open", version: input.version + 1 };
  });
}

export async function markLost(user: CurrentUser, input: MarkOpportunityLostInput): Promise<{ id: string }> {
  assertCan(user, "opportunity:write");

  return db.$transaction(async (tx) => {
    const existing = await tx.opportunity.findFirst({ where: { AND: [{ id: input.id }, opportunityScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Opportunité introuvable.");
    if (existing.status !== "open") throw errors.validation("Cette opportunité est déjà clôturée.");

    const updated = await tx.opportunity.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        status: "lost",
        lossReason: input.reason,
        lossComment: input.comment ?? null,
        closedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Cette opportunité a été modifiée par quelqu'un d'autre. Rechargez la page.");

    await tx.opportunityEvent.create({
      data: {
        opportunityId: existing.id,
        actorUserId: user.id,
        type: "lost",
        fromStage: existing.stage,
        toStage: existing.stage,
        status: "lost",
        amount: existing.amount,
        expectedCloseDate: existing.expectedCloseDate,
      },
    });
    await writeAudit(
      { actorUserId: user.id, action: "opportunity.lost", entityType: "opportunity", entityId: existing.id, metadata: { reason: input.reason } },
      tx,
    );
    return { id: existing.id };
  });
}

// --- Contacts impliqués ------------------------------------------------------------------------------------------

export async function addContact(user: CurrentUser, input: AddOpportunityContactInput): Promise<void> {
  assertCan(user, "opportunity:write");

  await db.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.findFirst({
      where: { AND: [{ id: input.opportunityId }, opportunityScopeWhere(user)] },
      select: { id: true, accountId: true, status: true },
    });
    if (!opportunity) throw errors.notFound("Opportunité introuvable.");
    if (opportunity.status !== "open") throw errors.validation("Cette opportunité est clôturée.");

    // Seuls les contacts rattachés au compte de l'opportunité peuvent y être impliqués.
    const link = await tx.accountContact.findUnique({
      where: { accountId_contactId: { accountId: opportunity.accountId, contactId: input.contactId } },
      select: { id: true },
    });
    if (!link) fail({ contactId: ["Ce contact n'est pas rattaché au compte de l'opportunité."] }, "Contact invalide.");

    const already = await tx.opportunityContact.findUnique({
      where: { opportunityId_contactId: { opportunityId: opportunity.id, contactId: input.contactId } },
      select: { id: true },
    });
    if (already) fail({ contactId: ["Ce contact est déjà impliqué dans l'opportunité."] }, "Contact déjà ajouté.");

    if (input.isMain) {
      await tx.opportunityContact.updateMany({ where: { opportunityId: opportunity.id, isMain: true }, data: { isMain: false } });
    }
    await tx.opportunityContact.create({
      data: { opportunityId: opportunity.id, contactId: input.contactId, roleType: input.roleType ?? null, isMain: input.isMain },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        action: "opportunity.contact_added",
        entityType: "opportunity",
        entityId: opportunity.id,
        metadata: { contactId: input.contactId, roleType: input.roleType ?? null },
      },
      tx,
    );
  });
}

export async function removeContact(user: CurrentUser, input: { opportunityId: string; contactId: string }): Promise<void> {
  assertCan(user, "opportunity:write");

  await db.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.findFirst({
      where: { AND: [{ id: input.opportunityId }, opportunityScopeWhere(user)] },
      select: { id: true, status: true },
    });
    if (!opportunity) throw errors.notFound("Opportunité introuvable.");
    if (opportunity.status !== "open") throw errors.validation("Cette opportunité est clôturée.");

    const removed = await tx.opportunityContact.deleteMany({ where: { opportunityId: opportunity.id, contactId: input.contactId } });
    if (removed.count === 0) throw errors.notFound("Ce contact n'est pas impliqué dans l'opportunité.");

    await writeAudit(
      { actorUserId: user.id, action: "opportunity.contact_removed", entityType: "opportunity", entityId: opportunity.id, metadata: { contactId: input.contactId } },
      tx,
    );
  });
}
