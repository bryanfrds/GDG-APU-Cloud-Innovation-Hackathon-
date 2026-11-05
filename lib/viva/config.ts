// Shared settings for the voice viva. The server locks these into each token,
// so the browser can't swap the model or the examiner instructions.
// Server-only: LIVE_MODEL is read from the server environment. The page gets the
// model name from /api/viva/token, so don't import VIVA_MODEL into browser code.

export const VIVA_MODEL = process.env.LIVE_MODEL ?? "gemini-3.8-live";

// How long a token can start a new viva, and how long a viva can run on it.
export const TOKEN_START_WINDOW_MS = 60 * 1000; // must connect within 1 minute
export const TOKEN_SESSION_MS = 10 * 60 * 1000; // a viva can last up to 10 minutes

export const EXAMINER_INSTRUCTIONS =
  "You are an examiner running a short, friendly viva about a student's assignment. " +
  "Ask one question at a time and keep each question short.";
