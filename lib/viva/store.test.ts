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
