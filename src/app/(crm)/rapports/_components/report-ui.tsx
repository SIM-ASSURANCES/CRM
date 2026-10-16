import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { KPI_DEFINITIONS, type ReportKind } from "@/features/reporting/config";
import type { Attainment } from "@/features/reporting/rules";
import { formatFcfa } from "@/lib/format";
import { cn } from "@/lib/utils";

// Éléments d'affichage communs aux rapports. Aucun calcul : les chiffres arrivent tels que le service les a produits.

export function Tile({
  label,
  value,
  note,
  tone = "default",
  compact = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "default" | "good" | "bad";
  /** Chiffre à 14 px (page des prévisions) au lieu du grand format par défaut. */
  compact?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h3 className="text-sm font-medium text-muted">{label}</h3>
      <p
        className={cn(
          "mt-2 font-bold",
          compact ? "text-[14px]" : "text-2xl",
          tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-danger" : "text-ink",
        )}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </article>
  );
}

/** +1 234 FCFA / −1 234 FCFA : l'écart garde son signe, jamais un « 0 » trompeur. */
export function signedFcfa(value: number): string {
  if (Math.round(value) === 0) return formatFcfa(0);
  return `${value > 0 ? "+" : "−"}${formatFcfa(Math.abs(value))}`;
}

/** « non calculable » quand l'objectif est nul ou absent (CDC 8.1), jamais un pourcentage trompeur. */
export function rateLabel(rate: number | null): string {
  return rate === null ? "non calculable" : `${String(rate).replace(".", ",")} %`;
}

export function GapCells({ attainment }: { attainment: Attainment | null | undefined }) {
  if (!attainment) {
    return (
      <>
        <td className="px-4 py-3 text-right text-muted">—</td>
        <td className="px-4 py-3 text-right text-muted">—</td>
        <td className="px-4 py-3 text-right text-muted">—</td>
      </>
    );
  }
  return (
    <>
      <td className="px-4 py-3 text-right text-ink-soft">{formatFcfa(attainment.target)}</td>
      <td className={cn("px-4 py-3 text-right font-medium", attainment.gap < 0 ? "text-danger" : "text-emerald-700")}>{signedFcfa(attainment.gap)}</td>
      <td className={cn("px-4 py-3 text-right", attainment.rate === null ? "text-muted" : "text-ink-soft")}>{rateLabel(attainment.rate)}</td>
    </>
  );
}

export const TH = "px-4 py-3 font-semibold";

/** Filtres d'un rapport : une requête GET, donc une adresse partageable ; la période est toujours proposée. */
export function ReportFilters({ action, from, to, children }: { action: string; from: string; to: string; children?: ReactNode }) {
  const input = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30";
  return (
    <form method="get" action={action} className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label htmlFor="du" className="mb-1.5 block text-sm font-medium text-ink">
          Du (mois)
        </label>
        <input id="du" name="du" type="month" defaultValue={from} required pattern="\d{4}-\d{2}" className={input} />
      </div>
      <div>
        <label htmlFor="au" className="mb-1.5 block text-sm font-medium text-ink">
          Au (mois)
        </label>
        <input id="au" name="au" type="month" defaultValue={to} required pattern="\d{4}-\d{2}" className={input} />
      </div>
      {children}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={buttonClasses("primary")}>
          Appliquer
        </button>
        <a href={action} className={buttonClasses("secondary")}>
          Réinitialiser
        </a>
      </div>
    </form>
  );
}

/** Exports CSV et Excel du rapport affiché, avec les MÊMES filtres que l'écran (REC-10). */
export function ExportLinks({ report, query }: { report: ReportKind; query: URLSearchParams }) {
  const href = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(query);
    params.set("report", report);
    params.set("format", format);
    return `/api/reports/export?${params.toString()}`;
  };
  return (
    <div className="flex flex-wrap gap-2">
      <a href={href("csv")} className={buttonClasses("secondary")}>
        Exporter en CSV
      </a>
      <a href={href("xlsx")} className={buttonClasses("secondary")}>
        Exporter en Excel
      </a>
    </div>
  );
}

/** Dictionnaire des KPI : la même source que l'onglet « Définitions » des exports. */
export function KpiDictionary({ only }: { only?: readonly string[] }) {
  const items = KPI_DEFINITIONS.filter((kpi) => !only || only.includes(kpi.code));
  return (
    <details className="rounded-2xl border border-line bg-white p-5 text-sm">
      <summary className="cursor-pointer font-semibold text-ink">Définitions des indicateurs</summary>
      <dl className="mt-3 space-y-3">
        {items.map((kpi) => (
          <div key={kpi.code}>
            <dt className="font-medium text-ink">{kpi.label}</dt>
            <dd className="text-ink-soft">{kpi.definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
