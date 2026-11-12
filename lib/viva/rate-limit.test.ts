import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks until the window passes", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 10)).toBe(true);
    expect(limiter.allow("a", 20)).toBe(false);
    expect(limiter.allow("a", 1011)).toBe(true);
  });

  it("keeps a busy address blocked even when many other addresses show up", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.allow("busy", 0)).toBe(true);
    for (let i = 0; i < 10_001; i++) limiter.allow(`other-${i}`, 1);
    expect(limiter.allow("busy", 2)).toBe(false);
  });
});
