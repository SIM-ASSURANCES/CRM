import Link from "next/link";
import type { TeamMember } from "@/features/leads/team-view";
import { cn } from "@/lib/utils";

/**
 * Sélecteur de vue du manager : l'équipe entière, ou le tableau de bord individuel de l'un de ses commerciaux.
 * De simples liens (`?membre=`) : la vue se partage par adresse et ne demande aucun JavaScript.
 */
export function MemberSwitcher({ members, selectedId }: { members: TeamMember[]; selectedId?: string }) {
  const items = [{ id: undefined, name: "Toute l'équipe", href: "/" }, ...members.map((m) => ({ ...m, href: `/?membre=${m.id}` }))];

  return (
    <nav aria-label="Vue du tableau de bord" className="mb-6 flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.id === selectedId;
        return (
          <Link
            key={item.id ?? "team"}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink-soft hover:bg-surface",
            )}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
