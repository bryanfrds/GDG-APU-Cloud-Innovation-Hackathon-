// Shared settings for the voice viva. The server locks these into each token,
// so the browser can't swap the model or the examiner instructions.
// Server-only: LIVE_MODEL is read from the server environment. The page gets the
// model name from /api/viva/token, so don't import VIVA_MODEL into browser code.

export const VIVA_MODEL = process.env.LIVE_MODEL ?? "gemini-3.8-live";

// How long a token can start a new viva, and how much longer than the viva's
// own time limit the connection may stay open (to finish the last sentence).
export const TOKEN_START_WINDOW_MS = 60 * 1000; // must connect within 1 minute
export const SESSION_GRACE_MS = 2 * 60 * 1000;

// The examiner's instructions are built per viva in lib/viva/plan.ts.
