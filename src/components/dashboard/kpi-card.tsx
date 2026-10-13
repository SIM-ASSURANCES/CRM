import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { Comparison } from "@/features/leads/kpi-math";
import { formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "up" | "down" | "flat" | "na";
export type Delta = { text: string; tone: Tone };

const COMPARED_TO = "vs semaine dernière";

/** « +15 % vs semaine dernière » ; « non calculable » si la période précédente vaut zéro (CDC 8.1). */
export function describeComparison(comparison: Comparison): Delta {
  if (comparison.pct === null) return { text: `non calculable ${COMPARED_TO}`, tone: "na" };
  const rounded = Math.round(comparison.pct);
  return {
    text: `${formatSignedPercent(comparison.pct)} ${COMPARED_TO}`,
    tone: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

/** Pour le taux de transformation, l'écart s'exprime en points de pourcentage. */
export function describePoints(pointsDiff: number | null): Delta {
  if (pointsDiff === null) return { text: `non calculable ${COMPARED_TO}`, tone: "na" };
  const rounded = Math.round(pointsDiff);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return {
    text: `${sign}${Math.abs(rounded)} pts ${COMPARED_TO}`,
    tone: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

const TONE_STYLES: Record<Tone, { className: string; Icon: LucideIcon }> = {
  up: { className: "text-emerald-700", Icon: ArrowUpRight },
  down: { className: "text-danger", Icon: ArrowDownRight },
  flat: { className: "text-muted", Icon: Minus },
  na: { className: "text-muted", Icon: Minus },
};

export function KpiCard({
  label,
  value,
  note,
  delta,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  delta: Delta;
  icon: LucideIcon;
  className?: string;
}) {
  const { className: toneClass, Icon: ToneIcon } = TONE_STYLES[delta.tone];

  return (
    <article className={cn("rounded-2xl border border-line bg-white p-5 shadow-sm", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h3 className="text-sm font-medium text-muted">{label}</h3>
      </div>
      <p className="mt-4 text-3xl font-bold text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <p className={cn("mt-3 flex items-center gap-1 text-xs font-medium", toneClass)}>
        <ToneIcon className="size-4" aria-hidden="true" />
        {delta.text}
      </p>
    </article>
  );
}
