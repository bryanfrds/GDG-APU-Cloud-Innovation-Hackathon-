import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@google/genai", () => ({
  Modality: { AUDIO: "AUDIO" },
  Type: { OBJECT: "OBJECT", STRING: "STRING" },
  GoogleGenAI: class {
    authTokens = { create };
  },
}));

const SUBMISSION_ID = "0123456789abcdef0123456789abcdef";
const SAVED_PLAN = {
  assignmentTitle: "Sorting Assignment",
  questions: [
    { id: "q1", text: "Explain the purpose of your sorting function.", focus: "Implementation overview" },
    { id: "q2", text: "Why did you choose this approach?", focus: "Design decisions" },
  ],
};

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

function request(body?: unknown) {
  return new Request("http://localhost/api/viva/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function serviceReplies(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let dataDir = "";

describe("POST /api/viva/token with a submission", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ name: "auth_tokens/abc123" });
    vi.stubEnv("GEMINI_API_KEY", "AIzaFAKE-server-only-key");
    vi.stubEnv("DEMO_PASSCODE", "");
    vi.stubEnv("PROVE_IT_API_URL", "https://api.example.test/");
    dataDir = mkdtempSync(path.join(tmpdir(), "viva-submission-"));
    vi.stubEnv("VIVA_DATA_DIR", dataDir);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("loads the saved plan server-side and remembers which submission it came from", async () => {
    vi.stubEnv("DEMO_PASSCODE", "letmein");
    const fetchMock = serviceReplies(200, SAVED_PLAN);
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/viva/token", {
        method: "POST",
        headers: { "content-type": "application/json", "x-demo-code": "letmein" },
        body: JSON.stringify({ submissionId: SUBMISSION_ID, mode: "demo" }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plan).toEqual(SAVED_PLAN);
    expect(body.submissionId).toBe(SUBMISSION_ID);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.example.test/api/submissions/${SUBMISSION_ID}/viva-plan`);
    expect(fetchMock.mock.calls[0][1].headers["x-demo-code"]).toBe("letmein");
    const session = JSON.parse(readFileSync(path.join(dataDir, `${body.vivaId}.session.json`), "utf8"));
    expect(session).toMatchObject({ submissionId: SUBMISSION_ID, plan: SAVED_PLAN });
  });

  it("refuses a client-written plan once a submissions service is configured", async () => {
    const fetchMock = serviceReplies(200, SAVED_PLAN);
    const { POST } = await loadRoute();
    const res = await POST(request({ plan: SAVED_PLAN }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("still gives the sample plan when no submission is named", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect((await res.json()).submissionId).toBeUndefined();
  });

  it.each([
    [404, { detail: "Submission not found" }, 404],
    [404, { detail: "Questions have not been generated" }, 409],
    [422, { detail: "Saved questions are not viva-compatible" }, 422],
    [429, { detail: "Too many requests" }, 429],
    [401, { detail: "Wrong or missing demo passcode" }, 502],
    [500, { detail: "boom" }, 502],
  ])("maps service status %i %j to %i without leaking details", async (status, detail, expected) => {
    serviceReplies(status, detail);
    const { POST } = await loadRoute();
    const res = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(res.status).toBe(expected);
    expect(JSON.stringify(await res.json())).not.toMatch(/passcode|boom|detail/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a malformed submission id without calling the service", async () => {
    const fetchMock = serviceReplies(200, SAVED_PLAN);
    const { POST } = await loadRoute();
    const res = await POST(request({ submissionId: "../../etc/passwd" }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a saved plan that fails parsePlan", async () => {
    serviceReplies(200, { assignmentTitle: "x", questions: [] });
    const { POST } = await loadRoute();
    expect((await POST(request({ submissionId: SUBMISSION_ID }))).status).toBe(422);
  });

  it("answers 502 when the service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { POST } = await loadRoute();
    expect((await POST(request({ submissionId: SUBMISSION_ID }))).status).toBe(502);
  });
});
