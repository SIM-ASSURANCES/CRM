import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AccountStatusBadge } from "@/app/(crm)/comptes/_components/account-status-badge";
import { LinkExistingContact } from "@/app/(crm)/comptes/_components/link-existing-contact";
import { MergeDialog } from "@/app/(crm)/comptes/_components/merge-dialog";
import { RoleChip } from "@/app/(crm)/contacts/_components/contact-links";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ACCOUNT_SOURCES, COUNTRIES, labelOf } from "@/features/accounts/config";
import { getAccount, listAccountOptions, type AccountDetail } from "@/features/accounts/service";
import { listLinkableContacts } from "@/features/contacts/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatFcfa, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Fiche compte" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FLASH: Record<string, string> = {
  created: "Compte créé. Complétez les informations manquantes pour enrichir la fiche.",
  updated: "Modifications enregistrées.",
  merged: "Fusion effectuée : les filiales, contacts et rôles du compte fusionné ont été transférés ici.",
  contact_added: "Contact créé et rattaché à ce compte.",
  linked: "Contact rattaché.",
  unlinked: "Contact détaché.",
  role_removed: "Rôle retiré.",
};

export default function AccountPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-ink">{value || "—"}</dd>
    </div>
  );
}

async function AccountContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("account:read");
  const query = await searchParams;
  const flashKey = query.ok;
  const flash = typeof flashKey === "string" ? FLASH[flashKey] : undefined;

  let account: AccountDetail;
  try {
    account = await getAccount(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const archived = Boolean(account.archivedAt);
  const canWrite = can(user.role, "account:write") && !archived;
  const canWriteContacts = can(user.role, "contact:write") && !archived;
  const canMerge = can(user.role, "account:merge") && !archived;

  const [mergeOptions, linkable] = await Promise.all([
    canMerge ? listAccountOptions(user, { excludeIds: [id] }) : [],
    canWriteContacts ? listLinkableContacts(user, id) : [],
  ]);

  const revenue =
    account.revenueAmount === null
      ? null
      : `${formatFcfa(account.revenueAmount)}${account.revenueYear ? ` (${account.revenueYear})` : ""}${account.revenueSource ? ` — ${account.revenueSource}` : ""}`;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={account.legalName}
        description={[account.tradeName, account.sector].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AccountStatusBadge status={account.status} />
            {canWrite && (
              <Link href={`/comptes/${id}/modifier`} className={buttonClasses("primary")}>
                Modifier
              </Link>
            )}
            {canMerge && <MergeDialog sourceId={id} sourceName={account.legalName} options={mergeOptions} />}
          </div>
        }
      />

      {archived && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          Ce compte a été <strong>fusionné et archivé</strong> le {formatDateTime(account.archivedAt!)}.{" "}
          {account.mergedInto && (
            <>
              Il a été conservé sous{" "}
              <Link href={`/comptes/${account.mergedInto.id}`} className="font-medium text-brand-700 underline">
                {account.mergedInto.legalName}
              </Link>
              .
            </>
          )}
        </p>
      )}

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}
      {query.erreur && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          L&apos;opération n&apos;a pas pu être effectuée.
        </p>
      )}

      {!archived && (account.missing.required.length > 0 || account.missing.recommended.length > 0) && (
        <section aria-labelledby="completude" className="rounded-2xl border border-line bg-white p-5">
          <h2 id="completude" className="text-base font-semibold text-ink">
            Complétude de la fiche : {account.completeness} %
          </h2>
          {account.missing.required.length > 0 && (
            <p className="mt-2 text-sm text-danger">
              <strong>Obligatoire :</strong> {account.missing.required.join(", ")}
            </p>
          )}
          {account.missing.recommended.length > 0 && (
            <p className="mt-1 text-sm text-ink-soft">
              <strong>À compléter :</strong> {account.missing.recommended.join(", ")}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="infos" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="infos" className="mb-5 text-lg font-semibold text-ink">Informations</h2>
        <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Row label="Identifiant légal" value={account.legalIdentifier} />
          <Row label="Secteur d'activité" value={account.sector} />
          <Row label="Source d'acquisition" value={account.source ? labelOf(ACCOUNT_SOURCES, account.source) : null} />
          <Row label="Effectif" value={account.employeeCount === null ? null : formatNumber(account.employeeCount)} />
          <Row label="Chiffre d'affaires" value={revenue} />
          <Row label="Convention collective" value={account.collectiveAgreement} />
          <Row label="Adresse" value={[account.addressLine, account.city, labelOf(COUNTRIES, account.country)].filter(Boolean).join(", ")} />
          <Row label="Téléphone" value={account.phone} />
          <Row label="Domaine e-mail" value={account.emailDomain} />
          <Row label="Propriétaire commercial" value={account.ownerName} />
          <Row label="Créé le" value={formatDateTime(account.createdAt)} />
        </dl>
      </section>

      <section aria-labelledby="groupe" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="groupe" className="text-lg font-semibold text-ink">Groupe et filiales</h2>
          {canWrite && (
            <Link href={`/comptes/nouveau?parent=${id}`} className={buttonClasses("secondary")}>
              Ajouter une filiale
            </Link>
          )}
        </div>

        <p className="text-sm text-ink-soft">
          <strong>Compte parent :</strong>{" "}
          {account.parent ? (
            <Link href={`/comptes/${account.parent.id}`} className="font-medium text-brand-700 hover:underline">
              {account.parent.legalName}
            </Link>
          ) : account.parentRestricted ? (
            "Groupe (accès restreint)"
          ) : (
            "aucun (compte indépendant ou tête de groupe)"
          )}
        </p>

        {account.children.length > 0 ? (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {account.children.map((child) => (
              <li key={child.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link href={`/comptes/${child.id}`} className="font-medium text-brand-700 hover:underline">
                  {child.legalName}
                </Link>
                <span className="flex items-center gap-3 text-ink-soft">
                  {child.ownerName}
                  <AccountStatusBadge status={child.status} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted">Aucune filiale visible.</p>
        )}
        {account.restrictedChildren > 0 && (
          <p className="mt-2 text-xs text-muted">
            + {account.restrictedChildren} filiale{account.restrictedChildren > 1 ? "s" : ""} hors de votre périmètre.
          </p>
        )}
        {account.groupSummary.subsidiaries > 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            Vue groupe (comptes visibles) : <strong>{account.groupSummary.subsidiaries}</strong> filiale
            {account.groupSummary.subsidiaries > 1 ? "s" : ""}, <strong>{account.groupSummary.contacts}</strong> contact
            {account.groupSummary.contacts > 1 ? "s" : ""} au total.
          </p>
        )}
      </section>

      <section aria-labelledby="contacts" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="contacts" className="text-lg font-semibold text-ink">Contacts et rôles d&apos;achat</h2>
          {canWriteContacts && (
            <Link href={`/contacts/nouveau?compte=${id}`} className={buttonClasses("secondary")}>
              Nouveau contact
            </Link>
          )}
        </div>

        {account.contacts.length === 0 ? (
          <p className="text-sm text-muted">Aucun contact rattaché à ce compte.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {account.contacts.map((contact) => (
              <li key={contact.contactId} className="space-y-2 px-4 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <Link href={`/contacts/${contact.contactId}`} className="font-semibold text-brand-700 hover:underline">
                      {contact.name}
                    </Link>
                    {contact.isPrimary && (
                      <span className="ml-2 rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white">Principal</span>
                    )}
                    <span className="ml-2 text-ink-soft">{contact.relationshipTitle ?? contact.jobTitle}</span>
                  </p>
                  <p className="text-xs text-muted">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
                </div>
                {contact.roles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {contact.roles.map((role) => (
                      <RoleChip
                        key={role.id}
                        roleId={role.id}
                        roleType={role.roleType}
                        productLabel={role.productLabel}
                        influence={role.influence}
                        returnTo={`/comptes/${id}`}
                        editable={canWriteContacts}
                      />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWriteContacts && (
          <div className="mt-6 border-t border-line pt-6">
            <LinkExistingContact accountId={id} contacts={linkable} />
          </div>
        )}
      </section>
    </div>
  );
}
