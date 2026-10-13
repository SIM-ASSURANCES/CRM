import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { dismissRequestAction } from "@/app/(crm)/admin/demandes/actions";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listPendingResetRequests } from "@/features/users/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Demandes de réinitialisation" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ResetRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResetRequestsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetRequestsContent({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePermissionOrNotFound("user:manage");
  const params = await searchParams;
  const requests = await listPendingResetRequests(actor);

  return (
    <div>
      <PageHeader
        title="Demandes de réinitialisation"
        description="Demandes saisies depuis la page de connexion (« Mot de passe oublié »). Vérifiez l'identité de la personne avant de réinitialiser."
      />

      {params.ok === "dismissed" && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Demande ignorée.
        </p>
      )}
      {params.erreur && (
        <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          Cette demande est introuvable ou a déjà été traitée.
        </p>
      )}

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          Aucune demande en attente.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Demandes de réinitialisation en attente</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Demandée le</th>
                <th scope="col" className="px-4 py-3 font-semibold">Adresse e-mail</th>
                <th scope="col" className="px-4 py-3 font-semibold">Utilisateur</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {requests.map((request) => (
                <tr key={request.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDateTime(request.createdAt)}</td>
                  <td className="px-4 py-3 text-ink">{request.email}</td>
                  <td className="px-4 py-3 text-ink-soft">{request.userName ?? "Aucun compte correspondant"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {request.userId && (
                        <Link href={`/admin/utilisateurs/${request.userId}`} className={buttonClasses("primary")}>
                          Réinitialiser
                        </Link>
                      )}
                      <form action={dismissRequestAction}>
                        <input type="hidden" name="id" value={request.id} />
                        <button type="submit" className={buttonClasses("secondary")}>
                          Ignorer
                        </button>
                      </form>
                    </div>
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
