import type { ColumnKind, SourceProfile } from "@/features/imports/profile";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<ColumnKind, string> = {
  empty: "Vide",
  number: "Nombre",
  date: "Date",
  email: "E-mail",
  phone: "Téléphone",
  text: "Texte",
};

/**
 * Inventaire de la source (phase 7) : ce que contient le fichier, calculé au dépôt. Aide à décider de l'association des
 * colonnes et à repérer d'emblée les colonnes vides, les lignes en double et les valeurs à normaliser.
 */
export function InventoryPanel({ profile, open }: { profile: SourceProfile; open?: boolean }) {
  return (
    <details open={open} className="rounded-2xl border border-line bg-white p-5">
      <summary className="cursor-pointer text-base font-semibold text-ink">Inventaire de la source</summary>
      <p className="mt-2 text-sm text-ink-soft">
        {formatNumber(profile.rows)} ligne(s) · {profile.columns.length} colonne(s)
        {profile.duplicateRows > 0 && (
          <>
            {" · "}
            <strong className="text-amber-700">{formatNumber(profile.duplicateRows)} ligne(s) strictement identique(s) à une ligne précédente</strong>
          </>
        )}
        .
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">Contenu de chaque colonne du fichier</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="py-2 pr-4 font-semibold">Colonne</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">Renseignée</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">Valeurs distinctes</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Type probable</th>
              <th scope="col" className="py-2 font-semibold">Valeurs fréquentes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {profile.columns.map((column) => {
              const rate = profile.rows > 0 ? Math.round((column.filled / profile.rows) * 100) : 0;
              return (
                <tr key={column.header} className="align-top">
                  <th scope="row" className="py-2 pr-4 font-medium text-ink">{column.header}</th>
                  <td className={cn("py-2 pr-4 text-right", rate < 50 ? "font-semibold text-amber-700" : "text-ink-soft")}>
                    {rate} % ({formatNumber(column.filled)})
                  </td>
                  <td className="py-2 pr-4 text-right text-ink-soft">{formatNumber(column.distinct)}</td>
                  <td className="py-2 pr-4 text-ink-soft">{KIND_LABELS[column.kind]}</td>
                  <td className="py-2 text-ink-soft">{column.top.map((entry) => `${entry.value} (${entry.count})`).join(" · ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
