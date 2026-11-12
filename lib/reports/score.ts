// Turns a saved viva into Jie Lin's scoring inputs (src/lib/scoring), scores it with
// Gemini, and caches the report so the lecturer page doesn't pay for it twice.
import { kvGetJson, kvSetJson } from "../kv";
import { getSubmission, type Submission as SavedSubmission } from "../submissions/store";
import { turnsByQuestion, type VivaRecord } from "../viva/record";
import { scoreViva } from "../../src/lib/scoring/scoreViva";
import type { Submission, VivaReport, VivaTranscript } from "../../src/lib/scoring/types";

/** The scoring code's view of one viva: each question with what the student said. Exported for tests. */
export function toTranscript(record: VivaRecord): VivaTranscript {
  const answers = turnsByQuestion(record).map(({ questionId, turns }) => {
    const question = record.plan.questions.find((q) => q.id === questionId)!;
    const said = turns.filter((t) => t.who === "student");
    const asked = turns.filter((t) => t.who === "ai").length;
    const times = turns.map((t) => t.atMs);
    return {
      questionId,
      questionText: question.text,
      studentAnswer: said.map((t) => t.text).join(" "),
      followUpCount: Math.max(0, asked - 1),
      answerDurationMs: times.length ? Math.max(...times) - Math.min(...times) : 0,
    };
  });
  const typedOnly = record.turns.some((t) => t.who === "student") && record.turns.every((t) => t.who !== "student" || t.typed);
  return {
    vivaId: record.vivaId,
    submissionId: record.submissionId ?? "sample",
    studentId: "student",
    assignmentId: record.plan.assignmentTitle,
    attemptNumber: 1,
    startedAt: record.startedAt,
    completedAt: record.endedAt,
    mode: typedOnly ? "text" : "voice",
    answers,
  };
}

/** The scoring code's view of the submission. The sample viva has no uploaded work. Exported for tests. */
export function toSubmission(record: VivaRecord, saved: SavedSubmission | null): Submission {
  return {
    submissionId: record.submissionId ?? "sample",
    studentId: "student",
    assignmentId: record.plan.assignmentTitle,
    submittedAt: saved?.createdAt ?? record.startedAt,
    fileUrl: "",
    submittedText: saved?.text ?? null,
    questions: record.plan.questions.map((q) => {
      const detail = saved?.details.find((d) => d.id === q.id);
      return {
        questionId: q.id,
        questionText: q.text,
        relevantCodeSnippet: detail?.snippet ?? "",
        topic: detail?.topic || q.focus || q.id,
      };
    }),
  };
}

const reportKey = (vivaId: string) => `proveit:report:${vivaId}`;

export async function getCachedReport(vivaId: string): Promise<VivaReport | null> {
  return kvGetJson<VivaReport>(reportKey(vivaId));
}

/** Scores a saved viva (or returns the cached report). Tries twice, since Gemini is sometimes busy. */
export async function scoreRecord(record: VivaRecord): Promise<VivaReport> {
  const cached = await getCachedReport(record.vivaId);
  if (cached) return cached;
  const saved = record.submissionId ? await getSubmission(record.submissionId) : null;
  const transcript = toTranscript(record);
  const submission = toSubmission(record, saved);
  let report: VivaReport;
  try {
    report = await scoreViva(transcript, submission);
  } catch (err) {
    console.error("Scoring failed once, retrying", err instanceof Error ? err.message : err);
    report = await scoreViva(transcript, submission);
  }
  await kvSetJson(reportKey(record.vivaId), report);
  return report;
}
