import { describe, expect, it, vi } from "vitest";
import { createTypingMode } from "./typing";

describe("createTypingMode", () => {
  it("starts in speaking mode", () => {
    expect(createTypingMode(vi.fn()).active).toBe(false);
  });

  it("tells Gemini the audio stopped once, when typing starts", () => {
    const onStart = vi.fn();
    const typing = createTypingMode(onStart);
    expect(typing.set(true)).toBe(true);
    expect(typing.set(true)).toBe(false); // a second typed answer doesn't repeat it
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(typing.active).toBe(true);
  });

  it("switches back to speaking without another message, and can type again later", () => {
    const onStart = vi.fn();
    const typing = createTypingMode(onStart);
    typing.set(true);
    expect(typing.set(false)).toBe(true);
    expect(typing.active).toBe(false);
    expect(onStart).toHaveBeenCalledTimes(1);
    typing.set(true);
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("resets to speaking for a new viva without telling Gemini", () => {
    const onStart = vi.fn();
    const typing = createTypingMode(onStart);
    typing.set(true);
    typing.reset();
    expect(typing.active).toBe(false);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
