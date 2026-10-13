import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FeedList } from "@/app/(crm)/activites/_components/feed-list";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { listAssignableOwners } from "@/features/accounts/service";
import { ACTIVITY_TYPES, FEED_EXTRA_TYPES } from "@/features/activities/config";
import { feedFiltersSchema } from "@/features/activities/schemas";
import { listFeed } from "@/features/activities/service";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { toDateInputValue } from "@/lib/format";

export const metadata: Metadata = { title: "Activités" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  activity_added: "Activité enregistrée.",
  activity_updated: "Activité modifiée.",
  task_created: "Tâche créée.",
  task_updated: "Tâche modifiée.",
};

export default function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ActivitiesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ActivitiesContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("activity:read");
  const params = await searchParams;

  // Une valeur de filtre invalide (adresse modifiée à la main) est ignorée : le fil s'affiche sans filtre.
  const parsed = feedFiltersSchema.safeParse({
    type: first(params.type),
    from: first(params.du),
    to: first(params.au),
    authorId: first(params.auteur),
    accountId: first(params.compte),
    opportunityId: first(params.opportunite),
    contactId: first(params.contact),
  });
  const filters = parsed.success ? parsed.data : {};

  const canWrite = can(user.role, "activity:write");
  const [feed, authors] = await Promise.all([
    listFeed(user, filters),
    can(user.role, "account:assign") ? listAssignableOwners(user) : undefined,
  ]);

  // Chemin de retour : conserve les filtres actifs après une modification.
  const keep = new URLSearchParams();
  for (const key of ["type", "du", "au", "auteur", "compte", "opportunite", "contact"]) {
    const value = first(params[key]);
    if (value) keep.set(key, value);
  }
  const returnTo = keep.size > 0 ? `/activites?${keep.toString()}` : "/activites";

  const flashKey = first(params.ok);
  const flash = flashKey ? FLASH[flashKey] : undefined;
  const newHref = filters.accountId ? `/activites/nouveau?compte=${filters.accountId}` : "/activites/nouveau";

  const select = "h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink";

  return (
    <div>
      <PageHeader
        title="Activités"
        description="Fil chronologique des appels, e-mails, rendez-vous, notes, tâches et changements d'étape, avec l'origine de chaque événement."
        actions={
          canWrite ? (
            <Link href={newHref} className={buttonClasses("primary")}>
              Journaliser une activité
            </Link>
          ) : undefined
        }
      />

      {flash && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}

      <form method="get" role="search" className="mb-6 flex flex-wrap items-end gap-3">
        {/* Les filtres d'objet (compte, opportunité, contact) viennent des fiches : on les conserve. */}
        {filters.accountId && <input type="hidden" name="compte" value={filters.accountId} />}
        {filters.opportunityId && <input type="hidden" name="opportunite" value={filters.opportunityId} />}
        {filters.contactId && <input type="hidden" name="contact" value={filters.contactId} />}
        <div>
          <label htmlFor="type" className="mb-1.5 block text-sm font-medium text-ink">Type</label>
          <select id="type" name="type" defaultValue={filters.type ?? ""} className={select}>
            <option value="">Tous</option>
            {[...ACTIVITY_TYPES, ...FEED_EXTRA_TYPES].map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="du" className="mb-1.5 block text-sm font-medium text-ink">Du</label>
          <input id="du" name="du" type="date" defaultValue={filters.from ? toDateInputValue(filters.from) : ""} className={select} />
        </div>
        <div>
          <label htmlFor="au" className="mb-1.5 block text-sm font-medium text-ink">Au</label>
          <input id="au" name="au" type="date" defaultValue={filters.to ? toDateInputValue(filters.to) : ""} className={select} />
        </div>
        {authors && (
          <div>
            <label htmlFor="auteur" className="mb-1.5 block text-sm font-medium text-ink">Auteur</label>
            <select id="auteur" name="auteur" defaultValue={filters.authorId ?? ""} className={select}>
              <option value="">Tous</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className={buttonClasses("secondary")}>Filtrer</button>
        {keep.size > 0 && (
          <Link href="/activites" className="pb-2 text-sm font-medium text-brand-700 hover:underline">
            Réinitialiser
          </Link>
        )}
      </form>

      <FeedList
        items={feed.items}
        truncated={feed.truncated}
        returnTo={returnTo}
        hideAccount={Boolean(filters.accountId)}
        emptyText={keep.size > 0 ? "Aucun événement ne correspond à ces filtres." : "Aucune activité pour le moment."}
      />
    </div>
  );
}
