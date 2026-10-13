import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { DeleteTeamControl, TeamForm } from "@/app/(crm)/admin/equipes/_components/team-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { getTeam, listManagers, type TeamRow } from "@/features/users/teams";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Modifier une équipe" };

export default function EditTeamPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditTeamContent params={params} />
    </Suspense>
  );
}

async function EditTeamContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const actor = await requirePermissionOrNotFound("user:manage");

  let team: TeamRow;
  try {
    team = await getTeam(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const managers = await listManagers(actor);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={team.name} description={`${team.memberCount} membre${team.memberCount > 1 ? "s" : ""}`} />

      <section className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <TeamForm
          mode="update"
          teamId={team.id}
          managers={managers}
          initial={{ name: team.name, managerUserId: team.managerUserId ?? "" }}
        />
      </section>

      <section className="rounded-2xl border border-line bg-white p-6 md:p-8" aria-labelledby="suppression">
        <h2 id="suppression" className="mb-2 text-lg font-semibold text-ink">Suppression</h2>
        <p className="mb-4 text-sm text-muted">
          {team.memberCount > 0
            ? "Cette équipe a encore des membres : retirez-les (depuis leur fiche) avant de pouvoir la supprimer."
            : "Cette équipe n'a aucun membre : elle peut être supprimée."}
        </p>
        <DeleteTeamControl teamId={team.id} teamName={team.name} />
      </section>
    </div>
  );
}
