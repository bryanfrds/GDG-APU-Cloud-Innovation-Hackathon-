import { describe, expect, it } from "vitest";
import { MAX_TYPED_CHARS, prepareTypedAnswer, typedAnswerMessage } from "./typed-answer";

describe("prepareTypedAnswer", () => {
  it("trims the answer and keeps normal text", () => {
    expect(prepareTypedAnswer("  I used merge sort because it's O(n log n).  ")).toEqual({
      text: "I used merge sort because it's O(n log n).",
    });
  });

  it("turns line breaks into spaces and removes hidden characters", () => {
    expect(prepareTypedAnswer("First line\nsecond\u200b line")).toEqual({ text: "First line second line" });
  });

  it("refuses an empty answer", () => {
    expect(prepareTypedAnswer("   ")).toEqual({ error: "Type an answer first." });
    expect(prepareTypedAnswer("\u200b\u202e")).toEqual({ error: "Type an answer first." });
  });

  it("refuses an answer that's too long", () => {
    expect(prepareTypedAnswer("x".repeat(MAX_TYPED_CHARS))).toHaveProperty("text");
    expect(prepareTypedAnswer("x".repeat(MAX_TYPED_CHARS + 1))).toEqual({ error: "Keep it under 1000 characters." });
  });
});

describe("typedAnswerMessage", () => {
  it("sends the answer as a complete user turn", () => {
    expect(typedAnswerMessage("Merge sort")).toEqual({
      turns: [{ role: "user", parts: [{ text: "Merge sort" }] }],
      turnComplete: true,
    });
  });
});
