// Squelette affiché pendant le chargement d'une page connectée (session et données lues à la requête).
// Chaque page l'utilise comme fallback de SON <Suspense> : avec cacheComponents, une navigation entre deux
// pages d'un même layout ne peut pas s'appuyer sur la frontière du layout.
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement en cours…</span>
      <div aria-hidden="true" className="h-9 w-64 animate-pulse rounded-lg bg-line" />
      <div aria-hidden="true" className="mt-3 h-4 w-48 animate-pulse rounded bg-line" />
      <div aria-hidden="true" className="mt-8 h-40 animate-pulse rounded-2xl bg-line/70" />
    </div>
  );
}
