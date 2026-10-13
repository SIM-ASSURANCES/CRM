import type { Metadata } from "next";
import { Suspense } from "react";
import { UserForm } from "@/app/(crm)/admin/utilisateurs/_components/user-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listTeamOptions } from "@/features/users/teams";
import { requirePermissionOrNotFound } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouvel utilisateur" };

export default function NewUserPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewUserContent />
    </Suspense>
  );
}

async function NewUserContent() {
  const actor = await requirePermissionOrNotFound("user:manage");
  const teams = await listTeamOptions(actor);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Nouvel utilisateur"
        description="Le compte est créé avec un mot de passe temporaire que vous transmettez à l'utilisateur."
      />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <UserForm mode="create" teams={teams} initial={{ role: "commercial" }} />
      </div>
    </div>
  );
}
