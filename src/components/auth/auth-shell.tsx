import type { ReactNode } from "react";

/**
 * Cadre des pages publiques (connexion, mot de passe oublié) : fond blanc avec le motif du logo en filigrane,
 * carte centrée aux coins très arrondis, fine barre de dégradé bleu en bas de page.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-white px-4 py-10">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 800 1000"
        preserveAspectRatio="xMinYMid slice"
        className="pointer-events-none absolute inset-y-0 -left-24 h-full w-auto max-md:opacity-50"
      >
        <polygon points="170,0 440,410 355,535 150,250 70,400 0,250 0,0" fill="#F5F7FA" />
        <polygon points="0,540 150,780 300,1000 130,1000 0,780" fill="#F5F7FA" />
        <polygon points="510,540 780,1000 620,1000 440,670" fill="#F5F7FA" />
      </svg>

      <main className="relative z-10 w-full max-w-[450px] rounded-3xl border border-line bg-white p-10 shadow-[0_20px_50px_-20px_rgba(0,75,156,0.25)]">
        {children}
      </main>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-500 to-brand-700"
      />
    </div>
  );
}
