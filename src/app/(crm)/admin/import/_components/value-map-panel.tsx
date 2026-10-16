import { valueMapAction } from "@/app/(crm)/admin/import/actions";
import { Button } from "@/components/ui/button";
import type { ImportReport } from "@/features/imports/analysis";
import { formatNumber } from "@/lib/format";

type Option = { value: string; label: string };

const FIELD_LABELS = { sector: "Secteur", product: "Produit" } as const;

/**
 * Valeurs du fichier que le CRM ne reconnaît pas (« Santé privée », « Assurance auto »…). L'administrateur choisit la valeur
 * du CRM correspondante ; le lot est ré-analysé avec cette table, qui est conservée pour la suite. Rien n'est deviné.
 */
export function ValueMapPanel({
  batchId,
  unrecognized,
  sectors,
  products,
}: {
  batchId: string;
  unrecognized: ImportReport["unrecognized"];
  sectors: Option[];
  products: Option[];
}) {
  return (
    <form action={valueMapAction} className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
      <input type="hidden" name="id" value={batchId} />
      <div>
        <h3 className="text-base font-semibold text-ink">Valeurs à rapprocher</h3>
        <p className="mt-1 text-sm text-ink-soft">
          Ces valeurs du fichier ne correspondent à aucune valeur du CRM. Choisissez la valeur correspondante : les lignes concernées seront
          ré-analysées. Laissez vide pour les rejeter.
        </p>
      </div>
      <ul className="space-y-3">
        {unrecognized.map((item) => {
          const id = `vm_${item.field}_${item.key}`;
          return (
            <li key={id} className="grid items-center gap-2 sm:grid-cols-[1fr_16rem]">
              <label htmlFor={id} className="text-sm text-ink">
                <span className="font-medium">{FIELD_LABELS[item.field]}</span> : « {item.value} »
                <span className="ml-2 text-xs text-muted">{formatNumber(item.count)} ligne(s)</span>
              </label>
              <select
                id={id}
                name={id}
                defaultValue=""
                className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
              >
                <option value="">— Rejeter —</option>
                {(item.field === "sector" ? sectors : products).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <Button type="submit" variant="secondary">
        Appliquer et ré-analyser
      </Button>
    </form>
  );
}
