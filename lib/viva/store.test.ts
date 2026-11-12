import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PLAN } from "./plan";
import { getRecord, getSession, newVivaId, saveRecordOnce, saveSession, type StoredRecord } from "./store";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "viva-store-"));
  vi.stubEnv("VIVA_DATA_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function record(vivaId: string): StoredRecord {
  return {
    version: 1,
    vivaId,
    submissionId: null,
    mode: "demo",
    plan: SAMPLE_PLAN,
    startedAt: "2026-11-05T10:00:00.000Z",
    endedAt: "2026-11-05T10:00:30.000Z",
    endReason: "completed",
    truncated: false,
    turns: [{ who: "ai", text: "Hi", questionId: null, atMs: 0 }],
    receivedAt: "2026-11-05T10:00:31.000Z",
  };
}

describe("newVivaId", () => {
  it("makes ids that parseRecord accepts, and never the same one twice", () => {
    const ids = new Set(Array.from({ length: 1000 }, newVivaId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_-]{8,64}$/i);
  });
});

describe("sessions", () => {
  it("saves and reads back a session", async () => {
    const session = { vivaId: newVivaId(), plan: SAMPLE_PLAN, mode: "full" as const, issuedAt: "2026-11-05T10:00:00.000Z" };
    await saveSession(session);
    expect(await getSession(session.vivaId)).toEqual(session);
  });

  it("returns null for a viva it doesn't know, or an unsafe id", async () => {
    expect(await getSession(newVivaId())).toBeNull();
    expect(await getSession("../../etc/passwd")).toBeNull();
  });

  it("leaves no temporary files behind", async () => {
    await saveSession({ vivaId: newVivaId(), plan: SAMPLE_PLAN, mode: "demo", issuedAt: "2026-11-05T10:00:00.000Z" });
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

describe("records", () => {
  it("saves a record once and refuses a second save, even at the same moment", async () => {
    const id = newVivaId();
    const results = await Promise.all([saveRecordOnce(record(id)), saveRecordOnce(record(id))]);
    expect(results.sort()).toEqual([false, true]);
    expect(await getRecord(id)).toEqual(record(id));
  });

  it("refuses to build a path from an unsafe id", async () => {
    await expect(saveRecordOnce(record("../evil-record"))).rejects.toThrow("Unsafe viva id");
    expect(await getRecord("../evil-record")).toBeNull();
  });
});

describe("with Upstash Redis", () => {
  // A fake Upstash: an in-memory map behind the same REST shape.
  let data: Map<string, string>;
  let calls: string[][];

  beforeEach(() => {
    data = new Map();
    calls = [];
    vi.stubEnv("KV_REST_API_URL", "https://fake.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const [cmd, key, value, ...opts] = JSON.parse(init.body as string) as string[];
        calls.push([cmd, key, ...opts]);
        if (cmd === "GET") return Response.json({ result: data.get(key) ?? null });
        if (cmd === "SET") {
          if (opts.includes("NX") && data.has(key)) return Response.json({ result: null });
          data.set(key, value);
          return Response.json({ result: "OK" });
        }
        return Response.json({ error: "unknown command" }, { status: 400 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps sessions in Redis for a day, not on disk", async () => {
    const session = { vivaId: newVivaId(), plan: SAMPLE_PLAN, mode: "full" as const, issuedAt: "2026-11-05T10:00:00.000Z" };
    await saveSession(session);
    expect(await getSession(session.vivaId)).toEqual(session);
    expect(calls[0]).toEqual(["SET", `proveit:viva:${session.vivaId}:session`, "EX", "86400"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("saves a record once, with no expiry", async () => {
    const id = newVivaId();
    expect(await saveRecordOnce(record(id))).toBe(true);
    expect(await saveRecordOnce(record(id))).toBe(false);
    expect(await getRecord(id)).toEqual(record(id));
    expect(calls[0]).toEqual(["SET", `proveit:viva:${id}:record`, "NX"]);
  });

  it("returns null for unknown or unsafe ids without asking Redis about unsafe ones", async () => {
    expect(await getSession(newVivaId())).toBeNull();
    expect(await getRecord("../evil")).toBeNull();
    await expect(saveRecordOnce(record("bad id!"))).rejects.toThrow("Unsafe viva id");
    expect(calls.every(([, key]) => !key.includes("evil") && !key.includes("bad id"))).toBe(true);
  });

  it("passes a Redis failure up, so the token route can mark the viva unsaveable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "down" }, { status: 503 })));
    await expect(
      saveSession({ vivaId: newVivaId(), plan: SAMPLE_PLAN, mode: "demo", issuedAt: "2026-11-05T10:00:00.000Z" }),
    ).rejects.toThrow("503");
  });
});
