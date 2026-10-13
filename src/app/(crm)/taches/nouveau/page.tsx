import type { Metadata } from "next";
import { Suspense } from "react";
import { TaskForm } from "@/app/(crm)/taches/_components/task-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAccountOptions, listAssignableOwners } from "@/features/accounts/service";
import { getLinkOptions } from "@/features/activities/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Nouvelle tâche" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function NewTaskPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewTaskContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewTaskContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("task:write");
  const params = await searchParams;

  const [accounts, assignees] = await Promise.all([
    listAccountOptions(user),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  // Les liens viennent d'une fiche (compte ou opportunité) : ils sont vérifiés par le serveur à l'enregistrement.
  const accountParam = first(params.compte);
  const accountId = accounts.some((a) => a.id === accountParam) ? (accountParam ?? "") : "";
  const opportunityId = first(params.opportunite) ?? "";
  const contactId = first(params.contact) ?? "";

  // Pour une tâche d'opportunité ou de contact, on affiche le dossier d'origine à la place du choix de compte.
  let linked: { account?: string; opportunity?: string; contact?: string } | undefined;
  if (accountId && (opportunityId || contactId)) {
    const options = await getLinkOptions(user, accountId).catch(() => null);
    linked = {
      account: options?.account.name,
      opportunity: options?.opportunities.find((o) => o.id === opportunityId)?.label,
      contact: options?.contacts.find((c) => c.id === contactId)?.label,
    };
  }
  const validOpportunity = linked?.opportunity ? opportunityId : "";
  const validContact = linked?.contact ? contactId : "";

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nouvelle tâche" description="Une action à mener, avec une échéance et un responsable." />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <TaskForm
          mode="create"
          accounts={accounts}
          assignees={assignees}
          linked={linked}
          hidden={{ opportunityId: validOpportunity || undefined, contactId: validContact || undefined }}
          returnTo={safeRedirectPath(first(params.retour), "/taches")}
          initial={{ priority: "normal", accountId, assigneeUserId: assignees ? user.id : "" }}
        />
      </div>
    </div>
  );
}
