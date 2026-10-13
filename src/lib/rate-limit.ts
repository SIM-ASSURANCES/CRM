// Limiteur de débit à fenêtre fixe, en mémoire.
// Suffisant pour une instance unique (développement, recette). En production multi-instances,
// remplacer le stockage par PostgreSQL ou Redis en gardant la même signature (voir plan, section 7).

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, remaining: options.limit - 1, retryAfterMs: 0 };
  }

  bucket.count += 1;
  if (bucket.count > options.limit) {
    return { ok: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }
  return { ok: true, remaining: options.limit - bucket.count, retryAfterMs: 0 };
}

/** Réservé aux tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
