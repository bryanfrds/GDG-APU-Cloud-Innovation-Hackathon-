import { afterEach, describe, expect, it, vi } from "vitest";
import { redisCommand, redisConfig } from "./redis";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("redisConfig", () => {
  it("reads Vercel's names, then Upstash's, and needs both URL and token", () => {
    expect(redisConfig({ KV_REST_API_URL: "https://a.upstash.io/", KV_REST_API_TOKEN: "t" })).toEqual({
      url: "https://a.upstash.io",
      token: "t",
    });
    expect(redisConfig({ UPSTASH_REDIS_REST_URL: "https://b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "u" })).toEqual({
      url: "https://b.upstash.io",
      token: "u",
    });
    expect(redisConfig({ KV_REST_API_URL: "https://a.upstash.io" })).toBeNull();
    expect(redisConfig({ KV_REST_API_URL: "", KV_REST_API_TOKEN: "" })).toBeNull();
    expect(redisConfig({})).toBeNull();
  });

  it("never mixes a URL from one pair with a token from the other, and warns once about half a pair", async () => {
    vi.resetModules(); // the warning is once per server, so start from a fresh module
    const { redisConfig } = await import("./redis");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(redisConfig({ KV_REST_API_URL: "https://a.upstash.io", UPSTASH_REDIS_REST_TOKEN: "u" })).toBeNull();
    expect(redisConfig({ KV_REST_API_TOKEN: "t" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("redisCommand", () => {
  const config = { url: "https://a.upstash.io", token: "secret-token" };

  it("posts the command with the token and returns the result", async () => {
    const fetchMock = vi.fn(async () => Response.json({ result: "OK" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await redisCommand(config, ["SET", "k", "v", "NX"])).toBe("OK");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://a.upstash.io");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string)).toEqual(["SET", "k", "v", "NX"]);
  });

  it("returns null for a missing key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: null })));
    expect(await redisCommand(config, ["GET", "nope"])).toBeNull();
  });

  it("throws on an error without leaking the token or the values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "WRONGPASS" }, { status: 401 })));
    const err = await redisCommand(config, ["SET", "k", "private-value"]).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("secret-token");
    expect((err as Error).message).not.toContain("private-value");
  });

  it("throws when the reply isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    await expect(redisCommand(config, ["GET", "k"])).rejects.toThrow("502");
  });
});
