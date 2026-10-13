import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  CURRENCY,
  DEFAULT_THRESHOLDS,
  THRESHOLDS_SETTING_KEY,
  type LeadThresholds,
} from "@/features/leads/config";
import { validateLeadRules, type FieldErrors } from "@/features/leads/rules";
import { leadScopeWhere } from "@/features/leads/scope";
import type { CreateLeadInput, MarkLostInput, UpdateLeadInput } from "@/features/leads/schemas";
import { destinationViews, viewWhere, type LeadView } from "@/features/leads/views";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError, errors } from "@/lib/errors";

// Service métier des prospects. Toute opération : vérifie la permission, applique le périmètre de l'utilisateur,
// valide les règles métier, puis écrit la donnée, son historique et la trace d'audit DANS LA MÊME TRANSACTION.

export type LeadRow = {
  id: string;
  companyName: string;
  sector: string;
  contactName: string;
  phone: string;
  email: string;
  jobTitle: string;
  insertedOn: Date;
  progress: number;
  status: string;
  productLabel: string | null;
  expectedRevenue: number | null;
  ownerName: string;
};

export type LeadDetail = LeadRow & {
  contactLastName: string;
  contactFirstName: string;
  productId: string | null;
  lossReason: string | null;
  lossComment: string | null;
  version: number;
};

export type DuplicateMatch = {
  companyName: string;
  ownerName: string;
  matchedOn: ("e-mail" | "téléphone" | "entreprise")[];
};

export type { FieldErrors };

export type LeadMutationResult = {
  id: string;
  progress: number;
  status: string;
  destinations: LeadView[];
};

const leadInclude = {
  product: { select: { label: true } },
  owner: { select: { name: true } },
} satisfies Prisma.LeadInclude;

type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

function toRow(lead: LeadWithRelations): LeadRow {
  return {
    id: lead.id,
    companyName: lead.companyName,
    sector: lead.sector,
    contactName: `${lead.contactFirstName} ${lead.contactLastName}`,
    phone: lead.phone,
    email: lead.email,
    jobTitle: lead.jobTitle,
    insertedOn: lead.insertedOn,
    progress: lead.progress,
    status: lead.status,
    productLabel: lead.product?.label ?? null,
    expectedRevenue: lead.expectedRevenue === null ? null : Number(lead.expectedRevenue),
    ownerName: lead.owner.name,
  };
}

function toDetail(lead: LeadWithRelations): LeadDetail {
  return {
    ...toRow(lead),
    contactLastName: lead.contactLastName,
    contactFirstName: lead.contactFirstName,
    productId: lead.productId,
    lossReason: lead.lossReason,
    lossComment: lead.lossComment,
    version: lead.version,
  };
}

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

// --- Paramètres --------------------------------------------------------------------------------------------------

const thresholdsSchema = z
  .object({
    qualifiedAbove: z.number().int().min(0).max(99),
    proposalAbove: z.number().int().min(0).max(99),
    pipelineMin: z.number().int().min(0).max(99),
  })
  .refine((t) => t.qualifiedAbove < t.proposalAbove, { message: "qualifiedAbove doit être inférieur à proposalAbove" });

/** Seuils de bascule entre écrans : paramètre modifiable (table settings), valeurs de l'Excel par défaut. */
export async function getThresholds(): Promise<LeadThresholds> {
  const row = await db.setting.findUnique({ where: { key: THRESHOLDS_SETTING_KEY } });
  const parsed = thresholdsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_THRESHOLDS;
}

export async function listActiveProducts(): Promise<{ id: string; label: string }[]> {
  return db.product.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, label: true },
  });
}

// --- Règles métier -----------------------------------------------------------------------------------------------

function assertRules(input: Parameters<typeof validateLeadRules>[0], thresholds: LeadThresholds): void {
  const fieldErrors = validateLeadRules(input, thresholds);
  if (fieldErrors) throw errors.validation("Certaines informations sont manquantes.", { fieldErrors });
}

async function assertActiveProduct(tx: Prisma.TransactionClient, productId?: string): Promise<void> {
  if (!productId) return;
  const product = await tx.product.findFirst({ where: { id: productId, active: true }, select: { id: true } });
  if (!product) throw errors.validation("Produit invalide.", { fieldErrors: { productId: ["Produit invalide."] } });
}

// --- Lecture -----------------------------------------------------------------------------------------------------

export async function listLeads(
  user: CurrentUser,
  options: { view?: LeadView; lost?: boolean; q?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: LeadRow[]; total: number; page: number; pageSize: number }> {
  assertCan(user, "prospect:read");

  const thresholds = await getThresholds();
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const filters: Prisma.LeadWhereInput[] = [leadScopeWhere(user)];
  if (options.view) filters.push(viewWhere(options.view, thresholds));
  if (options.lost) filters.push({ status: "lost" });

  const q = options.q?.trim();
  if (q) {
    filters.push({
      OR: [
        { companyName: { contains: q, mode: "insensitive" } },
        { contactLastName: { contains: q, mode: "insensitive" } },
        { contactFirstName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    });
  }

  const where: Prisma.LeadWhereInput = { AND: filters };
  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      include: leadInclude,
      orderBy: [{ insertedOn: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { rows: leads.map(toRow), total, page, pageSize };
}

/** Un prospect hors périmètre est présenté comme introuvable (404) : on ne révèle pas son existence. */
export async function getLead(user: CurrentUser, id: string): Promise<LeadDetail> {
  assertCan(user, "prospect:read");
  const lead = await db.lead.findFirst({
    where: { AND: [{ id }, leadScopeWhere(user)] },
    include: leadInclude,
  });
  if (!lead) throw errors.notFound("Prospect introuvable.");
  return toDetail(lead);
}

/**
 * Détection de doublons (REC-02) sur e-mail, téléphone et raison sociale. Volontairement NON limitée au périmètre
 * de l'utilisateur, sinon deux commerciaux créeraient le même prospect ; seuls l'entreprise et le propriétaire sont révélés.
 */
export async function findDuplicates(
  input: { companyName: string; email: string; phone: string },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const leads = await db.lead.findMany({
    where: {
      AND: [
        excludeId ? { id: { not: excludeId } } : {},
        {
          OR: [
            { email: input.email },
            { phone: input.phone },
            { companyName: { equals: input.companyName, mode: "insensitive" } },
          ],
        },
      ],
    },
    include: { owner: { select: { name: true } } },
    take: 5,
  });

  return leads.map((lead) => {
    const matchedOn: DuplicateMatch["matchedOn"] = [];
    if (lead.email === input.email) matchedOn.push("e-mail");
    if (lead.phone === input.phone) matchedOn.push("téléphone");
    if (lead.companyName.toLowerCase() === input.companyName.toLowerCase()) matchedOn.push("entreprise");
    return { companyName: lead.companyName, ownerName: lead.owner.name, matchedOn };
  });
}

// --- Écriture ----------------------------------------------------------------------------------------------------

export async function createLead(user: CurrentUser, input: CreateLeadInput): Promise<LeadMutationResult> {
  assertCan(user, "prospect:write");
  const thresholds = await getThresholds();
  assertRules(input, thresholds);

  if (!input.forceDuplicate) {
    const duplicates = await findDuplicates(input);
    if (duplicates.length > 0) {
      throw new AppError("CONFLICT", "Un prospect similaire existe déjà.", { duplicates });
    }
  }

  return db.$transaction(async (tx) => {
    await assertActiveProduct(tx, input.productId);
    const won = input.progress === 100;

    const lead = await tx.lead.create({
      data: {
        companyName: input.companyName,
        sector: input.sector,
        contactLastName: input.contactLastName,
        contactFirstName: input.contactFirstName,
        phone: input.phone,
        email: input.email,
        jobTitle: input.jobTitle,
        insertedOn: input.insertedOn,
        progress: input.progress,
        status: won ? "won" : "open",
        closedAt: won ? new Date() : null,
        productId: input.productId ?? null,
        expectedRevenue: input.expectedRevenue ?? null,
        currency: CURRENCY,
        ownerUserId: user.id,
      },
    });

    await tx.leadEvent.create({
      data: {
        leadId: lead.id,
        actorUserId: user.id,
        type: won ? "won" : "created",
        fromProgress: null,
        toProgress: lead.progress,
        status: lead.status,
        expectedRevenue: lead.expectedRevenue,
      },
    });

    await writeAudit(
      { actorUserId: user.id, action: "lead.created", entityType: "lead", entityId: lead.id, metadata: { progress: lead.progress } },
      tx,
    );

    return {
      id: lead.id,
      progress: lead.progress,
      status: lead.status,
      destinations: destinationViews(lead.progress, lead.status, thresholds),
    };
  });
}

export async function updateLead(user: CurrentUser, input: UpdateLeadInput): Promise<LeadMutationResult> {
  assertCan(user, "prospect:write");
  const thresholds = await getThresholds();
  assertRules(input, thresholds);

  return db.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({ where: { AND: [{ id: input.id }, leadScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Prospect introuvable.");
    if (existing.status !== "open") {
      throw errors.validation("Ce prospect est clôturé (gagné ou perdu) : il ne peut plus être modifié.");
    }
    await assertActiveProduct(tx, input.productId);

    const won = input.progress === 100;
    const newRevenue = input.expectedRevenue ?? null;
    const oldRevenue = existing.expectedRevenue === null ? null : Number(existing.expectedRevenue);

    // Concurrence optimiste : si quelqu'un a modifié la fiche entre-temps, la version ne correspond plus (409).
    const updated = await tx.lead.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        companyName: input.companyName,
        sector: input.sector,
        contactLastName: input.contactLastName,
        contactFirstName: input.contactFirstName,
        phone: input.phone,
        email: input.email,
        jobTitle: input.jobTitle,
        insertedOn: input.insertedOn,
        progress: input.progress,
        status: won ? "won" : "open",
        closedAt: won ? new Date() : null,
        productId: input.productId ?? null,
        expectedRevenue: newRevenue,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Ce prospect a été modifié par quelqu'un d'autre. Rechargez la page.");

    const changedFields = [
      existing.companyName !== input.companyName && "companyName",
      existing.sector !== input.sector && "sector",
      existing.contactLastName !== input.contactLastName && "contactLastName",
      existing.contactFirstName !== input.contactFirstName && "contactFirstName",
      existing.phone !== input.phone && "phone",
      existing.email !== input.email && "email",
      existing.jobTitle !== input.jobTitle && "jobTitle",
      existing.insertedOn.getTime() !== input.insertedOn.getTime() && "insertedOn",
      existing.progress !== input.progress && "progress",
      existing.productId !== (input.productId ?? null) && "productId",
      oldRevenue !== newRevenue && "expectedRevenue",
    ].filter((field): field is string => typeof field === "string");

    // L'historique ne retient que ce qui change l'étape, le statut ou le montant (instantanés pour les KPI).
    if (existing.progress !== input.progress || oldRevenue !== newRevenue) {
      await tx.leadEvent.create({
        data: {
          leadId: existing.id,
          actorUserId: user.id,
          type: won ? "won" : existing.progress !== input.progress ? "progress_changed" : "updated",
          fromProgress: existing.progress,
          toProgress: input.progress,
          status: won ? "won" : "open",
          expectedRevenue: newRevenue,
        },
      });
    }

    await writeAudit(
      {
        actorUserId: user.id,
        action: won ? "lead.won" : "lead.updated",
        entityType: "lead",
        entityId: existing.id,
        // Noms de champs uniquement : jamais les valeurs (données personnelles du prospect).
        metadata: { changedFields, fromProgress: existing.progress, toProgress: input.progress },
      },
      tx,
    );

    return {
      id: existing.id,
      progress: input.progress,
      status: won ? "won" : "open",
      destinations: destinationViews(input.progress, won ? "won" : "open", thresholds),
    };
  });
}

export async function markLost(user: CurrentUser, input: MarkLostInput): Promise<LeadMutationResult> {
  assertCan(user, "prospect:write");

  return db.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({ where: { AND: [{ id: input.id }, leadScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Prospect introuvable.");
    if (existing.status !== "open") throw errors.validation("Ce prospect est déjà clôturé.");

    const updated = await tx.lead.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        status: "lost",
        lossReason: input.reason,
        lossComment: input.comment ?? null,
        closedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Ce prospect a été modifié par quelqu'un d'autre. Rechargez la page.");

    await tx.leadEvent.create({
      data: {
        leadId: existing.id,
        actorUserId: user.id,
        type: "lost",
        fromProgress: existing.progress,
        toProgress: existing.progress,
        status: "lost",
        expectedRevenue: existing.expectedRevenue,
      },
    });
    await writeAudit(
      { actorUserId: user.id, action: "lead.lost", entityType: "lead", entityId: existing.id, metadata: { reason: input.reason } },
      tx,
    );

    return { id: existing.id, progress: existing.progress, status: "lost", destinations: [] };
  });
}
