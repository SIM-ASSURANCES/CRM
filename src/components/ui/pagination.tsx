import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  /** Paramètres de l'URL à conserver (recherche, filtre « perdus »). */
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <p>
        Page {page} sur {pages} · {formatNumber(total)} résultat{total > 1 ? "s" : ""}
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={href(page - 1)} className={buttonClasses("secondary")}>
            Précédent
          </Link>
        )}
        {page < pages && (
          <Link href={href(page + 1)} className={buttonClasses("secondary")}>
            Suivant
          </Link>
        )}
      </div>
    </nav>
  );
}
