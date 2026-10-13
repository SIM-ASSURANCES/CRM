import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActivityForm } from "@/app/(crm)/activites/_components/activity-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { canEditActivityOf, getActivity, getLinkOptions, type ActivityDetail } from "@/features/activities/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { toDateInputValue, toDateTimeInputValue } from "@/lib/format";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Modifier une activité" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function EditActivityPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditActivityContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditActivityContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("activity:write");
  const retour = (await searchParams).retour;

  let activity: ActivityDetail;
  try {
    activity = await getActivity(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const returnTo = safeRedirectPath(typeof retour === "string" ? retour : undefined, `/comptes/${activity.accountId}`);
  // Une activité synchronisée ou automatique, ou celle d'un autre auteur, n'est pas modifiable ici.
  if (!canEditActivityOf(user, activity)) redirect(returnTo);

  const options = await getLinkOptions(user, activity.accountId);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Modifier l'activité" description={`Saisie par ${activity.authorName}.`} />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <ActivityForm
          mode="update"
          activityId={activity.id}
          version={activity.version}
          accountId={options.account.id}
          accountName={options.account.name}
          contacts={options.contacts}
          opportunities={options.opportunities}
          returnTo={returnTo}
          initial={{
            type: activity.type,
            subject: activity.subject,
            occurredAt: toDateTimeInputValue(activity.occurredAt),
            contactId: activity.contactId ?? "",
            opportunityId: activity.opportunityId ?? "",
            outcome: activity.outcome ?? "",
            nextAction: activity.nextAction ?? "",
            nextActionDate: activity.nextActionDate ? toDateInputValue(activity.nextActionDate) : "",
          }}
        />
      </div>
    </div>
  );
}
