import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { saveTargetsAction } from "@/app/(crm)/admin/objectifs/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { periodLabel } from "@/features/reporting/rules";
import { getTargetGrid } from "@/features/reporting/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatFcfa } from "@/lib/format";

export const metadata: Metadata = { title: "Objectifs commerciaux" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const ERRORS: Record<string, string> = {
  acces: "Vous n'avez pas accès à cette action.",
  perimetre: "Vous ne pouvez pas fixer les objectifs de cet utilisateur.",
  invalide: "Montant invalide : saisissez un nombre positif ou nul (exemple : 1 500 000).",
  echec: "Les objectifs n'ont pas pu être enregistrés. Réessayez dans un instant.",
};

export default function TargetsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TargetsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function TargetsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("target:manage");
  const params = await searchParams;
  const requested = Number(first(params.annee));
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : new Date().getUTCFullYear();
  const grid = await getTargetGrid(user, year);

  const error = first(params.erreur);
  const saved = first(params.ok) === "saved";

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Objectifs commerciaux"
        description="Un objectif par commercial et par mois, en FCFA annualisés. Les objectifs d'un trimestre, d'une année ou d'une équipe sont la somme de leurs mois : ils ne se saisissent jamais à part."
        actions={
          <div className="flex gap-2">
            <Link href={`/admin/objectifs?annee=${year - 1}`} className={buttonClasses("secondary")}>
              ← {year - 1}
            </Link>
            <Link href={`/admin/objectifs?annee=${year + 1}`} className={buttonClasses("secondary")}>
              {year + 1} →
            </Link>
          </div>
        }
      />

      {saved && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Objectifs enregistrés.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {ERRORS[error] ?? "L'opération n'a pas pu être effectuée."}
        </p>
      )}

      <h2 className="text-xl font-semibold text-ink">Année {year}</h2>

      {grid.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">Aucun commercial dans votre périmètre.</div>
      ) : (
        grid.rows.map((row) => {
          const total = grid.monthKeys.reduce((sum, month) => sum + row.months[month], 0);
          return (
            <form key={row.userId} action={saveTargetsAction} className="space-y-4 rounded-2xl border border-line bg-white p-5">
              <input type="hidden" name="ownerUserId" value={row.userId} />
              <input type="hidden" name="year" value={year} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-ink">
                  {row.name}
                  {row.teamName && <span className="ml-2 text-sm font-normal text-muted">{row.teamName}</span>}
                </h3>
                <p className="text-sm text-ink-soft">
                  Total {year} : <strong>{formatFcfa(total)}</strong>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {grid.monthKeys.map((month) => {
                  const id = `${row.userId}-${month}`;
                  return (
                    <div key={month}>
                      <label htmlFor={id} className="mb-1 block text-xs font-medium capitalize text-muted">
                        {periodLabel(month).split(" ")[0]}
                      </label>
                      <input
                        id={id}
                        name={`m${month.slice(5)}`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        defaultValue={row.months[month] > 0 ? String(row.months[month]) : ""}
                        placeholder="0"
                        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-right text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
                      />
                    </div>
                  );
                })}
              </div>
              <Button type="submit" aria-label={`Enregistrer les objectifs ${year} de ${row.name}`}>
                Enregistrer
              </Button>
            </form>
          );
        })
      )}
    </div>
  );
}
