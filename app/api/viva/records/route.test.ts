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

  it("saves each viva only once", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva();
    expect((await POST(post(record))).status).toBe(201);
    const again = await POST(post(record));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already been saved/);
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

  it("refuses a viva that started before its pass was issued", async () => {
    const { POST } = await loadRoute();
    const record = await startedViva({ startedAt: ISSUED - 10 * 60_000, endedAt: ISSUED - 9 * 60_000 });
    const res = await POST(post(record));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/start time/);
  });

  it("refuses a viva that started long after its pass expired", async () => {
    const { POST } = await loadRoute();
    vi.setSystemTime(ISSUED + 20 * 60_000);
    const record = await startedViva({ startedAt: ISSUED + 15 * 60_000, endedAt: ISSUED + 15 * 60_000 + 20_000 });
    expect((await POST(post(record))).status).toBe(409);
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

  it("limits one address to 20 saves a minute", async () => {
    const { POST } = await loadRoute();
    const from = { "x-forwarded-for": "1.2.3.4" };
    for (let i = 0; i < 20; i++) await POST(post({}, from));
    expect((await POST(post({}, from))).status).toBe(429);
  });
});
