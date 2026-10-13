import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActivityForm } from "@/app/(crm)/activites/_components/activity-form";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { SelectField } from "@/components/ui/select";
import { listAccountOptions } from "@/features/accounts/service";
import { getLinkOptions, type LinkOptions } from "@/features/activities/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { toDateTimeInputValue } from "@/lib/format";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Journaliser une activité" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function NewActivityPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewActivityContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewActivityContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("activity:write");
  const params = await searchParams;
  const accountParam = first(params.compte);

  // Étape 1 : choisir le compte (les contacts et opportunités proposés en dépendent).
  if (!accountParam) {
    const accounts = await listAccountOptions(user);
    return (
      <div className="max-w-2xl">
        <PageHeader title="Journaliser une activité" description="Choisissez d'abord le compte concerné par l'échange." />
        <form method="get" className="space-y-5 rounded-2xl border border-line bg-white p-6 md:p-8">
          <SelectField
            label="Compte"
            name="compte"
            required
            placeholder="Sélectionner…"
            options={accounts.map((a) => ({ value: a.id, label: a.label }))}
          />
          <button type="submit" className={buttonClasses("primary")}>
            Continuer
          </button>
        </form>
      </div>
    );
  }

  if (!z.uuid().safeParse(accountParam).success) notFound();

  let options: LinkOptions;
  try {
    options = await getLinkOptions(user, accountParam);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const contactParam = first(params.contact);
  const opportunityParam = first(params.opportunite);
  const returnTo = safeRedirectPath(first(params.retour), `/comptes/${accountParam}`);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Journaliser une activité" description="Appel, e-mail, rendez-vous, note… : l'historique du compte se construit ici." />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <ActivityForm
          mode="create"
          accountId={options.account.id}
          accountName={options.account.name}
          contacts={options.contacts}
          opportunities={options.opportunities}
          returnTo={returnTo}
          initial={{
            type: "call_out",
            occurredAt: toDateTimeInputValue(new Date()),
            contactId: options.contacts.some((c) => c.id === contactParam) ? (contactParam ?? "") : "",
            opportunityId: options.opportunities.some((o) => o.id === opportunityParam) ? (opportunityParam ?? "") : "",
          }}
        />
      </div>
    </div>
  );
}
