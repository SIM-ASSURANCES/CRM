import { Bell } from "lucide-react";
import Link from "next/link";
import { UserMenu } from "@/components/layout/user-menu";
import type { Role } from "@/lib/auth/roles";

type HeaderProps = {
  user: { name: string; email: string; role: Role };
  /**
   * Notifications à signaler sur la cloche. Aujourd'hui : demandes de réinitialisation de mot de passe en attente
   * (administrateurs). Le centre de notifications complet viendra au sprint 4.5.
   */
  notification?: { count: number; href: string; label: string };
};

const BELL_CLASSES =
  "relative flex size-10 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-500";

export function Header({ user, notification }: HeaderProps) {
  const count = notification?.count ?? 0;
  const icon = <Bell className="size-5" aria-hidden="true" />;
  const badge = count > 0 && (
    <span
      aria-hidden="true"
      className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-5 text-white"
    >
      {count > 9 ? "9+" : count}
    </span>
  );

  return (
    <header className="flex h-16 shrink-0 items-center justify-end gap-4 border-b border-line bg-white px-6">
      {notification && count > 0 ? (
        <Link
          href={notification.href}
          title={notification.label}
          aria-label={`Notifications : ${notification.label}`}
          className={BELL_CLASSES}
        >
          {icon}
          {badge}
        </Link>
      ) : (
        <button type="button" title="Aucune notification" aria-label="Notifications : aucune" className={BELL_CLASSES}>
          {icon}
        </button>
      )}

      <UserMenu name={user.name} email={user.email} role={user.role} />
    </header>
  );
}
