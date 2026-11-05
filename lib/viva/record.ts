// What a finished viva is saved as: whose viva it was, the plan it followed, how
// it ended, and every line said, each tagged with the question it belongs to.
// Person 3's scoring reads these. The page builds a record with buildRecord();
// the server checks anything it receives with parseRecord() before storing it.
//
// buildRecord() applies the same limits parseRecord() checks, so a record the
// page builds is always accepted and a long viva is never lost.
//
// The transcript comes from the browser, so it can be faked: treat it as what the
// student's browser reported, never as proof. See docs/viva-record.md.
import { MODE_SECONDS, parseMode, parsePlan, stripHiddenChars, type VivaMode, type VivaPlan } from "./plan";
import type { Speaker, Transcript } from "./transcript";

export type EndReason = "completed" | "time_up" | "session_ended" | "stopped" | "error";
const END_REASONS: EndReason[] = ["completed", "time_up", "session_ended", "stopped", "error"];

export type RecordTurn = {
  who: Speaker;
  text: string;
  /** The question being asked when this was said, or null before the first question. */
  questionId: string | null;
  /** Milliseconds since the viva started. Never goes down from one turn to the next. */
  atMs: number;
  /** Present (true) when the student typed this instead of speaking it. Typed answers could be pasted. */
  typed?: true;
};

export type VivaRecord = {
  version: 1;
  /** Issued by the server with the one-time pass; ties the record to the plan the server locked in. */
  vivaId: string;
  /** The student's submission this viva is about. Null until Person 1's submissions exist. */
  submissionId: string | null;
  mode: VivaMode;
  plan: VivaPlan;
  startedAt: string;
  endedAt: string;
  endReason: EndReason;
  /** True if the viva was so long that some turns had to be left out. */
  truncated: boolean;
  turns: RecordTurn[];
};

/** Slack beyond the viva's own time limit: connecting, the closing sentence, and clock drift. */
const DURATION_SLACK_MS = 4 * 60 * 1000;
export const RECORD_LIMITS = { turns: 300, text: 4000 };

export function maxDurationMs(mode: VivaMode) {
  return MODE_SECONDS[mode] * 1000 + DURATION_SLACK_MS;
}

export function buildRecord(input: {
  vivaId: string;
  submissionId?: string | null;
  mode: VivaMode;
  plan: VivaPlan;
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
  transcript: Transcript;
}): VivaRecord {
  // Whole milliseconds only: ISO times can't hold fractions, and the server
  // checks turn times against the duration it reads back from them.
  const startedAt = Math.round(input.startedAt);
  const limit = maxDurationMs(input.mode);
  const endedAt = Math.min(Math.max(Math.round(input.endedAt), startedAt), startedAt + limit);
  const durationMs = endedAt - startedAt;

  const turns: RecordTurn[] = [];
  let lastAt = 0;
  for (const line of input.transcript.lines) {
    const text = stripHiddenChars(line.text).trim();
    if (!text) continue;
    const atMs = Math.min(durationMs, Math.max(lastAt, Math.round(line.atMs)));
    lastAt = atMs;
    for (const piece of splitText(text, RECORD_LIMITS.text)) {
      turns.push({ who: line.who, text: piece, questionId: line.questionId, atMs, ...(line.typed ? { typed: true as const } : {}) });
    }
  }

  return {
    version: 1,
    vivaId: input.vivaId,
    submissionId: input.submissionId ?? null,
    mode: input.mode,
    plan: input.plan,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    endReason: input.endReason,
    truncated: turns.length > RECORD_LIMITS.turns,
    turns: turns.slice(0, RECORD_LIMITS.turns),
  };
}

/** Splits long text into pieces of at most `max` characters, at a space where possible. */
function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) {
      // No good space: cut mid-word, but never between the two halves of an emoji.
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Groups turns under each planned question, in plan order, for scoring. Turns before the first question are left out. */
export function turnsByQuestion(record: VivaRecord): { questionId: string; turns: RecordTurn[] }[] {
  return record.plan.questions.map((q) => ({
    questionId: q.id,
    turns: record.turns.filter((t) => t.questionId === q.id),
  }));
}

const ID_PATTERN = /^[a-z0-9_-]{8,64}$/i;

/** Checks a record sent by the browser. Returns the clean record or an error message. */
export function parseRecord(input: unknown, now = Date.now()): { record: VivaRecord } | { error: string } {
  if (!input || typeof input !== "object") return { error: "The viva record is missing." };
  const r = input as Record<string, unknown>;
  if (r.version !== 1) return { error: "Unknown viva record version." };
  if (typeof r.vivaId !== "string" || !ID_PATTERN.test(r.vivaId)) return { error: "The viva id is missing or invalid." };
  if (r.submissionId != null && (typeof r.submissionId !== "string" || !ID_PATTERN.test(r.submissionId))) {
    return { error: "The submission id is invalid." };
  }

  const plan = parsePlan(r.plan);
  if ("error" in plan) return { error: `Plan: ${plan.error}` };
  if (r.mode !== "full" && r.mode !== "demo") return { error: "The mode must be full or demo." };
  const mode = parseMode(r.mode);

  const started = isoTime(r.startedAt);
  const ended = isoTime(r.endedAt);
  if (started === null || ended === null) return { error: "Start and end times must be ISO dates with a time zone." };
  if (ended < started) return { error: "The viva can't end before it starts." };
  if (ended > now + 5 * 60 * 1000) return { error: "The viva can't end in the future." };
  const durationMs = ended - started;
  if (durationMs > maxDurationMs(mode)) return { error: `The viva is longer than a ${mode} viva can be.` };

  if (!END_REASONS.includes(r.endReason as EndReason)) return { error: "Unknown end reason." };
  if (typeof r.truncated !== "boolean") return { error: "truncated must be true or false." };
  if (!Array.isArray(r.turns)) return { error: "Turns must be a list." };
  if (r.turns.length > RECORD_LIMITS.turns) return { error: `A viva can have at most ${RECORD_LIMITS.turns} turns.` };

  const ids = new Set(plan.plan.questions.map((q) => q.id));
  const turns: RecordTurn[] = [];
  let lastAt = 0;
  for (const [i, t] of r.turns.entries()) {
    const { who, text, questionId, atMs, typed } = (t ?? {}) as Record<string, unknown>;
    if (who !== "ai" && who !== "student") return { error: `Turn ${i + 1}: who must be ai or student.` };
    if (typed !== undefined && !(typed === true && who === "student")) {
      return { error: `Turn ${i + 1}: only a student turn can be marked typed.` };
    }
    // Refuse huge raw text before cleaning it, so padding with hidden characters can't make us do lots of work.
    if (typeof text === "string" && text.length > RECORD_LIMITS.text * 2) {
      return { error: `Turn ${i + 1}: text must be 1–${RECORD_LIMITS.text} characters.` };
    }
    const clean = typeof text === "string" ? stripHiddenChars(text).trim() : "";
    if (!clean || clean.length > RECORD_LIMITS.text) {
      return { error: `Turn ${i + 1}: text must be 1–${RECORD_LIMITS.text} characters.` };
    }
    if (questionId !== null && (typeof questionId !== "string" || !ids.has(questionId))) {
      return { error: `Turn ${i + 1}: question "${String(questionId)}" isn't in the plan.` };
    }
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < lastAt || atMs > durationMs) {
      return { error: `Turn ${i + 1}: atMs must be within the viva and not before the previous turn.` };
    }
    lastAt = atMs;
    turns.push({ who, text: clean, questionId, atMs: Math.round(atMs), ...(typed === true ? { typed: true as const } : {}) });
  }

  return {
    record: {
      version: 1,
      vivaId: r.vivaId,
      submissionId: (r.submissionId as string | null | undefined) ?? null,
      mode,
      plan: plan.plan,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      endReason: r.endReason as EndReason,
      truncated: r.truncated,
      turns,
    },
  };
}

/** Accepts only full ISO times with a time zone (Z or ±hh:mm). */
function isoTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}
