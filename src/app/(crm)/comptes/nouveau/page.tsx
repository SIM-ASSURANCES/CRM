import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountForm } from "@/app/(crm)/comptes/_components/account-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAssignableOwners, listParentOptions } from "@/features/accounts/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouveau compte" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function NewAccountPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewAccountContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewAccountContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("account:write");
  const parentParam = (await searchParams).parent;
  const parent = typeof parentParam === "string" ? parentParam : "";

  const [parents, owners] = await Promise.all([
    listParentOptions(user),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Nouveau compte"
        description="Recherchez d'abord le compte dans la liste pour éviter un doublon. Les champs manquants seront signalés sur la fiche."
      />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <AccountForm
          mode="create"
          parents={parents}
          owners={owners}
          // « Ajouter une filiale » depuis un groupe pré-sélectionne le parent (ignoré s'il n'est pas dans la liste).
          initial={{
            status: "prospect",
            country: "CI",
            parentAccountId: parents.some((p) => p.id === parent) ? parent : "",
            ownerUserId: owners ? user.id : "",
          }}
        />
      </div>
    </div>
  );
}
