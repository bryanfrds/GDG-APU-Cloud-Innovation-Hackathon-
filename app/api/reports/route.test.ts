import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scoreViva = vi.fn();
vi.mock("@/src/lib/scoring/scoreViva", () => ({ scoreViva }));
vi.mock("../../../src/lib/scoring/scoreViva", () => ({ scoreViva }));

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "reports-"));
  vi.stubEnv("VIVA_DATA_DIR", dir);
  vi.stubEnv("DEMO_PASSCODE", "");
  scoreViva.mockReset();
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function savedViva(studentText = "I used merge sort.") {
  const { kvListAdd } = await import("@/lib/kv");
  const { saveRecordOnce, newVivaId } = await import("@/lib/viva/store");
  const { SAMPLE_PLAN } = await import("@/lib/viva/plan");
  const vivaId = newVivaId();
  await saveRecordOnce({
    version: 1, vivaId, submissionId: null, mode: "demo", plan: SAMPLE_PLAN,
    startedAt: "2026-11-12T10:00:00.000Z", endedAt: "2026-11-12T10:00:30.000Z", endReason: "completed", truncated: false,
    turns: [
      { who: "ai", text: "Which sort?", questionId: "q1", atMs: 0 },
      { who: "student", text: studentText, questionId: "q1", atMs: 3000 },
    ],
    receivedAt: "2026-11-12T10:00:31.000Z",
  });
  await kvListAdd("proveit:vivas", vivaId);
  return vivaId;
}

const REPORT = { overallScore: 70, scoreLabel: "Adequate", inconsistency: { flagged: false, evidence: null, severity: null }, scoredAnswers: [] };
const ctx = (vivaId: string) => ({ params: Promise.resolve({ vivaId }) });
const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, init);

describe("lecturer reports API", () => {
  it("needs the passcode when one is set", async () => {
    vi.stubEnv("DEMO_PASSCODE", "letmein");
    const { GET } = await import("./route");
    expect((await GET(req("/api/reports"))).status).toBe(401);
    expect((await GET(req("/api/reports", { headers: { "x-demo-code": "letmein" } }))).status).toBe(200);
  });

  it("lists saved vivas with their answers and no score until scored, then scores and caches", async () => {
    const vivaId = await savedViva();
    const list = await import("./route");
    const listed = await (await list.GET(req("/api/reports"))).json();
    expect(listed.vivas).toEqual([expect.objectContaining({ vivaId, sample: true, answers: 1, score: null })]);

    scoreViva.mockResolvedValue(REPORT);
    const one = await import("./[vivaId]/route");
    const scored = await one.POST(req(`/api/reports/${vivaId}`, { method: "POST" }), ctx(vivaId));
    expect(scored.status).toBe(200);
    expect((await scored.json()).report).toEqual(REPORT);
    await one.POST(req(`/api/reports/${vivaId}`, { method: "POST" }), ctx(vivaId));
    expect(scoreViva).toHaveBeenCalledTimes(1); // cached the second time

    const again = await (await list.GET(req("/api/reports"))).json();
    expect(again.vivas[0].score).toEqual({ overall: 70, label: "Adequate", flagged: false });
  });

  it("won't score a viva with no answers, retries a Gemini failure once, then reports 502", async () => {
    const one = await import("./[vivaId]/route");
    const empty = await savedViva("   ");
    expect((await one.POST(req("/x", { method: "POST" }), ctx(empty))).status).toBe(422);

    const vivaId = await savedViva();
    scoreViva.mockRejectedValue(new Error("503"));
    expect((await one.POST(req("/x", { method: "POST" }), ctx(vivaId))).status).toBe(502);
    expect(scoreViva).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for a viva that wasn't saved", async () => {
    const one = await import("./[vivaId]/route");
    expect((await one.GET(req("/x"), ctx("viva_000000000000000000000000"))).status).toBe(404);
  });
});
