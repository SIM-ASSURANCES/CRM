"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { initials } from "@/lib/utils";

type UserMenuProps = {
  name: string;
  email: string;
  role: Role;
};

export function UserMenu({ name, email, role }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu utilisateur : ${name}`}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white"
        >
          {initials(name)}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-bold text-ink">{name}</span>
          <span className="block truncate text-xs text-muted">{email}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-line bg-white p-2 shadow-lg"
        >
          <div className="border-b border-line px-3 pb-2 pt-1">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="text-xs text-muted">{ROLE_LABELS[role]}</p>
          </div>
          <Link
            href="/change-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            Changer mon mot de passe
          </Link>
        </div>
      )}
    </div>
  );
}
