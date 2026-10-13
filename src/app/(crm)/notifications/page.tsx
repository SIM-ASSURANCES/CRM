import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { markAllReadAction, markReadAction, openNotificationAction } from "@/app/(crm)/notifications/actions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { isRuleCode, ruleLabel } from "@/features/automations/config";
import { listNotifications } from "@/features/notifications/service";
import { countPendingResetRequests } from "@/features/users/service";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NotificationsContent searchParams={searchParams} />
    </Suspense>
  );
}

/** Libellé de l'origine : le nom de la règle pour une relance automatique, sinon l'événement. */
function sourceLabel(source: string): string {
  if (isRuleCode(source)) return ruleLabel(source);
  return source === "owner_changed" ? "Changement de responsable" : source;
}

async function NotificationsContent({ searchParams }: { searchParams: SearchParams }) {
  // Tout utilisateur connecté a son centre de notifications : pas de permission dédiée, seulement les siennes.
  const user = await requireUser();
  const params = await searchParams;

  const unreadOnly = first(params.vue) === "non-lues";
  const page = Math.max(Number(first(params.page)) || 1, 1);
  const [list, pendingResets] = await Promise.all([
    listNotifications(user, { unreadOnly, page }),
    can(user.role, "user:manage") ? countPendingResetRequests() : 0,
  ]);

  const returnTo = unreadOnly ? "/notifications?vue=non-lues" : "/notifications";
  const tab = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm font-medium",
      active ? "bg-brand-700 text-white" : "border border-line bg-white text-ink hover:bg-surface",
    );

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Notifications"
        description="Tâches en retard, comptes inactifs, rendez-vous imminents et changements de responsable. Les alertes similaires sont regroupées."
        actions={
          list.unread > 0 ? (
            <form action={markAllReadAction}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" variant="secondary">
                Tout marquer comme lu
              </Button>
            </form>
          ) : undefined
        }
      />

      {pendingResets > 0 && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          <strong>{pendingResets}</strong> demande{pendingResets > 1 ? "s" : ""} de réinitialisation de mot de passe en attente.{" "}
          <Link href="/admin/demandes" className="font-medium text-brand-700 underline">
            Traiter les demandes
          </Link>
        </p>
      )}

      <nav aria-label="Filtre des notifications" className="mb-4 flex gap-2">
        <Link href="/notifications" aria-current={!unreadOnly ? "page" : undefined} className={tab(!unreadOnly)}>
          Toutes
        </Link>
        <Link href="/notifications?vue=non-lues" aria-current={unreadOnly ? "page" : undefined} className={tab(unreadOnly)}>
          Non lues
          {list.unread > 0 && <span className="ml-2 rounded-full bg-danger px-1.5 text-xs text-white">{list.unread}</span>}
        </Link>
      </nav>

      {list.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          {unreadOnly ? "Aucune notification non lue." : "Aucune notification pour le moment."}
        </div>
      ) : (
        <ul className="space-y-3">
          {list.rows.map((notification) => (
            <li
              key={notification.id}
              className={cn(
                "flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 text-sm",
                notification.read ? "border-line bg-white" : "border-brand-500/40 bg-brand-50",
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  {!notification.read && (
                    <span className="size-2 rounded-full bg-brand-700" role="img" aria-label="Non lue" />
                  )}
                  <span className="font-semibold text-ink">{notification.title}</span>
                  {notification.itemCount > 1 && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                      {notification.itemCount} éléments
                    </span>
                  )}
                </p>
                {notification.body && <p className="text-ink-soft">{notification.body}</p>}
                <p className="text-xs text-muted">
                  {sourceLabel(notification.source)} · {formatDateTime(notification.createdAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <form action={openNotificationAction}>
                  <input type="hidden" name="id" value={notification.id} />
                  <Button type="submit" aria-label={`Ouvrir : ${notification.title}`}>
                    Ouvrir
                  </Button>
                </form>
                {!notification.read && (
                  <form action={markReadAction}>
                    <input type="hidden" name="id" value={notification.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button type="submit" variant="secondary" aria-label={`Marquer comme lue : ${notification.title}`}>
                      Marquer comme lue
                    </Button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        basePath="/notifications"
        params={{ vue: unreadOnly ? "non-lues" : undefined }}
      />
    </div>
  );
}
