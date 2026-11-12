// A tiny in-memory rate limiter: at most `limit` calls per key per `windowMs`.
// It lives in one server instance's memory, so it resets on restart and isn't
// shared between Cloud Run instances. Good enough to stop casual abuse of a demo.

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return {
    allow(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Keep memory bounded: drop addresses with no recent calls, never active ones.
      if (hits.size > 10_000) {
        for (const [k, times] of hits) {
          if (!times.some((t) => now - t < windowMs)) hits.delete(k);
        }
      }
      return true;
    },
  };
}
