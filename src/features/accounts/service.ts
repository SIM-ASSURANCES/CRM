import "server-only";
import { Prisma } from "@/generated/prisma/client";
import {
  completenessPercent,
  missingAccountFields,
  normalizeName,
  wouldCreateCycle,
  type CompletenessInput,
} from "@/features/accounts/rules";
import { accountScopeWhere } from "@/features/accounts/scope";
import type { CreateAccountInput, MergeAccountsInput, UpdateAccountInput } from "@/features/accounts/schemas";
import { notifyAssigned } from "@/features/notifications/service";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError, errors } from "@/lib/errors";

// Service des comptes (CDC 3.1 et 3.2). Toute opération : vérifie la permission, applique le périmètre de
// l'utilisateur, valide les règles métier, puis écrit la donnée et sa trace d'audit dans la MÊME transaction.

export type AccountRow = {
  id: string;
  legalName: string;
  tradeName: string | null;
  sector: string | null;
  status: string;
  country: string;
  city: string | null;
  parentName: string | null;
  ownerName: string;
  contactCount: number;
  completeness: number;
};

export type AccountContactRow = {
  contactId: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  contactStatus: string;
  relationshipTitle: string | null;
  isPrimary: boolean;
  roles: { id: string; roleType: string; productLabel: string | null; influence: string | null }[];
};

export type AccountDetail = AccountRow & {
  legalIdentifier: string | null;
  employeeCount: number | null;
  revenueAmount: number | null;
  revenueCurrency: string;
  revenueYear: number | null;
  revenueSource: string | null;
  collectiveAgreement: string | null;
  source: string | null;
  phone: string | null;
  emailDomain: string | null;
  addressLine: string | null;
  parentAccountId: string | null;
  /** Le compte parent n'est montré que s'il est dans le périmètre de l'utilisateur. */
  parent: { id: string; legalName: string } | null;
  parentRestricted: boolean;
  ownerUserId: string;
  archivedAt: Date | null;
  mergedInto: { id: string; legalName: string } | null;
  version: number;
  createdAt: Date;
  children: { id: string; legalName: string; status: string; ownerName: string }[];
  restrictedChildren: number;
  contacts: AccountContactRow[];
  missing: { required: string[]; recommended: string[] };
  groupSummary: { subsidiaries: number; contacts: number };
};

export type AccountDuplicate = {
  /** Renseigné seulement si le compte est visible par l'utilisateur. */
  id: string | null;
  legalName: string;
  ownerName: string;
  matchedOn: ("identifiant légal" | "raison sociale" | "domaine e-mail" | "téléphone")[];
};

const accountInclude = {
  owner: { select: { id: true, name: true } },
  parent: { select: { id: true, legalName: true } },
  _count: { select: { contacts: true } },
} satisfies Prisma.CrmAccountInclude;

type AccountWithRelations = Prisma.CrmAccountGetPayload<{ include: typeof accountInclude }>;

function completenessOf(account: AccountWithRelations): CompletenessInput {
  return {
    legalName: account.legalName,
    sector: account.sector,
    ownerUserId: account.ownerUserId,
    legalIdentifier: account.legalIdentifier,
    city: account.city,
    phone: account.phone,
    emailDomain: account.emailDomain,
    employeeCount: account.employeeCount,
    revenueAmount: account.revenueAmount === null ? null : Number(account.revenueAmount),
  };
}

function toRow(account: AccountWithRelations): AccountRow {
  return {
    id: account.id,
    legalName: account.legalName,
    tradeName: account.tradeName,
    sector: account.sector,
    status: account.status,
    country: account.country,
    city: account.city,
    parentName: account.parent?.legalName ?? null,
    ownerName: account.owner.name,
    contactCount: account._count.contacts,
    completeness: completenessPercent(completenessOf(account)),
  };
}

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const DUPLICATE_IDENTIFIER_MESSAGE =
  "Un compte non archivé porte déjà cet identifiant légal dans ce pays. Recherchez-le ou fusionnez les doublons.";

// --- Contrôles partagés ------------------------------------------------------------------------------------------

/** Le compte parent doit exister, être actif et dans le périmètre de l'utilisateur (on ne rattache pas à l'invisible). */
async function assertParentUsable(tx: Prisma.TransactionClient, user: CurrentUser, parentId?: string): Promise<void> {
  if (!parentId) return;
  const parent = await tx.crmAccount.findFirst({
    where: { AND: [{ id: parentId, archivedAt: null }, accountScopeWhere(user)] },
    select: { id: true },
  });
  if (!parent) {
    throw errors.validation("Compte parent invalide.", { fieldErrors: { parentAccountId: ["Compte parent invalide."] } });
  }
}

/** Empêche qu'un compte devienne son propre ancêtre (CDC A.6 : « prévenir les cycles »). */
async function assertNoCycle(tx: Prisma.TransactionClient, accountId: string, newParentId?: string): Promise<void> {
  if (!newParentId) return;
  const parents = new Map<string, string | null>();
  let current: string | null = newParentId;
  for (let depth = 0; current && depth < 100; depth++) {
    const row: { parentAccountId: string | null } | null = await tx.crmAccount.findUnique({
      where: { id: current },
      select: { parentAccountId: true },
    });
    if (!row) break;
    parents.set(current, row.parentAccountId);
    current = row.parentAccountId;
  }
  if (wouldCreateCycle(accountId, newParentId, (id) => parents.get(id) ?? null)) {
    const message = "Ce rattachement créerait une boucle dans la hiérarchie du groupe.";
    throw errors.validation(message, { fieldErrors: { parentAccountId: [message] } });
  }
}

async function resolveOwner(
  tx: Prisma.TransactionClient,
  user: CurrentUser,
  requestedOwnerId: string | undefined,
  currentOwnerId: string,
): Promise<string> {
  if (!requestedOwnerId || requestedOwnerId === currentOwnerId || !can(user.role, "account:assign")) return currentOwnerId;

  const owner = await tx.user.findFirst({
    where: { id: requestedOwnerId, role: { not: "audit" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true },
  });
  if (!owner) {
    const message = "Le propriétaire doit être un utilisateur actif pouvant gérer des comptes.";
    throw errors.validation(message, { fieldErrors: { ownerUserId: [message] } });
  }
  return owner.id;
}

// --- Lecture -----------------------------------------------------------------------------------------------------

export async function listAccounts(
  user: CurrentUser,
  options: { q?: string; status?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: AccountRow[]; total: number; page: number; pageSize: number }> {
  assertCan(user, "account:read");

  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const filters: Prisma.CrmAccountWhereInput[] = [{ archivedAt: null }, accountScopeWhere(user)];

  if (options.status) filters.push({ status: options.status });
  const q = options.q?.trim();
  if (q) {
    filters.push({
      OR: [
        { legalName: { contains: q, mode: "insensitive" } },
        { tradeName: { contains: q, mode: "insensitive" } },
        { legalIdentifier: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.CrmAccountWhereInput = { AND: filters };
  const [total, accounts] = await Promise.all([
    db.crmAccount.count({ where }),
    db.crmAccount.findMany({
      where,
      include: accountInclude,
      orderBy: [{ legalName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { rows: accounts.map(toRow), total, page, pageSize };
}

/** Comptes proposés dans les listes de choix (compte parent, rattachement d'un contact). */
export async function listAccountOptions(
  user: CurrentUser,
  options: { excludeIds?: string[] } = {},
): Promise<{ id: string; label: string }[]> {
  assertCan(user, "account:read");
  const accounts = await db.crmAccount.findMany({
    where: {
      AND: [{ archivedAt: null }, accountScopeWhere(user), options.excludeIds?.length ? { id: { notIn: options.excludeIds } } : {}],
    },
    orderBy: { legalName: "asc" },
    take: 500,
    select: { id: true, legalName: true, city: true },
  });
  return accounts.map((a) => ({ id: a.id, label: a.city ? `${a.legalName} — ${a.city}` : a.legalName }));
}

/** Identifiants des filiales (tous niveaux) VISIBLES par l'utilisateur : la vue groupe respecte les droits de chacune. */
async function visibleDescendantIds(user: CurrentUser, rootId: string, maxDepth = 6): Promise<string[]> {
  const found: string[] = [];
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const children = await db.crmAccount.findMany({
      where: { AND: [{ parentAccountId: { in: frontier }, archivedAt: null }, accountScopeWhere(user)] },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => id !== rootId && !found.includes(id));
    found.push(...frontier);
  }
  return found;
}

/** Comptes parents proposables : on exclut le compte lui-même et ses filiales visibles (un rattachement créerait une boucle). */
export async function listParentOptions(user: CurrentUser, accountId?: string): Promise<{ id: string; label: string }[]> {
  const excluded = accountId ? [accountId, ...(await visibleDescendantIds(user, accountId))] : [];
  return listAccountOptions(user, { excludeIds: excluded });
}

/** Utilisateurs auxquels un compte peut être confié (actifs, hors lecture seule). Réservé à ceux qui peuvent réaffecter. */
export async function listAssignableOwners(user: CurrentUser): Promise<{ id: string; name: string }[]> {
  assertCan(user, "account:assign");
  return db.user.findMany({
    where: { role: { not: "audit" }, OR: [{ banned: false }, { banned: null }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function getAccount(user: CurrentUser, id: string): Promise<AccountDetail> {
  assertCan(user, "account:read");

  const account = await db.crmAccount.findFirst({
    where: { AND: [{ id }, accountScopeWhere(user)] },
    include: accountInclude,
  });
  if (!account) throw errors.notFound("Compte introuvable.");

  const [parentVisible, children, totalChildren, links, descendantIds, mergedInto] = await Promise.all([
    account.parentAccountId
      ? db.crmAccount.findFirst({
          where: { AND: [{ id: account.parentAccountId }, accountScopeWhere(user)] },
          select: { id: true, legalName: true },
        })
      : null,
    db.crmAccount.findMany({
      where: { AND: [{ parentAccountId: id, archivedAt: null }, accountScopeWhere(user)] },
      include: { owner: { select: { name: true } } },
      orderBy: { legalName: "asc" },
    }),
    db.crmAccount.count({ where: { parentAccountId: id, archivedAt: null } }),
    db.accountContact.findMany({
      where: { accountId: id },
      include: { contact: true, roles: { include: { product: { select: { label: true } } }, orderBy: { createdAt: "asc" } } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    visibleDescendantIds(user, id),
    account.mergedIntoId
      ? db.crmAccount.findUnique({ where: { id: account.mergedIntoId }, select: { id: true, legalName: true } })
      : null,
  ]);

  const groupContacts = await db.accountContact.findMany({
    where: { accountId: { in: [id, ...descendantIds] } },
    distinct: ["contactId"],
    select: { contactId: true },
  });

  const row = toRow(account);
  return {
    ...row,
    legalIdentifier: account.legalIdentifier,
    employeeCount: account.employeeCount,
    revenueAmount: account.revenueAmount === null ? null : Number(account.revenueAmount),
    revenueCurrency: account.revenueCurrency,
    revenueYear: account.revenueYear,
    revenueSource: account.revenueSource,
    collectiveAgreement: account.collectiveAgreement,
    source: account.source,
    phone: account.phone,
    emailDomain: account.emailDomain,
    addressLine: account.addressLine,
    parentAccountId: account.parentAccountId,
    parent: parentVisible,
    parentRestricted: Boolean(account.parentAccountId) && !parentVisible,
    ownerUserId: account.ownerUserId,
    archivedAt: account.archivedAt,
    mergedInto,
    version: account.version,
    createdAt: account.createdAt,
    children: children.map((c) => ({ id: c.id, legalName: c.legalName, status: c.status, ownerName: c.owner.name })),
    restrictedChildren: Math.max(totalChildren - children.length, 0),
    contacts: links.map((link) => ({
      contactId: link.contactId,
      name: `${link.contact.firstName} ${link.contact.lastName}`,
      jobTitle: link.contact.jobTitle,
      email: link.contact.email,
      phone: link.contact.phone,
      contactStatus: link.contact.status,
      relationshipTitle: link.relationshipTitle,
      isPrimary: link.isPrimary,
      roles: link.roles.map((role) => ({
        id: role.id,
        roleType: role.roleType,
        productLabel: role.product?.label ?? null,
        influence: role.influence,
      })),
    })),
    missing: missingAccountFields(completenessOf(account)),
    groupSummary: { subsidiaries: descendantIds.length, contacts: groupContacts.length },
  };
}

/**
 * Détection de doublons (REC-02) sur identifiant légal, raison sociale, domaine e-mail et téléphone. Volontairement
 * NON limitée au périmètre de l'utilisateur (sinon deux commerciaux créeraient le même compte) : seuls le nom et le
 * propriétaire sont révélés, et l'identifiant n'est donné que si le compte est visible.
 */
export async function findAccountDuplicates(
  user: CurrentUser,
  input: { legalName: string; legalIdentifier?: string; emailDomain?: string; phone?: string; country: string },
  excludeId?: string,
): Promise<AccountDuplicate[]> {
  assertCan(user, "account:read");

  const candidates = await db.crmAccount.findMany({
    where: {
      AND: [
        { archivedAt: null },
        excludeId ? { id: { not: excludeId } } : {},
        {
          OR: [
            { legalName: { equals: input.legalName, mode: "insensitive" } },
            ...(input.legalIdentifier
              ? [{ legalIdentifier: { equals: input.legalIdentifier, mode: "insensitive" as const }, country: input.country }]
              : []),
            ...(input.emailDomain ? [{ emailDomain: input.emailDomain }] : []),
            ...(input.phone ? [{ phone: input.phone }] : []),
          ],
        },
      ],
    },
    include: { owner: { select: { name: true } } },
    take: 5,
  });
  if (candidates.length === 0) return [];

  const visible = await db.crmAccount.findMany({
    where: { AND: [{ id: { in: candidates.map((c) => c.id) } }, accountScopeWhere(user)] },
    select: { id: true },
  });
  const visibleIds = new Set(visible.map((v) => v.id));
  const wantedName = normalizeName(input.legalName);

  return candidates.map((candidate) => {
    const matchedOn: AccountDuplicate["matchedOn"] = [];
    if (input.legalIdentifier && candidate.legalIdentifier?.toLowerCase() === input.legalIdentifier.toLowerCase() && candidate.country === input.country) {
      matchedOn.push("identifiant légal");
    }
    if (normalizeName(candidate.legalName) === wantedName) matchedOn.push("raison sociale");
    if (input.emailDomain && candidate.emailDomain === input.emailDomain) matchedOn.push("domaine e-mail");
    if (input.phone && candidate.phone === input.phone) matchedOn.push("téléphone");
    return {
      id: visibleIds.has(candidate.id) ? candidate.id : null,
      legalName: candidate.legalName,
      ownerName: candidate.owner.name,
      matchedOn,
    };
  });
}

// --- Écriture ----------------------------------------------------------------------------------------------------

function accountData(input: CreateAccountInput | UpdateAccountInput) {
  return {
    legalName: input.legalName,
    tradeName: input.tradeName ?? null,
    legalIdentifier: input.legalIdentifier ?? null,
    sector: input.sector,
    employeeCount: input.employeeCount ?? null,
    revenueAmount: input.revenueAmount ?? null,
    revenueYear: input.revenueYear ?? null,
    revenueSource: input.revenueSource ?? null,
    collectiveAgreement: input.collectiveAgreement ?? null,
    status: input.status,
    source: input.source ?? null,
    phone: input.phone ?? null,
    emailDomain: input.emailDomain ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    country: input.country,
  };
}

export async function createAccount(user: CurrentUser, input: CreateAccountInput): Promise<{ id: string }> {
  assertCan(user, "account:write");

  if (!input.forceDuplicate) {
    const duplicates = await findAccountDuplicates(user, {
      legalName: input.legalName,
      legalIdentifier: input.legalIdentifier,
      emailDomain: input.emailDomain,
      phone: input.phone,
      country: input.country,
    });
    // Un même identifiant légal est un doublon certain : il bloque, il ne se « force » pas (index unique en base).
    if (duplicates.length > 0) throw new AppError("CONFLICT", "Un compte similaire existe déjà.", { duplicates });
  }

  try {
    return await db.$transaction(async (tx) => {
      await assertParentUsable(tx, user, input.parentAccountId);
      const ownerUserId = await resolveOwner(tx, user, input.ownerUserId, user.id);

      const account = await tx.crmAccount.create({
        data: { ...accountData(input), parentAccountId: input.parentAccountId ?? null, ownerUserId },
      });
      await writeAudit(
        { actorUserId: user.id, action: "account.created", entityType: "account", entityId: account.id, metadata: { status: account.status } },
        tx,
      );
      return { id: account.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.validation(DUPLICATE_IDENTIFIER_MESSAGE, { fieldErrors: { legalIdentifier: [DUPLICATE_IDENTIFIER_MESSAGE] } });
    }
    throw error;
  }
}

export async function updateAccount(user: CurrentUser, input: UpdateAccountInput): Promise<{ id: string }> {
  assertCan(user, "account:write");

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.crmAccount.findFirst({ where: { AND: [{ id: input.id }, accountScopeWhere(user)] } });
      if (!existing) throw errors.notFound("Compte introuvable.");
      if (existing.archivedAt) throw errors.validation("Ce compte est archivé (fusionné) : il ne peut plus être modifié.");

      if ((input.parentAccountId ?? null) !== existing.parentAccountId) {
        await assertParentUsable(tx, user, input.parentAccountId);
        await assertNoCycle(tx, existing.id, input.parentAccountId);
      }
      const ownerUserId = await resolveOwner(tx, user, input.ownerUserId, existing.ownerUserId);

      // Concurrence optimiste : si quelqu'un a modifié la fiche entre-temps, la version ne correspond plus (409).
      const updated = await tx.crmAccount.updateMany({
        where: { id: existing.id, version: input.version },
        data: { ...accountData(input), parentAccountId: input.parentAccountId ?? null, ownerUserId, version: { increment: 1 } },
      });
      if (updated.count === 0) throw errors.conflict("Ce compte a été modifié par quelqu'un d'autre. Rechargez la page.");

      const oldRevenue = existing.revenueAmount === null ? null : Number(existing.revenueAmount);
      const changedFields = [
        existing.legalName !== input.legalName && "legalName",
        existing.tradeName !== (input.tradeName ?? null) && "tradeName",
        existing.legalIdentifier !== (input.legalIdentifier ?? null) && "legalIdentifier",
        existing.sector !== input.sector && "sector",
        existing.employeeCount !== (input.employeeCount ?? null) && "employeeCount",
        oldRevenue !== (input.revenueAmount ?? null) && "revenueAmount",
        existing.status !== input.status && "status",
        existing.phone !== (input.phone ?? null) && "phone",
        existing.emailDomain !== (input.emailDomain ?? null) && "emailDomain",
        existing.city !== (input.city ?? null) && "city",
        existing.country !== input.country && "country",
        existing.parentAccountId !== (input.parentAccountId ?? null) && "parentAccountId",
        existing.ownerUserId !== ownerUserId && "ownerUserId",
      ].filter((field): field is string => typeof field === "string");

      await writeAudit(
        // Noms de champs uniquement : jamais les valeurs.
        { actorUserId: user.id, action: "account.updated", entityType: "account", entityId: existing.id, metadata: { changedFields } },
        tx,
      );
      if (existing.ownerUserId !== ownerUserId) {
        await writeAudit(
          {
            actorUserId: user.id,
            action: "account.owner_changed",
            entityType: "account",
            entityId: existing.id,
            metadata: { fromOwnerId: existing.ownerUserId, toOwnerId: ownerUserId },
          },
          tx,
        );
        await notifyAssigned(tx, {
          actorUserId: user.id,
          toUserId: ownerUserId,
          kind: "account",
          entityId: existing.id,
          name: input.legalName,
          href: `/comptes/${existing.id}`,
        });
      }
      return { id: existing.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.validation(DUPLICATE_IDENTIFIER_MESSAGE, { fieldErrors: { legalIdentifier: [DUPLICATE_IDENTIFIER_MESSAGE] } });
    }
    throw error;
  }
}

/**
 * Fusion de doublons (CDC 3.2) : le compte `sourceId` est archivé et ses filiales, contacts et rôles passent au compte
 * `targetId`, qui complète ses champs vides. Réservée aux profils autorisés, atomique, tracée. Le compte fusionné
 * n'est jamais supprimé (suppression logique : il garde un renvoi vers le compte conservé).
 */
export async function mergeAccounts(user: CurrentUser, input: MergeAccountsInput): Promise<{ id: string; movedContacts: number; movedChildren: number }> {
  assertCan(user, "account:merge");
  if (input.sourceId === input.targetId) throw errors.validation("Choisissez deux comptes différents.");

  return db.$transaction(async (tx) => {
    const scope = accountScopeWhere(user);
    const [source, target] = await Promise.all([
      tx.crmAccount.findFirst({ where: { AND: [{ id: input.sourceId }, scope] } }),
      tx.crmAccount.findFirst({ where: { AND: [{ id: input.targetId }, scope] } }),
    ]);
    if (!source || !target) throw errors.notFound("Compte introuvable.");
    if (source.archivedAt || target.archivedAt) throw errors.validation("Un compte archivé ne peut pas être fusionné.");

    // Si le compte conservé descend du compte fusionné, rattacher les filiales de ce dernier créerait une boucle.
    const parents = new Map<string, string | null>();
    let current: string | null = target.id;
    for (let depth = 0; current && depth < 100; depth++) {
      const row: { parentAccountId: string | null } | null = await tx.crmAccount.findUnique({
        where: { id: current },
        select: { parentAccountId: true },
      });
      if (!row) break;
      parents.set(current, row.parentAccountId);
      current = row.parentAccountId;
    }
    if (wouldCreateCycle(source.id, target.id, (id) => parents.get(id) ?? null)) {
      throw errors.validation("Fusion impossible : le compte conservé est une filiale du compte à fusionner.");
    }

    // 1. Archive d'abord le compte fusionné : son identifiant légal quitte l'index d'unicité (comptes non archivés).
    await tx.crmAccount.update({
      where: { id: source.id },
      data: { archivedAt: new Date(), mergedIntoId: target.id, version: { increment: 1 } },
    });

    // 2. Les filiales passent au compte conservé.
    const moved = await tx.crmAccount.updateMany({
      where: { parentAccountId: source.id },
      data: { parentAccountId: target.id },
    });

    // 3. Les contacts : un contact déjà rattaché au compte conservé fusionne ses rôles, sinon le lien est déplacé.
    const [sourceLinks, targetLinks] = await Promise.all([
      tx.accountContact.findMany({ where: { accountId: source.id }, include: { roles: true } }),
      tx.accountContact.findMany({ where: { accountId: target.id }, select: { contactId: true, isPrimary: true } }),
    ]);
    const targetContactIds = new Set(targetLinks.map((l) => l.contactId));
    let targetHasPrimary = targetLinks.some((l) => l.isPrimary);
    let movedContacts = 0;

    for (const link of sourceLinks) {
      if (targetContactIds.has(link.contactId)) {
        for (const role of link.roles) {
          const exists = await tx.contactRole.findFirst({
            where: { accountId: target.id, contactId: link.contactId, roleType: role.roleType, productId: role.productId },
            select: { id: true },
          });
          if (!exists) {
            await tx.contactRole.create({
              data: {
                accountId: target.id,
                contactId: link.contactId,
                roleType: role.roleType,
                productId: role.productId,
                influence: role.influence,
              },
            });
          }
        }
        await tx.accountContact.delete({ where: { id: link.id } });
      } else {
        const keepPrimary = link.isPrimary && !targetHasPrimary;
        // La clé composite des rôles suit le déplacement du lien (ON UPDATE CASCADE).
        await tx.accountContact.update({ where: { id: link.id }, data: { accountId: target.id, isPrimary: keepPrimary } });
        if (keepPrimary) targetHasPrimary = true;
        targetContactIds.add(link.contactId);
        movedContacts += 1;
      }
    }

    // 4. Le compte conservé complète ses champs vides avec ceux du compte fusionné.
    await tx.crmAccount.update({
      where: { id: target.id },
      data: {
        tradeName: target.tradeName ?? source.tradeName,
        legalIdentifier: target.legalIdentifier ?? source.legalIdentifier,
        sector: target.sector ?? source.sector,
        employeeCount: target.employeeCount ?? source.employeeCount,
        revenueAmount: target.revenueAmount ?? source.revenueAmount,
        revenueYear: target.revenueYear ?? source.revenueYear,
        revenueSource: target.revenueSource ?? source.revenueSource,
        collectiveAgreement: target.collectiveAgreement ?? source.collectiveAgreement,
        phone: target.phone ?? source.phone,
        emailDomain: target.emailDomain ?? source.emailDomain,
        addressLine: target.addressLine ?? source.addressLine,
        city: target.city ?? source.city,
        // Le parent n'est volontairement pas repris : il pourrait descendre du compte conservé (boucle).
        version: { increment: 1 },
      },
    });

    await writeAudit(
      {
        actorUserId: user.id,
        action: "account.merged",
        entityType: "account",
        entityId: target.id,
        metadata: { sourceId: source.id, targetId: target.id, movedContacts, movedChildren: moved.count },
      },
      tx,
    );
    return { id: target.id, movedContacts, movedChildren: moved.count };
  });
}
