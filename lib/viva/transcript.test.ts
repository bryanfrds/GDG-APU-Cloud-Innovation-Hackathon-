import { describe, expect, it } from "vitest";
import { appendText, cleanTranscriptText, closeTurn, EMPTY_TRANSCRIPT } from "./transcript";

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

describe("cleanTranscriptText", () => {
  it("removes Gemini's leaked language tags", () => {
    expect(cleanTranscriptText("\u{1F9E0}[en]<already en>Which sorting")).toBe("Which sorting");
    expect(cleanTranscriptText("Okay. \u{1F9E0}[ms] Next question")).toBe("Okay. Next question");
    expect(cleanTranscriptText("Okay. \u{1F9E0} [ms] Next")).toBe("Okay. Next");
  });

  it("leaves normal text alone, including square brackets and angle brackets", () => {
    const text = "Use list[i], dict[key] and arr[idx] when i < n or x<y, and <already> is just a word here.";
    expect(cleanTranscriptText(text)).toBe(text);
  });
});

describe("appendText with leaked tags", () => {
  it("removes tags even when they arrive split across chunks", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "\u{1F9E0}[e");
    t = appendText(t, "ai", "n]<already ");
    t = appendText(t, "ai", "en>Which sorting");
    t = appendText(t, "ai", " did you use?");
    expect(texts(t)).toEqual(["ai: Which sorting did you use?"]);
  });

  it.each([
    ["the emoji alone, then its tag", ["\u{1F9E0}", "[en] Next question"], "Next question"],
    ["the tag split in the middle", ["\u{1F9E0}[e", "n] Hello"], "Hello"],
    ["the emoji after some words", ["Okay. \u{1F9E0}", " [ms] Next"], "Okay. Next"],
  ])("never leaves a tag behind when %s arrive in separate chunks", (_label, chunks, expected) => {
    const t = chunks.reduce((acc, c) => appendText(acc, "ai", c), EMPTY_TRANSCRIPT);
    expect(t.lines[0].text).toBe(expected);
  });

  it("doesn't start a line with a space when the first chunk was only tags", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "\u{1F9E0}[en]");
    expect(t.lines[0].text).toBe("");
    t = appendText(t, "ai", " Hello");
    expect(t.lines[0].text).toBe("Hello");
  });
});
