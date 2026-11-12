import { describe, expect, it } from "vitest";
import { SAMPLE_PLAN } from "../viva/plan";
import type { VivaRecord } from "../viva/record";
import { toSubmission, toTranscript } from "./score";

const record: VivaRecord = {
  version: 1,
  vivaId: "viva_aaaaaaaaaaaaaaaaaaaaaaaa",
  submissionId: "sub_aaaaaaaaaaaaaaaaaaaa",
  mode: "full",
  plan: SAMPLE_PLAN,
  startedAt: "2026-11-12T10:00:00.000Z",
  endedAt: "2026-11-12T10:03:00.000Z",
  endReason: "completed",
  truncated: false,
  turns: [
    { who: "ai", text: "Hello", questionId: null, atMs: 0 },
    { who: "ai", text: "Q1?", questionId: "q1", atMs: 1000 },
    { who: "student", text: "Merge sort.", questionId: "q1", atMs: 4000 },
    { who: "ai", text: "Why?", questionId: "q1", atMs: 6000 },
    { who: "student", text: "Stable.", questionId: "q1", atMs: 9000, typed: true },
    { who: "ai", text: "Q2?", questionId: "q2", atMs: 12000 },
  ],
};

describe("toTranscript", () => {
  it("gathers each question's student answers, follow-ups and time, in plan order", () => {
    const t = toTranscript(record);
    expect(t.answers.map((a) => a.questionId)).toEqual(SAMPLE_PLAN.questions.map((q) => q.id));
    expect(t.answers[0]).toMatchObject({ studentAnswer: "Merge sort. Stable.", followUpCount: 1, answerDurationMs: 8000 });
    expect(t.answers[1]).toMatchObject({ studentAnswer: "", followUpCount: 0 });
    expect(t).toMatchObject({ submissionId: "sub_aaaaaaaaaaaaaaaaaaaa", mode: "voice", completedAt: record.endedAt });
  });

  it("calls a viva text-mode only when every answer was typed, and names the sample", () => {
    const typed = { ...record, submissionId: null, turns: record.turns.map((t) => (t.who === "student" ? { ...t, typed: true as const } : t)) };
    expect(toTranscript(typed)).toMatchObject({ mode: "text", submissionId: "sample" });
  });
});

describe("toSubmission", () => {
  it("uses the uploaded text and each question's private topic and snippet", () => {
    const s = toSubmission(record, {
      submissionId: "sub_aaaaaaaaaaaaaaaaaaaa", title: "T", fileName: "a.py", kind: "code", text: "def sort(): ...",
      plan: SAMPLE_PLAN, details: [{ id: "q1", topic: "Algorithm choice", snippet: "def sort():" }], createdAt: "2026-11-12T09:00:00.000Z",
    });
    expect(s.submittedText).toBe("def sort(): ...");
    expect(s.questions[0]).toMatchObject({ questionId: "q1", topic: "Algorithm choice", relevantCodeSnippet: "def sort():" });
    expect(s.questions[1].relevantCodeSnippet).toBe("");
  });

  it("works for the sample viva, with no submitted text", () => {
    const s = toSubmission({ ...record, submissionId: null }, null);
    expect(s).toMatchObject({ submissionId: "sample", submittedText: null });
    expect(s.questions).toHaveLength(SAMPLE_PLAN.questions.length);
  });
});
