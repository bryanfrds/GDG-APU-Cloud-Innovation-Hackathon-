import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

const FAKE_KEY = "AIzaFAKE-server-only-key";

async function loadRoute() {
  vi.resetModules(); // fresh rate limiter for each test
  return import("./route");
}

function request(headers: Record<string, string> = {}, body?: unknown) {
  return new Request("http://localhost/api/viva/token", {
    method: "POST",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let dataDir = "";

describe("POST /api/viva/token", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ name: "auth_tokens/abc123" });
    vi.stubEnv("GEMINI_API_KEY", FAKE_KEY);
    vi.stubEnv("DEMO_PASSCODE", "");
    dataDir = mkdtempSync(path.join(tmpdir(), "viva-token-"));
    vi.stubEnv("VIVA_DATA_DIR", dataDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("gives each viva an id and remembers the plan and mode it was locked to", async () => {
    const { POST } = await loadRoute();
    const plan = { assignmentTitle: "Hash tables", questions: [{ id: "h1", text: "How do you handle collisions?" }] };
    const body = await (await POST(request({}, { plan, mode: "demo" }))).json();
    expect(body.vivaId).toMatch(/^viva_[0-9a-f]{24}$/);
    const session = JSON.parse(readFileSync(path.join(dataDir, `${body.vivaId}.session.json`), "utf8"));
    expect(session).toMatchObject({ vivaId: body.vivaId, plan, mode: "demo" });
  });

  it("doesn't remember a viva when Gemini refuses the pass", async () => {
    create.mockRejectedValue(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await loadRoute();
    expect((await POST(request())).status).toBe(502);
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it("returns a one-time pass and never the real key", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request());
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ token: "auth_tokens/abc123", model: expect.any(String), mode: "full", seconds: 300 });
    expect(text).not.toContain(FAKE_KEY);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("asks Gemini for a single-use pass locked to our model and instructions", async () => {
    const { POST } = await loadRoute();
    await POST(request());
    const { config } = create.mock.calls[0][0];
    expect(config.uses).toBe(1);
    expect(config.liveConnectConstraints.model).toMatch(/live/);
    expect(config.liveConnectConstraints.config.systemInstruction).toMatch(/examiner/i);
    expect(config.liveConnectConstraints.config.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).toEqual([
      "start_question",
      "end_viva",
    ]);
    expect(config).not.toHaveProperty("lockAdditionalFields"); // omitted = lock everything
  });

  it("builds the instructions from the plan the page sends", async () => {
    const { POST } = await loadRoute();
    const plan = { assignmentTitle: "Hash tables", questions: [{ id: "h1", text: "How do you handle collisions?" }] };
    const res = await POST(request({}, { plan, mode: "demo" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "demo", seconds: 30, plan });
    const { config } = create.mock.calls[0][0];
    const instructions = config.liveConnectConstraints.config.systemInstruction;
    expect(instructions).toContain('<question id="h1">How do you handle collisions?</question>');
    expect(instructions).toMatch(/30-second demo/);
  });

  it("makes the pass last only as long as the viva plus a short grace period", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T10:00:00Z") });
    try {
      const { POST } = await loadRoute();
      await POST(request({}, { mode: "demo" }));
      await POST(request({}, { mode: "full" }));
      const [demo, full] = create.mock.calls.map((c) => c[0].config);
      // 1 min to connect + the viva + 2 min grace
      expect(demo.expireTime).toBe("2026-11-05T10:03:30.000Z");
      expect(full.expireTime).toBe("2026-11-05T10:08:00.000Z");
      expect(demo.newSessionExpireTime).toBe("2026-11-05T10:01:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a body that isn't valid JSON", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/viva/token", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a body that is far too large", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request({}, { mode: "demo", padding: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it("counts the size in bytes, so 6,000 Chinese characters (18 KB) is too large", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request({}, { mode: "demo", padding: "排".repeat(6_000) }));
    expect(res.status).toBe(413);
  });

  it("refuses early when the declared size is too large", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request({ "content-length": "50000" }, { mode: "demo" }));
    expect(res.status).toBe(413);
  });

  it("uses the sample plan when the body is empty", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request());
    expect((await res.json()).plan.questions[0].id).toBe("q1");
  });

  it("rejects a bad plan without asking Gemini", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request({}, { plan: { assignmentTitle: "x", questions: [] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one question/);
    expect(create).not.toHaveBeenCalled();
  });

  describe("with DEMO_PASSCODE set", () => {
    beforeEach(() => vi.stubEnv("DEMO_PASSCODE", "letmein"));

    it("refuses a request with no passcode", async () => {
      const { POST } = await loadRoute();
      expect((await POST(request())).status).toBe(401);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a wrong passcode", async () => {
      const { POST } = await loadRoute();
      expect((await POST(request({ "x-demo-code": "nope" }))).status).toBe(401);
    });

    it("accepts the right passcode", async () => {
      const { POST } = await loadRoute();
      expect((await POST(request({ "x-demo-code": "letmein" }))).status).toBe(200);
    });
  });

  it("returns 500 when the server has no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { POST } = await loadRoute();
    expect((await POST(request())).status).toBe(500);
  });

  it("returns 502 when Gemini refuses to make a pass", async () => {
    create.mockRejectedValue(new Error("quota exceeded"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await loadRoute();
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("quota");
  });

  it("limits one address to 10 passes a minute", async () => {
    const { POST } = await loadRoute();
    const from = { "x-forwarded-for": "1.2.3.4" };
    for (let i = 0; i < 10; i++) expect((await POST(request(from))).status).toBe(200);
    expect((await POST(request(from))).status).toBe(429);
    expect((await POST(request({ "x-forwarded-for": "5.6.7.8" }))).status).toBe(200);
  });

  it("can't be dodged by faking the first x-forwarded-for address", async () => {
    const { POST } = await loadRoute();
    for (let i = 0; i < 10; i++) {
      expect((await POST(request({ "x-forwarded-for": `9.9.9.${i}, 1.2.3.4` }))).status).toBe(200);
    }
    expect((await POST(request({ "x-forwarded-for": "8.8.8.8, 1.2.3.4" }))).status).toBe(429);
  });
});
