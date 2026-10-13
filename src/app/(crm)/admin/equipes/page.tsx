import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TeamForm } from "@/app/(crm)/admin/equipes/_components/team-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listManagers, listTeams } from "@/features/users/teams";
import { requirePermissionOrNotFound } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Équipes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FLASH: Record<string, string> = {
  created: "Équipe créée.",
  updated: "Équipe mise à jour.",
  deleted: "Équipe supprimée.",
};

export default function TeamsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TeamsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function TeamsContent({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePermissionOrNotFound("user:manage");
  const ok = (await searchParams).ok;
  const flash = typeof ok === "string" ? FLASH[ok] : undefined;
  const [teams, managers] = await Promise.all([listTeams(actor), listManagers(actor)]);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Équipes"
        description="Un manager voit les prospects de son équipe. Affectez les utilisateurs à une équipe depuis leur fiche."
      />

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}

      <section className="rounded-2xl border border-line bg-white p-6 md:p-8" aria-labelledby="nouvelle">
        <h2 id="nouvelle" className="mb-5 text-lg font-semibold text-ink">Nouvelle équipe</h2>
        <TeamForm mode="create" managers={managers} initial={{}} />
      </section>

      {teams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          Aucune équipe pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Liste des équipes</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Équipe</th>
                <th scope="col" className="px-4 py-3 font-semibold">Responsable</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Membres</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="px-4 py-3 font-semibold text-ink">{team.name}</td>
                  <td className="px-4 py-3 text-ink-soft">{team.managerName ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-ink-soft">{team.memberCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/equipes/${team.id}`}
                      className="font-medium text-brand-700 hover:underline"
                      aria-label={`Modifier l'équipe ${team.name}`}
                    >
                      Modifier
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
