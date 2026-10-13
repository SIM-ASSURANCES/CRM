import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AccountForm } from "@/app/(crm)/comptes/_components/account-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { getAccount, listAssignableOwners, listParentOptions, type AccountDetail } from "@/features/accounts/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Modifier un compte" };

export default function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditAccountContent params={params} />
    </Suspense>
  );
}

async function EditAccountContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requirePermissionOrNotFound("account:write");

  let account: AccountDetail;
  try {
    account = await getAccount(user, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // Un compte archivé (fusionné) est en lecture seule.
  if (account.archivedAt) redirect(`/comptes/${id}`);

  const [parents, owners] = await Promise.all([
    listParentOptions(user, id),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Modifier ${account.legalName}`} />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <AccountForm
          mode="update"
          accountId={account.id}
          version={account.version}
          parents={parents}
          owners={owners}
          initial={{
            legalName: account.legalName,
            tradeName: account.tradeName ?? "",
            legalIdentifier: account.legalIdentifier ?? "",
            sector: account.sector ?? "",
            status: account.status,
            source: account.source ?? "",
            employeeCount: account.employeeCount === null ? "" : String(account.employeeCount),
            collectiveAgreement: account.collectiveAgreement ?? "",
            revenueAmount: account.revenueAmount === null ? "" : String(account.revenueAmount),
            revenueYear: account.revenueYear === null ? "" : String(account.revenueYear),
            revenueSource: account.revenueSource ?? "",
            addressLine: account.addressLine ?? "",
            city: account.city ?? "",
            country: account.country,
            phone: account.phone ?? "",
            emailDomain: account.emailDomain ?? "",
            parentAccountId: account.parentAccountId ?? "",
            ownerUserId: account.ownerUserId,
          }}
        />
      </div>
    </div>
  );
}
