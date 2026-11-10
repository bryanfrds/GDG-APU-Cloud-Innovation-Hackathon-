// Tests never talk to a real Upstash database, even when its variables are set in the
// shell (for example under `kv run`). Tests that want Redis stub these back on with a fake.
for (const name of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
  delete process.env[name];
}
