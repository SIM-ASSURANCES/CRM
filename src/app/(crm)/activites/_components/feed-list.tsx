import {
  ArrowRightLeft,
  CalendarClock,
  CheckSquare,
  FileSignature,
  FileText,
  Mail,
  Phone,
  PhoneIncoming,
  StickyNote,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { activityTypeLabel, originLabel } from "@/features/activities/config";
import type { FeedItem } from "@/features/activities/service";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  call_out: Phone,
  call_in: PhoneIncoming,
  email: Mail,
  meeting: CalendarClock,
  video: Video,
  note: StickyNote,
  proposal_sent: FileText,
  contract_step: FileSignature,
  task: CheckSquare,
  stage: ArrowRightLeft,
};

const TASK_STATUS_TEXT: Record<string, string> = { open: "À faire", done: "Terminée", cancelled: "Annulée" };

type FeedListProps = {
  items: FeedItem[];
  truncated?: boolean;
  /** Masque le nom du compte quand le fil est déjà celui d'un compte. */
  hideAccount?: boolean;
  /** Chemin où revenir après une modification : conserve les filtres et la page d'origine. */
  returnTo: string;
  emptyText?: string;
};

/**
 * Fil chronologique (CDC 3.4). L'origine de chaque événement est toujours visible : saisie utilisateur,
 * synchronisation ou automatisation. Composant serveur : aucun JavaScript envoyé au navigateur.
 */
export function FeedList({ items, truncated, hideAccount, returnTo, emptyText }: FeedListProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
        {emptyText ?? "Aucune activité pour le moment."}
      </p>
    );
  }

  const editHref = (item: FeedItem) => {
    const base = item.kind === "task" ? `/taches/${item.entityId}/modifier` : `/activites/${item.entityId}/modifier`;
    return `${base}?retour=${encodeURIComponent(returnTo)}`;
  };

  return (
    <>
      <ol className="space-y-3">
        {items.map((item) => {
          const Icon = ICONS[item.type] ?? StickyNote;
          const dateText =
            item.kind === "task"
              ? item.status === "done"
                ? `Terminée le ${formatDate(item.occurredAt)}`
                : `Échéance le ${formatDate(item.occurredAt)}`
              : formatDateTime(item.occurredAt);

          return (
            <li key={item.key} className="flex gap-3 rounded-xl border border-line bg-white p-4 text-sm">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                    {activityTypeLabel(item.type)}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      item.origin === "user" ? "text-muted" : "bg-amber-50 text-amber-800",
                    )}
                  >
                    {originLabel(item.origin)}
                  </span>
                  {item.kind === "task" && item.status && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        item.overdue ? "bg-red-50 text-danger" : item.status === "done" ? "bg-emerald-50 text-emerald-800" : "bg-surface text-ink-soft",
                      )}
                    >
                      {item.overdue ? "En retard" : TASK_STATUS_TEXT[item.status]}
                    </span>
                  )}
                  <span className="text-xs text-muted">{dateText}</span>
                </div>

                <p className="font-semibold text-ink">
                  {item.title}
                  {item.editable && (
                    <Link href={editHref(item)} className="ml-3 text-xs font-medium text-brand-700 hover:underline">
                      Modifier
                    </Link>
                  )}
                </p>

                {item.detail && <p className="whitespace-pre-line text-ink-soft">{item.detail}</p>}
                {item.nextAction && (
                  <p className="text-xs text-ink-soft">
                    <strong>Prochaine action :</strong> {item.nextAction}
                    {item.nextActionDate && ` — ${formatDate(item.nextActionDate)}`}
                  </p>
                )}

                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  {item.authorName && <span>{item.kind === "task" ? "Responsable" : "Par"} {item.authorName}</span>}
                  {!hideAccount && item.accountId && (
                    <Link href={`/comptes/${item.accountId}`} className="text-brand-700 hover:underline">
                      {item.accountName}
                    </Link>
                  )}
                  {item.contactName && <span>Contact : {item.contactName}</span>}
                  {item.opportunityId && (
                    <Link href={`/opportunites/${item.opportunityId}`} className="text-brand-700 hover:underline">
                      {item.opportunityName}
                    </Link>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {truncated && (
        <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-ink">
          Seuls les événements les plus récents sont affichés : affinez les filtres pour remonter plus loin.
        </p>
      )}
    </>
  );
}
