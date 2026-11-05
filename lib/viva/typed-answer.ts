// Typing instead of speaking: for slow Wi-Fi, a noisy room, or students who prefer it.
// A typed answer goes into the same live viva as a normal user turn, so the
// examiner replies to it exactly as it would to speech.
import type { LiveSendClientContentParameters } from "@google/genai";
import { stripHiddenChars } from "./plan";

export const MAX_TYPED_CHARS = 1000;

/** Cleans a typed answer. Returns the text to send, or why it can't be sent. */
export function prepareTypedAnswer(input: string): { text: string } | { error: string } {
  const text = stripHiddenChars(input).trim();
  if (!text) return { error: "Type an answer first." };
  if (text.length > MAX_TYPED_CHARS) return { error: `Keep it under ${MAX_TYPED_CHARS} characters.` };
  return { text };
}

/** The message that hands a typed answer to the examiner. */
export function typedAnswerMessage(text: string): LiveSendClientContentParameters {
  return { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true };
}
