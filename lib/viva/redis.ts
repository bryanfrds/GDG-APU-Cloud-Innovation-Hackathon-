// A tiny client for Upstash Redis over its REST API, so saved vivas live in one shared
// place instead of each server copy's own disk. No extra package: one POST per command.
//
// Reads the variables Vercel's Upstash integration sets (KV_REST_API_URL / _TOKEN), or
// Upstash's own names (UPSTASH_REDIS_REST_URL / _TOKEN). Both URL and token must be set.

export type RedisConfig = { url: string; token: string };

export function redisConfig(env: Record<string, string | undefined> = process.env): RedisConfig | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "";
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/** Runs one Redis command, e.g. ["SET", "key", "value", "NX"], and returns its result. */
export async function redisCommand(config: RedisConfig, command: string[]): Promise<unknown> {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  let body: { result?: unknown; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // fall through to the status check below
  }
  // Never put the token or the command's values in the error: they can reach logs.
  if (!res.ok || body.error) {
    throw new Error(`Redis ${command[0]} failed (${res.status}${body.error ? `: ${body.error}` : ""})`);
  }
  return body.result ?? null;
}
