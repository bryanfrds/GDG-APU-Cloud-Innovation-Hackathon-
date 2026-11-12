import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PLAN } from "@/lib/viva/plan";
import { buildRecord, type VivaRecord } from "@/lib/viva/record";
import { getRecord, newVivaId, saveSession } from "@/lib/viva/store";
import { appendText, EMPTY_TRANSCRIPT } from "@/lib/viva/transcript";

let dir = "";
const ISSUED = Date.parse("2026-11-05T10:00:00Z");

async function loadRoute() {
  vi.resetModules(); // fresh rate limiter for each test
  return import("./route");
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/viva/records", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Starts a viva the way the token route does, and builds the record the page would send. */
async function startedViva(overrides: Partial<Parameters<typeof buildRecord>[0]> = {}): Promise<VivaRecord> {
  const vivaId = newVivaId();
  await saveSession({ vivaId, plan: SAMPLE_PLAN, mode: "demo", issuedAt: new Date(ISSUED).toISOString() });
  return buildRecord({
    vivaId,
    mode: "demo",
    plan: SAMPLE_PLAN,
    startedAt: ISSUED + 5_000,
    endedAt: ISSUED + 35_000,
    endReason: "completed",
    transcript: appendText(EMPTY_TRANSCRIPT, "ai", "Which algorithm did you use?", { questionId: "q1", atMs: 1000 }),
    ...overrides,
  });
}

describe("POST /api/viva/records", () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "viva-records-"));
    vi.stubEnv("VIVA_DATA_DIR", dir);
    vi.stubEnv("DEMO_PASSCODE", "");
    vi.useFakeTimers({ now: ISSUED + 40_000, toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves a record for a viva this server started", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    const res = await POST(post(record));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, vivaId: record.vivaId });
    expect(await getRecord(record.vivaId)).toMatchObject({ ...record, receivedAt: expect.any(String) });
  });

  it("treats an identical retry as success, but refuses a different record for the same viva", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    expect((await POST(post(record))).status).toBe(201);
    const retry = await POST(post(record));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, vivaId: record.vivaId, alreadySaved: true });
    const changed = await POST(post({ ...record, endReason: "stopped" }));
    expect(changed.status).toBe(409);
    expect((await changed.json()).error).toMatch(/already been saved/);
  });

  it("only saves a record under the submission its viva was started for", async () => {
    const { POST } = await loadRoute();
    const vivaId = newVivaId();
    await saveSession({ vivaId, submissionId: "sub_aaaaaaaaaaaaaaaaaaaa", plan: SAMPLE_PLAN, mode: "demo", issuedAt: new Date(ISSUED).toISOString() });
    const base = {
      vivaId, mode: "demo" as const, plan: SAMPLE_PLAN, startedAt: ISSUED + 5_000, endedAt: ISSUED + 35_000,
      endReason: "completed" as const, transcript: EMPTY_TRANSCRIPT,
    };
    expect((await POST(post(buildRecord({ ...base, submissionId: "sub_bbbbbbbbbbbbbbbbbbbb" })))).status).toBe(409);
    expect((await POST(post(buildRecord(base)))).status).toBe(409);
    expect((await POST(post(buildRecord({ ...base, submissionId: "sub_aaaaaaaaaaaaaaaaaaaa" })))).status).toBe(201);
  });

  it("refuses a record that names a submission when its viva had none", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva({ submissionId: "sub_cccccccccccccccccccc" });
    expect((await POST(post(record))).status).toBe(409);
  });

  it("refuses a viva this server never started", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    const res = await POST(post({ ...record, vivaId: newVivaId() }));
    expect(res.status).toBe(404);
  });

  it("refuses a record whose questions were changed in the browser", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    const easier = { ...record, plan: { ...record.plan, questions: [{ id: "q1", text: "What is 1 + 1?" }] } };
    const res = await POST(post({ ...easier, turns: [] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/doesn't match the viva/);
  });

  it("refuses a record that claims a different mode", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    expect((await POST(post({ ...record, mode: "full" }))).status).toBe(409);
  });

  // The pass for a demo viva: issued at ISSUED, must connect within 1 min, runs 30 s,
  // then 2 min grace. Each limit allows CLOCK_SLACK_MS (10 min) for the browser's clock.
  const MIN = 60_000;
  const SLACK = 10 * MIN;
  const LATEST_START = 1 * MIN + SLACK;
  const LATEST_END = 1 * MIN + 30_000 + 2 * MIN + SLACK;

  it("accepts a start just inside the clock slack before the pass was issued", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva({ startedAt: ISSUED - SLACK + 1000, endedAt: ISSUED - SLACK + 21_000 });
    expect((await POST(post(record))).status).toBe(201);
  });

  it("refuses a viva that started before its pass was issued", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva({ startedAt: ISSUED - SLACK - 1000, endedAt: ISSUED - SLACK + 19_000 });
    const res = await POST(post(record));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/start time/);
  });

  it("accepts a start just before the latest allowed start", async () => {
    vi.setSystemTime(ISSUED + LATEST_START + MIN);
    const { POST } = await loadRoute();
    const record = await startedViva({ startedAt: ISSUED + LATEST_START - 1000, endedAt: ISSUED + LATEST_START });
    expect((await POST(post(record))).status).toBe(201);
  });

  it("refuses a viva that started after its pass's connect window (start check alone)", async () => {
    vi.setSystemTime(ISSUED + LATEST_START + MIN);
    const { POST } = await loadRoute();
    // Ends well before the latest allowed end, so only the start check can refuse it.
    const record = await startedViva({ startedAt: ISSUED + LATEST_START + 1000, endedAt: ISSUED + LATEST_START + 2000 });
    expect(Date.parse(record.endedAt)).toBeLessThan(ISSUED + LATEST_END);
    const res = await POST(post(record));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/start time/);
  });

  it("accepts an end just before the latest allowed end", async () => {
    vi.setSystemTime(ISSUED + LATEST_END + MIN);
    const { POST } = await loadRoute();
    const record = await startedViva({ startedAt: ISSUED + LATEST_START - 1000, endedAt: ISSUED + LATEST_END - 1000 });
    expect((await POST(post(record))).status).toBe(201);
  });

  it("refuses a viva that ended later than its pass allowed (end check alone)", async () => {
    vi.setSystemTime(ISSUED + LATEST_END + MIN);
    const { POST } = await loadRoute();
    // Starts inside the window, so only the end check can refuse it.
    const record = await startedViva({ startedAt: ISSUED + LATEST_START - 1000, endedAt: ISSUED + LATEST_END + 1000 });
    expect(Date.parse(record.endedAt)).toBe(ISSUED + LATEST_END + 1000); // not capped by buildRecord
    const res = await POST(post(record));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ended later/);
  });

  it("rejects a record that fails the format checks", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    const res = await POST(post({ ...record, endReason: "exploded" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown end reason." });
  });

  it("rejects broken JSON, and a body that isn't an object", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post("[1,2]"))).status).toBe(400);
  });

  it("refuses a body over 2 MB", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post({ padding: "x".repeat(2_100_000) }))).status).toBe(413);
  });

  it("needs the demo passcode when one is set", async () => {
    vi.stubEnv("DEMO_PASSCODE", "letmein");
    const { POST } = await loadRoute();
    const record = await startedViva();
    expect((await POST(post(record))).status).toBe(401);
    expect((await POST(post(record, { "x-demo-code": "letmein" }))).status).toBe(201);
  });

  it("limits wrong passcode guesses too", async () => {
    vi.stubEnv("DEMO_PASSCODE", "letmein");
    const { POST } = await loadRoute();
    const from = { "x-forwarded-for": "9.9.9.9", "x-demo-code": "guess" };
    for (let i = 0; i < 20; i++) expect((await POST(post({}, from))).status).toBe(401);
    expect((await POST(post({}, from))).status).toBe(429);
  });

  it("limits one address to 20 saves a minute", async () => {
    const { POST } = await loadRoute();
    const from = { "x-forwarded-for": "1.2.3.4" };
    for (let i = 0; i < 20; i++) await POST(post({}, from));
    expect((await POST(post({}, from))).status).toBe(429);
  });
});

describe("POST /api/viva/records with Upstash Redis", () => {
  // A fake Upstash that stores exactly the text it was sent, like the real one.
  let data: Map<string, string>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "viva-records-redis-"));
    vi.stubEnv("VIVA_DATA_DIR", dir);
    vi.stubEnv("DEMO_PASSCODE", "");
    vi.stubEnv("KV_REST_API_URL", "https://fake.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    vi.useFakeTimers({ now: ISSUED + 40_000, toFake: ["Date"] });
    data = new Map();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const [cmd, key, value, ...opts] = JSON.parse(init.body as string) as string[];
        if (cmd === "GET") return Response.json({ result: data.get(key) ?? null });
        if (opts.includes("NX") && data.has(key)) return Response.json({ result: null });
        data.set(key, value);
        return Response.json({ result: "OK" });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves to Redis, treats an identical retry as success and refuses a different record", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    expect((await POST(post(record))).status).toBe(201);
    const retry = await POST(post(record));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, vivaId: record.vivaId, alreadySaved: true });
    expect((await POST(post({ ...record, endReason: "stopped" }))).status).toBe(409);
    expect([...data.keys()].sort()).toEqual([
      `proveit:viva:${record.vivaId}:record`,
      `proveit:viva:${record.vivaId}:session`,
      "proveit:vivas", // the lecturer list
    ]);
  });
});
