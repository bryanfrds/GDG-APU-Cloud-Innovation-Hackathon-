import { describe, expect, it } from "vitest";
import { SAMPLE_PLAN } from "./plan";
import { buildRecord, parseRecord, turnsByQuestion, type VivaRecord } from "./record";
import { appendText, closeTurn, EMPTY_TRANSCRIPT } from "./transcript";

function sampleTranscript() {
  let t = appendText(EMPTY_TRANSCRIPT, "ai", "Hello! ", { questionId: null, atMs: 100 });
  t = closeTurn(t, "complete");
  t = appendText(t, "ai", "Which algorithm did you use?", { questionId: "q1", atMs: 1500 });
  t = closeTurn(t, "complete");
  t = appendText(t, "student", "Merge sort", { questionId: "q1", atMs: 4000 });
  t = appendText(t, "student", ", because it's always n log n.", { questionId: "q2", atMs: 9999 }); // joins q1's line
  t = closeTurn(t, "complete");
  t = appendText(t, "ai", "Worst case?", { questionId: "q2", atMs: 8000 });
  return t;
}

const START = Date.parse("2026-11-05T10:00:00Z");

function sampleRecord(): VivaRecord {
  return buildRecord({
    mode: "demo",
    plan: SAMPLE_PLAN,
    startedAt: START,
    endedAt: START + 30_000,
    endReason: "completed",
    transcript: sampleTranscript(),
  });
}

describe("transcript line tags", () => {
  it("keeps the question and time from when a line started, even as it grows", () => {
    const lines = sampleTranscript().lines;
    expect(lines.map((l) => [l.who, l.questionId, l.atMs])).toEqual([
      ["ai", null, 100],
      ["ai", "q1", 1500],
      ["student", "q1", 4000],
      ["ai", "q2", 8000],
    ]);
    expect(lines[2].text).toBe("Merge sort, because it's always n log n.");
  });
});

describe("buildRecord", () => {
  it("turns the transcript into a record with ISO times and tagged turns", () => {
    const record = sampleRecord();
    expect(record).toMatchObject({
      version: 1,
      mode: "demo",
      startedAt: "2026-11-05T10:00:00.000Z",
      endedAt: "2026-11-05T10:00:30.000Z",
      endReason: "completed",
    });
    expect(record.turns).toEqual([
      { who: "ai", text: "Hello!", questionId: null, atMs: 100 },
      { who: "ai", text: "Which algorithm did you use?", questionId: "q1", atMs: 1500 },
      { who: "student", text: "Merge sort, because it's always n log n.", questionId: "q1", atMs: 4000 },
      { who: "ai", text: "Worst case?", questionId: "q2", atMs: 8000 },
    ]);
  });

  it("leaves out lines that are empty after cleanup", () => {
    const t = appendText(EMPTY_TRANSCRIPT, "ai", "\u{1F9E0}[en]", { atMs: 5 });
    const record = buildRecord({ ...sampleInput(), transcript: t });
    expect(record.turns).toEqual([]);
  });
});

describe("turnsByQuestion", () => {
  it("groups turns under each planned question, in plan order", () => {
    const groups = turnsByQuestion(sampleRecord());
    expect(groups.map((g) => [g.questionId, g.turns.length])).toEqual([
      ["q1", 2],
      ["q2", 1],
      ["q3", 0],
    ]);
  });
});

describe("parseRecord", () => {
  it("accepts a record built by the page", () => {
    const record = sampleRecord();
    expect(parseRecord(JSON.parse(JSON.stringify(record)))).toEqual({ record });
  });

  it.each([
    ["nothing", undefined, "The viva record is missing."],
    ["a wrong version", { ...sampleRecord(), version: 2 }, "Unknown viva record version."],
    ["a bad plan", { ...sampleRecord(), plan: { assignmentTitle: "x", questions: [] } }, "Plan: The viva plan needs at least one question."],
    ["a bad mode", { ...sampleRecord(), mode: "speedrun" }, "The mode must be full or demo."],
    ["a bad date", { ...sampleRecord(), startedAt: "yesterday" }, "Start and end times must be ISO dates."],
    ["an end before the start", { ...sampleRecord(), endedAt: "2026-11-05T09:00:00.000Z" }, "The viva can't end before it starts."],
    ["a 2-hour viva", { ...sampleRecord(), endedAt: "2026-11-05T12:00:00.000Z" }, "The viva is longer than 30 minutes."],
    ["an unknown end reason", { ...sampleRecord(), endReason: "exploded" }, "Unknown end reason."],
    ["turns that aren't a list", { ...sampleRecord(), turns: "lots" }, "Turns must be a list."],
    ["a bad speaker", { ...sampleRecord(), turns: [{ who: "judge", text: "Hi", questionId: null, atMs: 0 }] }, "Turn 1: who must be ai or student."],
    ["empty text", { ...sampleRecord(), turns: [{ who: "ai", text: " ", questionId: null, atMs: 0 }] }, "Turn 1: text must be 1–4000 characters."],
    ["a question not in the plan", { ...sampleRecord(), turns: [{ who: "ai", text: "Hi", questionId: "q9", atMs: 0 }] }, 'Turn 1: question "q9" isn\'t in the plan.'],
    ["a negative time", { ...sampleRecord(), turns: [{ who: "ai", text: "Hi", questionId: null, atMs: -5 }] }, "Turn 1: atMs must be a time within the viva."],
  ])("rejects %s", (_label, input, message) => {
    expect(parseRecord(input)).toEqual({ error: message });
  });

  it("rejects too many turns", () => {
    const turns = Array.from({ length: 301 }, () => ({ who: "ai", text: "Hi", questionId: null, atMs: 0 }));
    expect(parseRecord({ ...sampleRecord(), turns })).toEqual({ error: "A viva can have at most 300 turns." });
  });

  it("drops fields it doesn't know about", () => {
    const parsed = parseRecord({ ...sampleRecord(), secret: "x", turns: [{ who: "ai", text: "Hi", questionId: null, atMs: 1, extra: 1 }] });
    expect(parsed).not.toHaveProperty("record.secret");
    expect((parsed as { record: VivaRecord }).record.turns[0]).toEqual({ who: "ai", text: "Hi", questionId: null, atMs: 1 });
  });
});

function sampleInput() {
  return { mode: "demo" as const, plan: SAMPLE_PLAN, startedAt: START, endedAt: START + 1000, endReason: "stopped" as const };
}
