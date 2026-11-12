import { describe, expect, it } from "vitest";
import { addTypedLine, appendText as appendTagged, cleanTranscriptText, closeTurn, EMPTY_TRANSCRIPT, type Speaker, type Transcript } from "./transcript";

// These tests are about joining and cleaning text, so every line gets the same tag.
const appendText = (t: Transcript, who: Speaker, text: string) => appendTagged(t, who, text, { questionId: null, atMs: 0 });

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

  it("removes the markers Gemini writes while the student is silent", () => {
    expect(cleanTranscriptText("<no speech>{pause}")).toBe("");
    expect(cleanTranscriptText("Okay. <No Speech> {pause} Next one?")).toBe("Okay. Next one?");
  });

  it("removes the voice tag Gemini sometimes writes before a line", () => {
    expect(cleanTranscriptText("<speaker:default_spoken_text>Okay, thanks.")).toBe("Okay, thanks.");
    expect(cleanTranscriptText("<speaker:voice-1>Okay.")).toBe("Okay.");
  });

  it("removes a tool call Gemini writes out as text", () => {
    const leaked = "Hello.<sink>\n<call:start_question{question_id:q1}/>\n</sink> I notice you used merge.";
    expect(cleanTranscriptText(leaked)).toBe("Hello. I notice you used merge.");
    expect(cleanTranscriptText("Okay.<call:end_viva{}/> Bye.")).toBe("Okay. Bye.");
  });

  it("keeps braces and the words 'no speech' in normal text", () => {
    expect(cleanTranscriptText("I wrote {a, b} and there was no speech recognition")).toBe("I wrote {a, b} and there was no speech recognition");
  });

  it("leaves normal text alone, including square brackets and angle brackets", () => {
    const text = "Use list[i], dict[key] and arr[idx] when i < n or x<y, and <already> is just a word here.";
    expect(cleanTranscriptText(text)).toBe(text);
  });
});

describe("lines that are only an ellipsis", () => {
  it("hides a spoken line that is only an ellipsis, but keeps one inside a sentence", () => {
    for (const dots of ["…", " ... ", "..", "……"]) {
      expect(texts(appendText(EMPTY_TRANSCRIPT, "ai", dots))).toEqual(["ai: "]);
    }
    expect(texts(appendText(EMPTY_TRANSCRIPT, "ai", "It returns true when… the book is there"))).toEqual([
      "ai: It returns true when… the book is there",
    ]);
  });

  it("leaves typed answers exactly as typed, ellipsis and code included", () => {
    const meta = { questionId: "q1", atMs: 0 };
    expect(texts(addTypedLine(EMPTY_TRANSCRIPT, "...", meta))).toEqual(["student: ..."]);
    expect(texts(addTypedLine(EMPTY_TRANSCRIPT, "JSX <call:foo/> is self-closing", meta))).toEqual(["student: JSX <call:foo/> is self-closing"]);
  });

  it("removes a <sink> tool call that arrives split across chunks", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "Hello.<sink>\n<call:start_q");
    t = appendText(t, "ai", "uestion{question_id:q1}/>\n</si");
    t = appendText(t, "ai", "nk> I notice you used merge.");
    expect(texts(t)).toEqual(["ai: Hello. I notice you used merge."]);
  });

  it("doesn't let an unclosed <sink> swallow the speech after it", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "A<sink><call:x{}/> real words here <sink><call:y{}/></sink> end");
    expect(texts(t)).toEqual(["ai: A real words here end"]);
    t = appendText(EMPTY_TRANSCRIPT, "ai", "Hello.<sink>\n Then real speech.");
    expect(texts(t)).toEqual(["ai: Hello.\n Then real speech."]);
  });

  it("removes a tag that arrives split across chunks, then shows the words", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "<speaker:def");
    t = appendText(t, "ai", "ault_spoken_text>");
    expect(texts(t)).toEqual(["ai: "]);
    t = appendText(t, "ai", "Okay, thanks.");
    expect(texts(t)).toEqual(["ai: Okay, thanks."]);
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

describe("addTypedLine", () => {
  const meta = { questionId: "q2", atMs: 9000 };

  it("adds a complete student line marked as typed", () => {
    const t = addTypedLine(EMPTY_TRANSCRIPT, "Merge sort", meta);
    expect(t.lines).toEqual([{ who: "student", text: "Merge sort", raw: "Merge sort", questionId: "q2", atMs: 9000, typed: true }]);
    expect(t.open.student).toBeNull();
  });

  it("closes a spoken student line first, so the two never merge", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "student", "I think");
    t = addTypedLine(t, "Merge sort", meta);
    t = appendText(t, "student", "and also");
    expect(t.lines.map((l) => [l.text, l.typed ?? false])).toEqual([
      ["I think", false],
      ["Merge sort", true],
      ["and also", false],
    ]);
  });

  it("leaves the examiner's line open, so the rest of its cut-off sentence stays above the answer", () => {
    let t = appendText(EMPTY_TRANSCRIPT, "ai", "Which algorithm");
    t = addTypedLine(t, "Merge sort", meta);
    t = appendText(t, "ai", " did you use?");
    expect(t.lines.map((l) => `${l.who}: ${l.text}`)).toEqual(["ai: Which algorithm did you use?", "student: Merge sort"]);
  });

  it("ignores an empty answer", () => {
    expect(addTypedLine(EMPTY_TRANSCRIPT, "", meta)).toBe(EMPTY_TRANSCRIPT);
  });
});
