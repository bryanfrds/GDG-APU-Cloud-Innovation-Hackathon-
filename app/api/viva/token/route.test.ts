import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@google/genai", () => ({
  Modality: { AUDIO: "AUDIO" },
  GoogleGenAI: class {
    authTokens = { create };
  },
}));

const FAKE_KEY = "AIzaFAKE-server-only-key";

async function loadRoute() {
  vi.resetModules(); // fresh rate limiter for each test
  return import("./route");
}

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/viva/token", { method: "POST", headers });
}

describe("POST /api/viva/token", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ name: "auth_tokens/abc123" });
    vi.stubEnv("GEMINI_API_KEY", FAKE_KEY);
    vi.stubEnv("DEMO_PASSCODE", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns a one-time pass and never the real key", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request());
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ token: "auth_tokens/abc123", model: expect.any(String) });
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
    expect(config).not.toHaveProperty("lockAdditionalFields"); // omitted = lock everything
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
});
