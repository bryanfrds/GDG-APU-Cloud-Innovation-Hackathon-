// What a finished viva is saved as: the plan it followed, how it ended, and every
// line said, each tagged with the question it belongs to. Person 3's scoring
// reads these. The page builds a record with buildRecord(); the server checks
// anything it receives with parseRecord() before storing it.
import { parseMode, parsePlan, type VivaMode, type VivaPlan } from "./plan";
import type { Speaker, Transcript } from "./transcript";

export type EndReason = "completed" | "time_up" | "session_ended" | "stopped" | "error";
const END_REASONS: EndReason[] = ["completed", "time_up", "session_ended", "stopped", "error"];

export type RecordTurn = {
  who: Speaker;
  text: string;
  /** The question being asked when this was said, or null before the first question. */
  questionId: string | null;
  /** Milliseconds since the viva started. */
  atMs: number;
};

export type VivaRecord = {
  version: 1;
  mode: VivaMode;
  plan: VivaPlan;
  startedAt: string;
  endedAt: string;
  endReason: EndReason;
  turns: RecordTurn[];
};

export const RECORD_LIMITS = { turns: 300, text: 4000, durationMs: 30 * 60 * 1000 };

export function buildRecord(input: {
  mode: VivaMode;
  plan: VivaPlan;
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
  transcript: Transcript;
}): VivaRecord {
  return {
    version: 1,
    mode: input.mode,
    plan: input.plan,
    startedAt: new Date(input.startedAt).toISOString(),
    endedAt: new Date(input.endedAt).toISOString(),
    endReason: input.endReason,
    turns: input.transcript.lines
      .filter((l) => l.text.trim())
      .map((l) => ({ who: l.who, text: l.text.trim(), questionId: l.questionId, atMs: Math.max(0, Math.round(l.atMs)) })),
  };
}

/** Groups what was said by question, in plan order, for scoring. Lines before the first question are left out. */
export function turnsByQuestion(record: VivaRecord): { questionId: string; turns: RecordTurn[] }[] {
  return record.plan.questions.map((q) => ({
    questionId: q.id,
    turns: record.turns.filter((t) => t.questionId === q.id),
  }));
}

/** Checks a record sent by the browser. Returns the clean record or an error message. */
export function parseRecord(input: unknown): { record: VivaRecord } | { error: string } {
  if (!input || typeof input !== "object") return { error: "The viva record is missing." };
  const r = input as Record<string, unknown>;
  if (r.version !== 1) return { error: "Unknown viva record version." };

  const plan = parsePlan(r.plan);
  if ("error" in plan) return { error: `Plan: ${plan.error}` };
  if (r.mode !== "full" && r.mode !== "demo") return { error: "The mode must be full or demo." };

  const started = isoTime(r.startedAt);
  const ended = isoTime(r.endedAt);
  if (started === null || ended === null) return { error: "Start and end times must be ISO dates." };
  if (ended < started) return { error: "The viva can't end before it starts." };
  if (ended - started > RECORD_LIMITS.durationMs) return { error: "The viva is longer than 30 minutes." };

  if (!END_REASONS.includes(r.endReason as EndReason)) return { error: "Unknown end reason." };
  if (!Array.isArray(r.turns)) return { error: "Turns must be a list." };
  if (r.turns.length > RECORD_LIMITS.turns) return { error: `A viva can have at most ${RECORD_LIMITS.turns} turns.` };

  const ids = new Set(plan.plan.questions.map((q) => q.id));
  const turns: RecordTurn[] = [];
  for (const [i, t] of r.turns.entries()) {
    const { who, text, questionId, atMs } = (t ?? {}) as Record<string, unknown>;
    if (who !== "ai" && who !== "student") return { error: `Turn ${i + 1}: who must be ai or student.` };
    if (typeof text !== "string" || !text.trim() || text.length > RECORD_LIMITS.text) {
      return { error: `Turn ${i + 1}: text must be 1–${RECORD_LIMITS.text} characters.` };
    }
    if (questionId !== null && (typeof questionId !== "string" || !ids.has(questionId))) {
      return { error: `Turn ${i + 1}: question "${String(questionId)}" isn't in the plan.` };
    }
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0 || atMs > RECORD_LIMITS.durationMs) {
      return { error: `Turn ${i + 1}: atMs must be a time within the viva.` };
    }
    turns.push({ who, text: text.trim(), questionId, atMs: Math.round(atMs) });
  }

  return {
    record: {
      version: 1,
      mode: parseMode(r.mode),
      plan: plan.plan,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      endReason: r.endReason as EndReason,
      turns,
    },
  };
}

function isoTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}
