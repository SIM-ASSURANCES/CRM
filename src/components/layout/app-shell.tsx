"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { useSidebarCollapsed } from "@/components/layout/use-sidebar-collapsed";
import type { Role } from "@/lib/auth/roles";

type AppShellProps = {
  user: { name: string; email: string; role: Role };
  /** Demandes de réinitialisation de mot de passe en attente (administrateurs uniquement). */
  pendingResetRequests?: number;
  /** Notifications non lues de l'utilisateur (centre de notifications). */
  unreadNotifications?: number;
  children: ReactNode;
};

/** Gabarit des pages connectées : barre latérale repliable + en-tête + zone de contenu. */
export function AppShell({ user, pendingResetRequests = 0, unreadNotifications = 0, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const total = pendingResetRequests + unreadNotifications;
  const parts = [
    unreadNotifications > 0 && `${unreadNotifications} notification${unreadNotifications > 1 ? "s" : ""} non lue${unreadNotifications > 1 ? "s" : ""}`,
    pendingResetRequests > 0 &&
      `${pendingResetRequests} demande${pendingResetRequests > 1 ? "s" : ""} de réinitialisation de mot de passe en attente`,
  ].filter(Boolean);

  return (
    <div className="flex h-dvh bg-surface">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Aller au contenu
      </a>
      <Sidebar role={user.role} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          notification={{ count: total, href: "/notifications", label: parts.length > 0 ? parts.join(", ") : "Aucune notification" }}
        />
        <main id="contenu" className="flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
