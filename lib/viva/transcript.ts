// Builds the live transcript from Gemini's partial transcription chunks.
// Each speaker has at most one "open" line that new chunks append to, so a
// student's words that arrive late still join their own line, not the examiner's.

export type Speaker = "ai" | "student";
export type Line = { who: Speaker; text: string };
export type Transcript = { lines: Line[]; open: Record<Speaker, number | null> };

export const EMPTY_TRANSCRIPT: Transcript = { lines: [], open: { ai: null, student: null } };

// Gemini's transcription sometimes leaks internal language tags into the text,
// like "\u{1F9E0}[en]<already en>". They can arrive split across chunks, so this runs on
// the whole line each time, and the parts are matched separately.
const JUNK = [
  /\u{1F9E0}\s*(\[[a-z]{2,3}(?:-[a-z]{2,4})?\])?\s?/giu,
  /\[[a-z]{2,3}(?:-[a-z]{2,4})?\]\s*(?=<already\b)/giu,
  /<already [a-z]{2,3}(?:-[a-z]{2,4})?>/giu,
];

/** Removes Gemini's leaked tags from transcript text. */
export function cleanTranscriptText(text: string): string {
  return JUNK.reduce((s, pattern) => s.replace(pattern, ""), text);
}

export function appendText(t: Transcript, who: Speaker, text: string): Transcript {
  if (!text) return t;
  const i = t.open[who];
  if (i !== null) {
    const lines = t.lines.slice();
    const joined = cleanTranscriptText(lines[i].text + text);
    lines[i] = { who, text: lines[i].text ? joined : joined.trimStart() };
    return { lines, open: t.open };
  }
  return {
    lines: [...t.lines, { who, text: cleanTranscriptText(text).trimStart() }],
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
