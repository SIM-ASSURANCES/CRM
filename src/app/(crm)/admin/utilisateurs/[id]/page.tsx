import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { UserForm } from "@/app/(crm)/admin/utilisateurs/_components/user-form";
import { ResetPasswordControl, ToggleActiveControl } from "@/app/(crm)/admin/utilisateurs/_components/user-actions";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { getUser, type UserDetail } from "@/features/users/service";
import { listTeamOptions } from "@/features/users/teams";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Gérer un utilisateur" };

const FLASH: Record<string, string> = {
  updated: "Modifications enregistrées.",
  deactivated: "Compte désactivé : l'utilisateur est déconnecté et ne peut plus se connecter.",
  reactivated: "Compte réactivé.",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ManageUserPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ManageUserContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ManageUserContent({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const actor = await requirePermissionOrNotFound("user:manage");
  const flashKey = (await searchParams).ok;
  const flash = typeof flashKey === "string" ? FLASH[flashKey] : undefined;

  let user: UserDetail;
  try {
    user = await getUser(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const teams = await listTeamOptions(actor);
  const isSelf = actor.id === user.id;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={user.name} description={user.email} />

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}

      {user.pendingResetRequest && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          Cet utilisateur a demandé la réinitialisation de son mot de passe. Elle sera marquée comme traitée dès que
          vous l&apos;aurez effectuée.
        </p>
      )}

      <section className="rounded-2xl border border-line bg-white p-6 md:p-8" aria-labelledby="infos">
        <h2 id="infos" className="mb-5 text-lg font-semibold text-ink">Informations</h2>
        <UserForm
          mode="update"
          userId={user.id}
          isSelf={isSelf}
          teams={teams}
          initial={{ name: user.name, email: user.email, role: user.role, teamId: user.teamId ?? "" }}
        />
      </section>

      <section className="rounded-2xl border border-line bg-white p-6 md:p-8" aria-labelledby="acces">
        <h2 id="acces" className="mb-5 text-lg font-semibold text-ink">Accès</h2>
        <dl className="mb-6 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Statut</dt>
            <dd className="mt-1 text-ink">
              {user.disabled ? "Désactivé" : user.mustChangePassword ? "Mot de passe à changer" : "Actif"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Dernière connexion</dt>
            <dd className="mt-1 text-ink">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Jamais"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Compte créé le</dt>
            <dd className="mt-1 text-ink">{formatDateTime(user.createdAt)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-start gap-6">
          <ResetPasswordControl
            userId={user.id}
            userName={user.name}
            disabledReason={
              isSelf
                ? "Pour votre propre compte, utilisez « Changer mon mot de passe » dans le menu utilisateur."
                : user.disabled
                  ? "Réactivez le compte avant de réinitialiser son mot de passe."
                  : undefined
            }
          />
          <ToggleActiveControl
            userId={user.id}
            userName={user.name}
            active={!user.disabled}
            disabledReason={isSelf ? "Vous ne pouvez pas désactiver votre propre compte." : undefined}
          />
        </div>
      </section>
    </div>
  );
}
