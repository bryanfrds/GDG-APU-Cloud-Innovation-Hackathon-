// Saved submissions: the student's title, extracted text and the questions Gemini wrote.
import { randomBytes } from "node:crypto";
import { kvGetJson, kvList, kvListAdd, kvSetJson } from "../kv";
import type { VivaPlan } from "../viva/plan";
import type { QuestionDetail } from "./generate";

export type Submission = {
  submissionId: string;
  title: string;
  fileName: string;
  kind: "pdf" | "code";
  /** The extracted assignment text. Private: for scoring, never sent to the student's browser. */
  text: string;
  plan: VivaPlan;
  /** Private per-question topic and the part of the work it's about, for scoring. */
  details: QuestionDetail[];
  createdAt: string;
};

const SUBMISSION_ID = /^sub_[0-9a-f]{20}$/;

export function newSubmissionId(): string {
  return `sub_${randomBytes(10).toString("hex")}`;
}

export function isLocalSubmissionId(id: unknown): id is string {
  return typeof id === "string" && SUBMISSION_ID.test(id);
}

export async function saveSubmission(s: Submission): Promise<void> {
  await kvSetJson(`proveit:submission:${s.submissionId}`, s);
  await kvListAdd("proveit:submissions", s.submissionId);
}

export async function getSubmission(id: string): Promise<Submission | null> {
  if (!isLocalSubmissionId(id)) return null;
  return kvGetJson<Submission>(`proveit:submission:${id}`);
}

export async function listSubmissionIds(limit = 200): Promise<string[]> {
  return kvList("proveit:submissions", limit);
}
