import { describe, expect, it } from "vitest";
import { appendText, closeTurn, EMPTY_TRANSCRIPT } from "./transcript";

const texts = (t: typeof EMPTY_TRANSCRIPT) => t.lines.map((l) => `${l.who}: ${l.text}`);

describe("transcript", () => {
  it("joins chunks from the same speaker into one line", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "Hello, ");
    t = appendText(t, "ai", "welcome.");
    expect(texts(t)).toEqual(["ai: Hello, welcome."]);
  });

  it("keeps a student's late chunk on their own line, not the examiner's", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "student", "So I used");
    t = appendText(t, "ai", "Good, why?");
    t = appendText(t, "student", " quicksort");
    expect(texts(t)).toEqual(["student: So I used quicksort", "ai: Good, why?"]);
  });

  it("starts new lines after a completed turn", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "First question?");
    t = closeTurn(t, "complete");
    t = appendText(t, "ai", "Second question?");
    expect(texts(t)).toEqual(["ai: First question?", "ai: Second question?"]);
  });

  it("keeps the student's line open when they interrupt", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "Can you explain");
    t = appendText(t, "student", "Sorry, I");
    t = closeTurn(t, "interrupted");
    t = appendText(t, "student", " meant merge sort");
    t = appendText(t, "ai", "No problem.");
    expect(texts(t)).toEqual(["ai: Can you explain", "student: Sorry, I meant merge sort", "ai: No problem."]);
  });

  it("ignores empty chunks", () => {
    expect(appendText(EMPTY_TRANSCRIPT, "ai", "")).toBe(EMPTY_TRANSCRIPT);
  });
});
