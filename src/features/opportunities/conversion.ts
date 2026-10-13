import "server-only";
import { contactScopeWhere, accountScopeWhere } from "@/features/accounts/scope";
import { emailDomainOf } from "@/features/accounts/rules";
import { findAccountDuplicates } from "@/features/accounts/service";
import { leadScopeWhere } from "@/features/leads/scope";
import { defaultOpportunityName } from "@/features/opportunities/rules";
import type { ConvertLeadInput } from "@/features/opportunities/schemas";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError, errors } from "@/lib/errors";

// Conversion d'un prospect qualifié (CDC A.8 : « POST /leads/{id}/convert — transaction atomique, éviter les créations
// doubles »). Le prospect, son historique et ses KPI sont CONSERVÉS : on y inscrit seulement les références du compte,
// du contact et de l'opportunité créés.

// Un domaine de messagerie grand public n'identifie pas une entreprise : il ne sert pas à détecter les doublons.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr", "icloud.com", "orange.fr", "free.fr",
]);

const REQUIRED_PERMISSIONS: Permission[] = ["prospect:write", "account:write", "contact:write", "opportunity:write"];

export type ConversionResult = { opportunityId: string; accountId: string; contactId: string; createdAccount: boolean };

export async function convertLead(user: CurrentUser, input: ConvertLeadInput): Promise<ConversionResult> {
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!can(user.role, permission)) throw errors.forbidden();
  }

  const lead = await db.lead.findFirst({
    where: { AND: [{ id: input.leadId }, leadScopeWhere(user)] },
    include: { product: { select: { label: true } } },
  });
  if (!lead) throw errors.notFound("Prospect introuvable.");
  if (lead.convertedAt) {
    throw new AppError("CONFLICT", "Ce prospect a déjà été converti.", { opportunityId: lead.convertedOpportunityId });
  }
  if (lead.status !== "open") throw errors.validation("Seul un prospect en cours peut être converti.");

  const domain = emailDomainOf(lead.email);
  const emailDomain = domain && !FREE_EMAIL_DOMAINS.has(domain) ? domain : undefined;

  // Alerte de doublon AVANT de créer un compte (sauf rattachement explicite à un compte existant ou confirmation).
  if (!input.existingAccountId && !input.forceDuplicate) {
    const duplicates = await findAccountDuplicates(user, {
      legalName: lead.companyName,
      emailDomain,
      phone: lead.phone,
      country: "CI",
    });
    if (duplicates.length > 0) throw new AppError("CONFLICT", "Un compte similaire existe déjà.", { duplicates });
  }

  return db.$transaction(async (tx) => {
    // 1. Compte : existant (visible) ou créé à partir du prospect.
    let account: { id: string; legalName: string };
    let createdAccount = false;
    if (input.existingAccountId) {
      const existing = await tx.crmAccount.findFirst({
        where: { AND: [{ id: input.existingAccountId, archivedAt: null }, accountScopeWhere(user)] },
        select: { id: true, legalName: true },
      });
      if (!existing) {
        throw errors.validation("Compte introuvable ou hors de votre périmètre.", {
          fieldErrors: { existingAccountId: ["Compte introuvable ou hors de votre périmètre."] },
        });
      }
      account = existing;
    } else {
      account = await tx.crmAccount.create({
        data: {
          legalName: lead.companyName,
          sector: lead.sector,
          status: "prospect",
          phone: lead.phone,
          emailDomain: emailDomain ?? null,
          country: "CI",
          ownerUserId: lead.ownerUserId,
        },
        select: { id: true, legalName: true },
      });
      createdAccount = true;
      await writeAudit(
        { actorUserId: user.id, action: "account.created", entityType: "account", entityId: account.id, metadata: { fromLeadId: lead.id } },
        tx,
      );
    }

    // 2. Contact : on réutilise un contact visible de même e-mail, sinon on le crée à partir du prospect.
    const existingContact = await tx.contact.findFirst({
      where: { AND: [{ archivedAt: null, email: { equals: lead.email, mode: "insensitive" } }, contactScopeWhere(user)] },
      select: { id: true },
    });
    let contactId = existingContact?.id;
    if (!contactId) {
      const contact = await tx.contact.create({
        data: {
          firstName: lead.contactFirstName,
          lastName: lead.contactLastName,
          jobTitle: lead.jobTitle,
          email: lead.email,
          phone: lead.phone,
          ownerUserId: lead.ownerUserId,
        },
        select: { id: true },
      });
      contactId = contact.id;
      await writeAudit(
        { actorUserId: user.id, action: "contact.created", entityType: "contact", entityId: contactId, metadata: { fromLeadId: lead.id } },
        tx,
      );
    }

    const link = await tx.accountContact.findUnique({
      where: { accountId_contactId: { accountId: account.id, contactId } },
      select: { id: true },
    });
    if (!link) {
      const hasPrimary = await tx.accountContact.count({ where: { accountId: account.id, isPrimary: true } });
      await tx.accountContact.create({
        data: { accountId: account.id, contactId, relationshipTitle: lead.jobTitle, isPrimary: hasPrimary === 0 },
      });
    }

    // 3. Opportunité : l'étape et le montant du prospect sont repris tels quels.
    const opportunity = await tx.opportunity.create({
      data: {
        name: defaultOpportunityName(account.legalName, lead.product?.label ?? null, input.expectedCloseDate),
        accountId: account.id,
        ownerUserId: lead.ownerUserId,
        productId: lead.productId,
        amount: lead.expectedRevenue ?? 0,
        revenuePeriod: "annual",
        stage: lead.progress,
        expectedCloseDate: input.expectedCloseDate,
        nextAction: input.nextAction,
        nextActionDate: input.nextActionDate,
      },
    });
    await tx.opportunityContact.create({ data: { opportunityId: opportunity.id, contactId, isMain: true } });
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
      { actorUserId: user.id, action: "opportunity.created", entityType: "opportunity", entityId: opportunity.id, metadata: { stage: opportunity.stage, fromLeadId: lead.id } },
      tx,
    );

    // 4. Le prospect garde son historique et renvoie vers ce qui a été créé. Une conversion déjà faite échoue ici
    // (la condition `convertedAt: null` et la version protègent d'une double conversion simultanée).
    const marked = await tx.lead.updateMany({
      where: { id: lead.id, convertedAt: null, version: lead.version },
      data: {
        convertedAt: new Date(),
        convertedAccountId: account.id,
        convertedContactId: contactId,
        convertedOpportunityId: opportunity.id,
        version: { increment: 1 },
      },
    });
    if (marked.count === 0) throw errors.conflict("Ce prospect vient d'être converti ou modifié. Rechargez la page.");

    await writeAudit(
      {
        actorUserId: user.id,
        action: "lead.converted",
        entityType: "lead",
        entityId: lead.id,
        metadata: { accountId: account.id, opportunityId: opportunity.id, createdAccount },
      },
      tx,
    );

    return { opportunityId: opportunity.id, accountId: account.id, contactId, createdAccount };
  });
}
