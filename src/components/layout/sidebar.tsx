"use client";

import { Briefcase, ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand/brand-logo";
import { NAV_GROUPS } from "@/components/layout/nav-config";
import { can } from "@/lib/auth/permissions";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type SidebarProps = {
  role: Role;
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ role, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  // Sous 768 px la barre est toujours repliée ; le libellé est masqué par CSS (max-md).
  const hideLabel = collapsed ? "hidden" : "max-md:hidden";

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(role, item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      aria-label="Navigation principale"
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-white transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-64",
        "max-md:w-[72px]",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center bg-brand-700", collapsed ? "justify-center" : "px-5 max-md:justify-center max-md:px-0")}>
        {collapsed ? (
          <BrandLogo variant="white" compact />
        ) : (
          <>
            {/* 32 px de haut : le logotype complet (≈ 6,8 fois plus large que haut) tient alors dans les 216 px utiles. */}
            <BrandLogo variant="white" className="h-8 max-md:hidden" />
            <BrandLogo variant="white" compact className="md:hidden" />
          </>
        )}
      </div>

      <div className="m-3 flex items-center gap-3 rounded-xl bg-brand-700 px-3 py-3 text-white max-md:justify-center">
        <Briefcase className="size-5 shrink-0" aria-hidden="true" />
        <span className={cn("text-sm font-bold leading-tight", hideLabel)}>
          CRM
          <br />
          Commercial
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            <p
              className={cn(
                "mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted",
                hideLabel,
              )}
            >
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = item.match ? item.match(pathname) : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors max-md:justify-center",
                        collapsed && "justify-center",
                        active ? "bg-brand-700 text-white" : "text-ink-soft hover:bg-surface",
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span className={hideLabel}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-line p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Développer le menu" : "Réduire le menu"}
          title={collapsed ? "Développer le menu" : "Réduire le menu"}
          className={cn(
            "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface max-md:hidden",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? (
            <ChevronsRight className="size-5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronsLeft className="size-5 shrink-0" aria-hidden="true" />
          )}
          <span className={hideLabel}>Réduire</span>
        </button>

        <form action={logoutAction}>
          <button
            type="submit"
            title="Déconnexion"
            className={cn(
              "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-danger transition-colors hover:bg-red-50 max-md:justify-center",
              collapsed && "justify-center",
            )}
          >
            <LogOut className="size-5 shrink-0" aria-hidden="true" />
            <span className={hideLabel}>Déconnexion</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
