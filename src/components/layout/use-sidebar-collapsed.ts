"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "crm.sidebar.collapsed";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Côté serveur et à l'hydratation : barre développée (valeur par défaut).
function getServerSnapshot(): boolean {
  return false;
}

/** État « barre latérale repliée », mémorisé dans le navigateur de l'utilisateur. */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCollapsed = useCallback((value: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Stockage indisponible (navigation privée) : le repli ne sera pas mémorisé.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [collapsed, setCollapsed] as const;
}
