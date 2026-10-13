import Link from "next/link";
import { stageLabel } from "@/features/leads/config";
import type { LeadRow } from "@/features/leads/service";
import { formatDate, formatFcfa } from "@/lib/format";
import { cn } from "@/lib/utils";

function StageBadge({ progress, status }: { progress: number; status: string }) {
  if (status === "lost") {
    return <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-danger">Perdu</span>;
  }
  const tone =
    status === "won"
      ? "bg-emerald-50 text-emerald-700"
      : progress >= 80
        ? "bg-brand-700 text-white"
        : progress > 40
          ? "bg-brand-50 text-brand-700"
          : "bg-slate-100 text-ink-soft";
  return (
    <span
      title={stageLabel(progress)}
      className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", tone)}
    >
      {progress} %
    </span>
  );
}

export function LeadsTable({
  rows,
  showOwner,
  emptyMessage,
  canWrite,
}: {
  rows: LeadRow[];
  showOwner: boolean;
  emptyMessage: string;
  canWrite: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">Liste des prospects</caption>
        <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Entreprise</th>
            <th scope="col" className="px-4 py-3 font-semibold">Contact</th>
            <th scope="col" className="px-4 py-3 font-semibold">Téléphone</th>
            <th scope="col" className="px-4 py-3 font-semibold">Inséré le</th>
            <th scope="col" className="px-4 py-3 font-semibold">Process</th>
            <th scope="col" className="px-4 py-3 font-semibold">Produit</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Chiffre d&apos;affaires</th>
            {showOwner && <th scope="col" className="px-4 py-3 font-semibold">Responsable</th>}
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((lead) => (
            <tr key={lead.id} className="hover:bg-surface/60">
              <td className="px-4 py-3">
                <p className="font-semibold text-ink">{lead.companyName}</p>
                <p className="text-xs text-muted">{lead.sector}</p>
              </td>
              <td className="px-4 py-3">
                <p className="text-ink">{lead.contactName}</p>
                <p className="text-xs text-muted">{lead.jobTitle}</p>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{lead.phone}</td>
              <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDate(lead.insertedOn)}</td>
              <td className="px-4 py-3">
                <StageBadge progress={lead.progress} status={lead.status} />
              </td>
              <td className="px-4 py-3 text-ink-soft">{lead.productLabel ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-ink">
                {lead.expectedRevenue === null ? "—" : formatFcfa(lead.expectedRevenue)}
              </td>
              {showOwner && <td className="px-4 py-3 text-ink-soft">{lead.ownerName}</td>}
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/prospects/${lead.id}`}
                  className="font-medium text-brand-700 hover:underline"
                  aria-label={`${canWrite && lead.status === "open" ? "Modifier" : "Voir"} ${lead.companyName}`}
                >
                  {canWrite && lead.status === "open" ? "Modifier" : "Voir"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
