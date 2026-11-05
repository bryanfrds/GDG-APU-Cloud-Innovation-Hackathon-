// Builds the live transcript from Gemini's partial transcription chunks.
// Each speaker has at most one "open" line that new chunks append to, so a
// student's words that arrive late still join their own line, not the examiner's.

export type Speaker = "ai" | "student";
/**
 * `text` is what to show; `raw` is everything Gemini sent for the line, kept so cleanup can redo it.
 * `questionId` is the question being asked when the line started, and `atMs` is when it started
 * (milliseconds since the viva began). Both are set once, when the line is created.
 */
export type Line = { who: Speaker; text: string; raw: string; questionId: string | null; atMs: number };
/** Required, so a caller can't forget to tag a line. */
export type LineMeta = { questionId: string | null; atMs: number };
export type Transcript = { lines: Line[]; open: Record<Speaker, number | null> };

export const EMPTY_TRANSCRIPT: Transcript = { lines: [], open: { ai: null, student: null } };

// Gemini's transcription sometimes leaks internal language tags into the text,
// like "\u{1F9E0}[en]<already en>". They can arrive split across chunks, so cleanup always
// runs on the line's whole raw text: a half-arrived tag may show for one chunk,
// then disappears once the rest arrives. Every brain emoji is removed on purpose;
// speech-to-text doesn't produce it.
const JUNK = [
  /\u{1F9E0}\s*(\[[a-z]{2,3}(?:-[a-z]{2,4})?\])?/giu,
  /\[[a-z]{2,3}(?:-[a-z]{2,4})?\]\s*(?=<already\b)/giu,
  /<already [a-z]{2,3}(?:-[a-z]{2,4})?>/giu,
];

/** Removes Gemini's leaked tags from transcript text, and the extra spaces they leave. */
export function cleanTranscriptText(text: string): string {
  return JUNK.reduce((s, pattern) => s.replace(pattern, ""), text).replace(/ {2,}/g, " ");
}

function line(who: Speaker, raw: string, meta: { questionId: string | null; atMs: number }): Line {
  return { who, raw, text: cleanTranscriptText(raw).trimStart(), ...meta };
}

export function appendText(t: Transcript, who: Speaker, text: string, meta: LineMeta): Transcript {
  if (!text) return t;
  const i = t.open[who];
  if (i !== null) {
    const lines = t.lines.slice();
    const { questionId, atMs } = lines[i];
    lines[i] = line(who, lines[i].raw + text, { questionId, atMs });
    return { lines, open: t.open };
  }
  return {
    lines: [...t.lines, line(who, text, meta)],
    open: { ...t.open, [who]: t.lines.length },
  };
}

/** Close lines at a turn boundary, so the next chunk starts a new line. */
export function closeTurn(t: Transcript, how: "complete" | "interrupted"): Transcript {
  return {
    lines: t.lines,
    // When the student interrupts, they're still mid-sentence: keep their line open.
    open: { ai: null, student: how === "complete" ? null : t.open.student },
  };
}
