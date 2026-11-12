// Lecturer endpoints show students' transcripts, so they need the demo passcode too.
import { createRateLimiter } from "../viva/rate-limit";
import { clientAddress, passcodeOk } from "../viva/request-guard";

const readLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

/** Returns an error response, or null when the request may go ahead. */
export function lecturerGuard(req: Request, limiter = readLimiter): Response | null {
  // Students' transcripts: never public. On a real deploy with no passcode set, refuse rather than open up.
  if (process.env.NODE_ENV === "production" && !process.env.DEMO_PASSCODE) {
    return Response.json({ error: "Reports are turned off until DEMO_PASSCODE is set." }, { status: 503 });
  }
  if (!limiter.allow(clientAddress(req))) {
    return Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  }
  if (!passcodeOk(req)) return Response.json({ error: "Wrong or missing demo passcode." }, { status: 401 });
  return null;
}
