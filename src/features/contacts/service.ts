import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { accountScopeWhere, contactScopeWhere } from "@/features/accounts/scope";
import type {
  AddRoleInput,
  CreateContactInput,
  LinkContactInput,
  UpdateContactInput,
} from "@/features/contacts/schemas";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError, errors } from "@/lib/errors";

// Service des contacts (CDC 3.3). Un contact peut être rattaché à plusieurs comptes ; son rôle d'achat se qualifie
// par compte et, si besoin, par produit. Même discipline que partout : permission, périmètre, règles, audit.

export type ContactRow = {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  /** Comptes rattachés, limités à ceux que l'utilisateur peut voir. */
  accounts: { id: string; legalName: string; isPrimary: boolean }[];
};

export type ContactLink = {
  accountId: string;
  accountName: string;
  relationshipTitle: string | null;
  isPrimary: boolean;
  startDate: Date | null;
  endDate: Date | null;
  roles: { id: string; roleType: string; productLabel: string | null; influence: string | null }[];
};

export type ContactDetail = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  preferredChannel: string | null;
  contactRestrictions: string | null;
  ownerName: string;
  version: number;
  links: ContactLink[];
};

export type ContactDuplicate = {
  name: string;
  ownerName: string;
  matchedOn: ("e-mail" | "nom et téléphone")[];
};

function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user.role, permission)) throw errors.forbidden();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// --- Lecture -----------------------------------------------------------------------------------------------------

export async function listContacts(
  user: CurrentUser,
  options: { q?: string; status?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: ContactRow[]; total: number; page: number; pageSize: number }> {
  assertCan(user, "contact:read");

  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const filters: Prisma.ContactWhereInput[] = [{ archivedAt: null }, contactScopeWhere(user)];

  if (options.status) filters.push({ status: options.status });
  const q = options.q?.trim();
  if (q) {
    filters.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { accounts: { some: { account: { legalName: { contains: q, mode: "insensitive" } } } } },
      ],
    });
  }

  const where: Prisma.ContactWhereInput = { AND: filters };
  const [total, contacts] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: {
        accounts: {
          where: { account: { AND: [{ archivedAt: null }, accountScopeWhere(user)] } },
          include: { account: { select: { id: true, legalName: true } } },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    rows: contacts.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      jobTitle: c.jobTitle,
      email: c.email,
      phone: c.phone,
      status: c.status,
      accounts: c.accounts.map((l) => ({ id: l.account.id, legalName: l.account.legalName, isPrimary: l.isPrimary })),
    })),
    total,
    page,
    pageSize,
  };
}

export async function getContact(user: CurrentUser, id: string): Promise<ContactDetail> {
  assertCan(user, "contact:read");

  const contact = await db.contact.findFirst({
    where: { AND: [{ id }, contactScopeWhere(user)] },
    include: {
      owner: { select: { name: true } },
      accounts: {
        where: { account: accountScopeWhere(user) },
        include: {
          account: { select: { legalName: true } },
          roles: { include: { product: { select: { label: true } } }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!contact) throw errors.notFound("Contact introuvable.");

  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    name: `${contact.firstName} ${contact.lastName}`,
    jobTitle: contact.jobTitle,
    department: contact.department,
    email: contact.email,
    phone: contact.phone,
    status: contact.status,
    preferredChannel: contact.preferredChannel,
    contactRestrictions: contact.contactRestrictions,
    ownerName: contact.owner.name,
    version: contact.version,
    links: contact.accounts.map((link) => ({
      accountId: link.accountId,
      accountName: link.account.legalName,
      relationshipTitle: link.relationshipTitle,
      isPrimary: link.isPrimary,
      startDate: link.startDate,
      endDate: link.endDate,
      roles: link.roles.map((role) => ({
        id: role.id,
        roleType: role.roleType,
        productLabel: role.product?.label ?? null,
        influence: role.influence,
      })),
    })),
  };
}

/** Contacts visibles qui ne sont pas déjà rattachés à ce compte : choix pour « associer un contact existant ». */
export async function listLinkableContacts(user: CurrentUser, accountId: string): Promise<{ id: string; label: string }[]> {
  assertCan(user, "contact:read");
  const contacts = await db.contact.findMany({
    where: { AND: [{ archivedAt: null }, contactScopeWhere(user), { accounts: { none: { accountId } } }] },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 300,
    select: { id: true, firstName: true, lastName: true, jobTitle: true },
  });
  return contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}${c.jobTitle ? ` — ${c.jobTitle}` : ""}` }));
}

/** Détection de doublons sur l'e-mail, ou sur le nom ET le téléphone (CDC 12 et A.5). Globale, sans révéler d'identifiant. */
export async function findContactDuplicates(
  input: { firstName: string; lastName: string; email?: string; phone?: string },
  excludeId?: string,
): Promise<ContactDuplicate[]> {
  // Sans e-mail ni téléphone, rien ne permet d'identifier un doublon. Attention : un filtre `OR: []` est ignoré par
  // Prisma (il ne filtre rien) et ferait remonter TOUS les contacts comme doublons.
  if (!input.email && !input.phone) return [];

  const matches = await db.contact.findMany({
    where: {
      AND: [
        { archivedAt: null },
        excludeId ? { id: { not: excludeId } } : {},
        {
          OR: [
            ...(input.email ? [{ email: { equals: input.email, mode: "insensitive" as const } }] : []),
            ...(input.phone
              ? [
                  {
                    phone: input.phone,
                    firstName: { equals: input.firstName, mode: "insensitive" as const },
                    lastName: { equals: input.lastName, mode: "insensitive" as const },
                  },
                ]
              : []),
          ],
        },
      ],
    },
    include: { owner: { select: { name: true } } },
    take: 5,
  });

  return matches.map((contact) => {
    const matchedOn: ContactDuplicate["matchedOn"] = [];
    if (input.email && contact.email?.toLowerCase() === input.email.toLowerCase()) matchedOn.push("e-mail");
    if (input.phone && contact.phone === input.phone) matchedOn.push("nom et téléphone");
    return { name: `${contact.firstName} ${contact.lastName}`, ownerName: contact.owner.name, matchedOn };
  });
}

// --- Écriture ----------------------------------------------------------------------------------------------------

async function assertAccountVisible(tx: Prisma.TransactionClient, user: CurrentUser, accountId: string) {
  const account = await tx.crmAccount.findFirst({
    where: { AND: [{ id: accountId, archivedAt: null }, accountScopeWhere(user)] },
    select: { id: true },
  });
  if (!account) throw errors.notFound("Compte introuvable.");
}

async function assertContactVisible(tx: Prisma.TransactionClient, user: CurrentUser, contactId: string) {
  const contact = await tx.contact.findFirst({
    where: { AND: [{ id: contactId, archivedAt: null }, contactScopeWhere(user)] },
    select: { id: true },
  });
  if (!contact) throw errors.notFound("Contact introuvable.");
}

export async function createContact(user: CurrentUser, input: CreateContactInput): Promise<{ id: string }> {
  assertCan(user, "contact:write");

  if (!input.forceDuplicate) {
    const duplicates = await findContactDuplicates(input);
    if (duplicates.length > 0) throw new AppError("CONFLICT", "Un contact similaire existe déjà.", { duplicates });
  }

  return db.$transaction(async (tx) => {
    if (input.accountId) await assertAccountVisible(tx, user, input.accountId);

    const contact = await tx.contact.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: input.status,
        preferredChannel: input.preferredChannel ?? null,
        contactRestrictions: input.contactRestrictions ?? null,
        ownerUserId: user.id,
      },
    });

    if (input.accountId) {
      // Premier contact d'un compte : il devient le contact principal.
      const hasPrimary = await tx.accountContact.count({ where: { accountId: input.accountId, isPrimary: true } });
      await tx.accountContact.create({
        data: {
          accountId: input.accountId,
          contactId: contact.id,
          relationshipTitle: input.relationshipTitle ?? input.jobTitle ?? null,
          isPrimary: hasPrimary === 0,
        },
      });
    }

    await writeAudit(
      { actorUserId: user.id, action: "contact.created", entityType: "contact", entityId: contact.id, metadata: { accountId: input.accountId ?? null } },
      tx,
    );
    return { id: contact.id };
  });
}

export async function updateContact(user: CurrentUser, input: UpdateContactInput): Promise<{ id: string }> {
  assertCan(user, "contact:write");

  return db.$transaction(async (tx) => {
    const existing = await tx.contact.findFirst({ where: { AND: [{ id: input.id }, contactScopeWhere(user)] } });
    if (!existing) throw errors.notFound("Contact introuvable.");

    const updated = await tx.contact.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: input.status,
        preferredChannel: input.preferredChannel ?? null,
        contactRestrictions: input.contactRestrictions ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw errors.conflict("Ce contact a été modifié par quelqu'un d'autre. Rechargez la page.");

    const changedFields = [
      existing.firstName !== input.firstName && "firstName",
      existing.lastName !== input.lastName && "lastName",
      existing.jobTitle !== (input.jobTitle ?? null) && "jobTitle",
      existing.email !== (input.email ?? null) && "email",
      existing.phone !== (input.phone ?? null) && "phone",
      existing.status !== input.status && "status",
      existing.preferredChannel !== (input.preferredChannel ?? null) && "preferredChannel",
    ].filter((field): field is string => typeof field === "string");

    await writeAudit(
      { actorUserId: user.id, action: "contact.updated", entityType: "contact", entityId: existing.id, metadata: { changedFields } },
      tx,
    );
    return { id: existing.id };
  });
}

/**
 * Rattache un contact à un compte, ou met à jour ce rattachement (fonction, dates, contact principal).
 * Un seul contact principal par compte : désigner un nouveau principal retire ce statut à l'ancien.
 */
export async function linkContact(user: CurrentUser, input: LinkContactInput): Promise<void> {
  assertCan(user, "contact:write");

  await db.$transaction(async (tx) => {
    await assertAccountVisible(tx, user, input.accountId);
    await assertContactVisible(tx, user, input.contactId);

    if (input.isPrimary) {
      await tx.accountContact.updateMany({
        where: { accountId: input.accountId, isPrimary: true, NOT: { contactId: input.contactId } },
        data: { isPrimary: false },
      });
    }

    const existing = await tx.accountContact.findUnique({
      where: { accountId_contactId: { accountId: input.accountId, contactId: input.contactId } },
      select: { id: true },
    });
    const data = {
      relationshipTitle: input.relationshipTitle ?? null,
      isPrimary: input.isPrimary,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    };

    if (existing) {
      await tx.accountContact.update({ where: { id: existing.id }, data });
    } else {
      await tx.accountContact.create({ data: { accountId: input.accountId, contactId: input.contactId, ...data } });
    }

    await writeAudit(
      {
        actorUserId: user.id,
        action: existing ? "contact.link_updated" : "contact.linked",
        entityType: "contact",
        entityId: input.contactId,
        metadata: { accountId: input.accountId, isPrimary: input.isPrimary },
      },
      tx,
    );
  });
}

/** Retire le rattachement ; les rôles d'achat qui en dépendent disparaissent avec lui. */
export async function unlinkContact(user: CurrentUser, input: { contactId: string; accountId: string }): Promise<void> {
  assertCan(user, "contact:write");

  await db.$transaction(async (tx) => {
    await assertAccountVisible(tx, user, input.accountId);
    await assertContactVisible(tx, user, input.contactId);

    const removed = await tx.accountContact.deleteMany({ where: { accountId: input.accountId, contactId: input.contactId } });
    if (removed.count === 0) throw errors.notFound("Ce contact n'est pas rattaché à ce compte.");

    await writeAudit(
      { actorUserId: user.id, action: "contact.unlinked", entityType: "contact", entityId: input.contactId, metadata: { accountId: input.accountId } },
      tx,
    );
  });
}

export async function addRole(user: CurrentUser, input: AddRoleInput): Promise<void> {
  assertCan(user, "contact:write");

  try {
    await db.$transaction(async (tx) => {
      await assertAccountVisible(tx, user, input.accountId);
      await assertContactVisible(tx, user, input.contactId);

      const link = await tx.accountContact.findUnique({
        where: { accountId_contactId: { accountId: input.accountId, contactId: input.contactId } },
        select: { id: true },
      });
      if (!link) {
        const message = "Rattachez d'abord ce contact au compte avant de qualifier son rôle.";
        throw errors.validation(message, { fieldErrors: { accountId: [message] } });
      }
      if (input.productId) {
        const product = await tx.product.findFirst({ where: { id: input.productId, active: true }, select: { id: true } });
        if (!product) throw errors.validation("Produit invalide.", { fieldErrors: { productId: ["Produit invalide."] } });
      }

      const role = await tx.contactRole.create({
        data: {
          accountId: input.accountId,
          contactId: input.contactId,
          roleType: input.roleType,
          productId: input.productId ?? null,
          influence: input.influence ?? null,
        },
      });
      await writeAudit(
        {
          actorUserId: user.id,
          action: "contact.role_added",
          entityType: "contact",
          entityId: input.contactId,
          metadata: { accountId: input.accountId, roleId: role.id, roleType: input.roleType },
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = "Ce rôle est déjà défini pour ce contact, ce compte et ce produit.";
      throw errors.validation(message, { fieldErrors: { roleType: [message] } });
    }
    throw error;
  }
}

export async function removeRole(user: CurrentUser, roleId: string): Promise<void> {
  assertCan(user, "contact:write");

  await db.$transaction(async (tx) => {
    // Le rôle n'est accessible que si son compte est dans le périmètre de l'utilisateur.
    const role = await tx.contactRole.findFirst({
      where: { id: roleId, link: { account: accountScopeWhere(user) } },
      select: { id: true, accountId: true, contactId: true, roleType: true },
    });
    if (!role) throw errors.notFound("Rôle introuvable.");

    await tx.contactRole.delete({ where: { id: role.id } });
    await writeAudit(
      {
        actorUserId: user.id,
        action: "contact.role_removed",
        entityType: "contact",
        entityId: role.contactId,
        metadata: { accountId: role.accountId, roleType: role.roleType },
      },
      tx,
    );
  });
}
