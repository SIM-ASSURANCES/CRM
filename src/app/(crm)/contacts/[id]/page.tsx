import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AddRoleForm, LinkAccountForm, RoleChip, UnlinkControl } from "@/app/(crm)/contacts/_components/contact-links";
import { ContactForm } from "@/app/(crm)/contacts/_components/contact-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAccountOptions } from "@/features/accounts/service";
import { getContact, type ContactDetail } from "@/features/contacts/service";
import { listActiveProducts } from "@/features/leads/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Fiche contact" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FLASH: Record<string, string> = {
  created: "Contact créé.",
  updated: "Modifications enregistrées.",
  linked: "Rattachement enregistré.",
  unlinked: "Contact détaché du compte.",
  role_added: "Rôle d'achat ajouté.",
  role_removed: "Rôle retiré.",
};

export default function ContactPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContactContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ContactContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("contact:read");
  const query = await searchParams;
  const flash = typeof query.ok === "string" ? FLASH[query.ok] : undefined;

  let contact: ContactDetail;
  try {
    contact = await getContact(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canWrite = can(user.role, "contact:write");
  const [accountOptions, products] = canWrite
    ? await Promise.all([listAccountOptions(user), listActiveProducts()])
    : [[], []];
  const returnTo = `/contacts/${id}`;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={contact.name}
        description={[contact.jobTitle, contact.department].filter(Boolean).join(" · ") || undefined}
      />

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

      <section aria-labelledby="rattachements" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="rattachements" className="mb-5 text-lg font-semibold text-ink">Comptes et rôles d&apos;achat</h2>

        {contact.links.length === 0 ? (
          <p className="text-sm text-muted">Ce contact n&apos;est rattaché à aucun compte que vous pouvez voir.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {contact.links.map((link) => (
              <li key={link.accountId} className="space-y-3 px-4 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    <Link href={`/comptes/${link.accountId}`} className="font-semibold text-brand-700 hover:underline">
                      {link.accountName}
                    </Link>
                    {link.isPrimary && (
                      <span className="ml-2 rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white">Principal</span>
                    )}
                    {link.relationshipTitle && <span className="ml-2 text-ink-soft">{link.relationshipTitle}</span>}
                    {(link.startDate || link.endDate) && (
                      <span className="ml-2 text-xs text-muted">
                        {link.startDate ? `depuis le ${formatDate(link.startDate)}` : ""}
                        {link.endDate ? ` jusqu'au ${formatDate(link.endDate)}` : ""}
                      </span>
                    )}
                  </p>
                  {canWrite && <UnlinkControl contactId={id} accountId={link.accountId} accountName={link.accountName} />}
                </div>
                {link.roles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {link.roles.map((role) => (
                      <RoleChip
                        key={role.id}
                        roleId={role.id}
                        roleType={role.roleType}
                        productLabel={role.productLabel}
                        influence={role.influence}
                        returnTo={returnTo}
                        editable={canWrite}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted">Aucun rôle d&apos;achat qualifié pour ce compte.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite && (
          <div className="mt-6 grid gap-8 border-t border-line pt-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-4 text-base font-semibold text-ink">Rattacher à un compte</h3>
              <LinkAccountForm contactId={id} accounts={accountOptions} />
            </div>
            <div>
              <h3 className="mb-4 text-base font-semibold text-ink">Qualifier un rôle d&apos;achat</h3>
              <AddRoleForm
                contactId={id}
                links={contact.links.map((l) => ({ id: l.accountId, label: l.accountName }))}
                products={products}
              />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="infos" className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h2 id="infos" className="mb-5 text-lg font-semibold text-ink">Informations</h2>
        {canWrite ? (
          <ContactForm
            mode="update"
            contactId={contact.id}
            version={contact.version}
            initial={{
              firstName: contact.firstName,
              lastName: contact.lastName,
              jobTitle: contact.jobTitle ?? "",
              department: contact.department ?? "",
              email: contact.email ?? "",
              phone: contact.phone ?? "",
              status: contact.status,
              preferredChannel: contact.preferredChannel ?? "",
              contactRestrictions: contact.contactRestrictions ?? "",
            }}
          />
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase text-muted">E-mail</dt><dd className="mt-1 text-ink">{contact.email ?? "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Téléphone</dt><dd className="mt-1 text-ink">{contact.phone ?? "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Responsable</dt><dd className="mt-1 text-ink">{contact.ownerName}</dd></div>
          </dl>
        )}
      </section>
    </div>
  );
}
