import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Assemble des classes Tailwind en résolvant les conflits (la dernière l'emporte). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** « Gohore Arnaud » → « GA ». Au plus deux lettres, jamais vide. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}
