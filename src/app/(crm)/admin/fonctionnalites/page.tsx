import type { Metadata } from "next";
import { Suspense } from "react";
import { setFeatureAction } from "@/app/(crm)/admin/fonctionnalites/actions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import type { FeatureGroup } from "@/features/modules/config";
import { listFeatureStates } from "@/features/modules/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Fonctionnalités" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  active: "Fonctionnalité activée pour tous les utilisateurs.",
  desactive: "Fonctionnalité désactivée pour tous les utilisateurs.",
  inchange: "Aucun changement : la fonctionnalité était déjà dans cet état.",
};

const GROUPS: FeatureGroup[] = ["Clients", "Suivi", "Prospects", "Reporting"];

export default function FeaturesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FeaturesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function FeaturesContent({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePermissionOrNotFound("settings:manage");
  const params = await searchParams;
  const features = await listFeatureStates(actor);

  const flashKey = first(params.ok);
  const flash = flashKey ? FLASH[flashKey] : undefined;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Fonctionnalités"
        description="Activez ou désactivez une fonctionnalité pour tous les utilisateurs du CRM. Le changement est immédiat : l'entrée disparaît du menu et l'écran répond « page introuvable ». Les données sont conservées."
      />

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}
      {params.erreur && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          L&apos;opération n&apos;a pas pu être effectuée.
        </p>
      )}

      <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink-soft">
        Le tableau de bord et l&apos;administration (utilisateurs, équipes, objectifs, automatisations, import, audit et cet écran)
        restent toujours disponibles.
      </p>

      {GROUPS.map((group) => {
        const items = features.filter((feature) => feature.group === group);
        if (items.length === 0) return null;
        const headingId = `groupe-${group.toLowerCase()}`;
        return (
          <section key={group} aria-labelledby={headingId} className="space-y-3">
            <h2 id={headingId} className="text-lg font-semibold text-ink">{group}</h2>
            <ul className="space-y-3">
              {items.map((feature) => (
                <li
                  key={feature.key}
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {feature.label}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          feature.enabled ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-danger",
                        )}
                      >
                        {feature.enabled ? "Activée" : "Désactivée"}
                      </span>
                    </p>
                    <p className="text-sm text-ink-soft">{feature.description}</p>
                    <p className="text-xs text-muted">Écrans : {feature.screens.join(", ")}</p>
                  </div>
                  <form action={setFeatureAction} className="shrink-0">
                    <input type="hidden" name="key" value={feature.key} />
                    <input type="hidden" name="enabled" value={feature.enabled ? "false" : "true"} />
                    <Button type="submit" variant={feature.enabled ? "secondary" : "primary"}>
                      {feature.enabled ? "Désactiver" : "Activer"}
                      <span className="sr-only"> {feature.label}</span>
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
