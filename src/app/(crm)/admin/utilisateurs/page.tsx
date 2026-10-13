import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { countPendingResetRequests, listUsers, type UserRow } from "@/features/users/service";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Utilisateurs" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  updated: "Utilisateur mis à jour.",
  deactivated: "Compte désactivé : l'utilisateur est déconnecté et ne peut plus se connecter.",
  reactivated: "Compte réactivé.",
};

function StatusBadge({ user }: { user: UserRow }) {
  const [label, tone] = user.disabled
    ? ["Désactivé", "bg-red-50 text-danger"]
    : user.mustChangePassword
      ? ["Mot de passe à changer", "bg-amber-50 text-amber-800"]
      : ["Actif", "bg-emerald-50 text-emerald-700"];
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>{label}</span>;
}

export default function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function UsersContent({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePermissionOrNotFound("user:manage");
  const params = await searchParams;

  const q = first(params.q)?.trim() || undefined;
  const statusParam = first(params.statut);
  const status = statusParam === "actifs" ? "active" : statusParam === "desactives" ? "disabled" : undefined;
  const page = Math.max(Number(first(params.page)) || 1, 1);
  const flash = FLASH[first(params.ok) ?? ""];

  const [{ rows, total, pageSize }, pending] = await Promise.all([
    listUsers(actor, { q, status, page }),
    countPendingResetRequests(),
  ]);

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        description="Création des comptes, rôles, équipes, désactivation et réinitialisation des mots de passe."
        actions={
          <Link href="/admin/utilisateurs/nouveau" className={buttonClasses("primary")}>
            Nouvel utilisateur
          </Link>
        }
      />

      {pending > 0 && (
        <Link
          href="/admin/demandes"
          className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink hover:bg-amber-100"
        >
          <KeyRound className="size-5 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            <strong>{pending}</strong> demande{pending > 1 ? "s" : ""} de réinitialisation de mot de passe en attente.
            Traiter {pending > 1 ? "les demandes" : "la demande"}
          </span>
        </Link>
      )}

      {flash && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">Rechercher</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Nom ou e-mail"
            className="h-10 w-64 max-w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
          />
        </div>
        <div>
          <label htmlFor="statut" className="mb-1.5 block text-sm font-medium text-ink">Statut</label>
          <select
            id="statut"
            name="statut"
            defaultValue={statusParam ?? ""}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
          >
            <option value="">Tous</option>
            <option value="actifs">Actifs</option>
            <option value="desactives">Désactivés</option>
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          Aucun utilisateur ne correspond à cette recherche.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Liste des utilisateurs</caption>
            <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Utilisateur</th>
                <th scope="col" className="px-4 py-3 font-semibold">Rôle</th>
                <th scope="col" className="px-4 py-3 font-semibold">Équipe</th>
                <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                <th scope="col" className="px-4 py-3 font-semibold">Dernière connexion</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((user) => (
                <tr key={user.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{user.name}</p>
                    <p className="text-xs text-muted">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{ROLE_LABELS[user.role]}</td>
                  <td className="px-4 py-3 text-ink-soft">{user.teamName ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge user={user} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Jamais"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/utilisateurs/${user.id}`}
                      className="font-medium text-brand-700 hover:underline"
                      aria-label={`Gérer ${user.name}`}
                    >
                      Gérer
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/utilisateurs"
        params={{ q, statut: statusParam }}
      />
    </div>
  );
}
