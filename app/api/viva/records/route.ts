// Saves a finished viva. The record must belong to a viva this server started:
// its plan and mode must match what was locked into that viva's pass, and each
// viva can be saved only once.
import { SESSION_GRACE_MS, TOKEN_START_WINDOW_MS } from "@/lib/viva/config";
import { MODE_SECONDS } from "@/lib/viva/plan";
import { createRateLimiter } from "@/lib/viva/rate-limit";
import { parseRecord } from "@/lib/viva/record";
import { clientAddress, passcodeOk, readJsonBody } from "@/lib/viva/request-guard";
import { getSession, saveRecordOnce } from "@/lib/viva/store";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

// 300 turns of up to 4,000 characters, in UTF-8, plus the plan: a real record stays
// well under this; anything bigger isn't one.
const MAX_BODY_BYTES = 2_000_000;

// How far the browser's clock may be from ours.
const CLOCK_SLACK_MS = 2 * 60 * 1000;

export async function POST(req: Request) {
  if (!passcodeOk(req)) {
    return Response.json({ error: "Wrong or missing demo passcode." }, { status: 401 });
  }
  if (!limiter.allow(clientAddress(req))) {
    return Response.json({ error: "Too many saves. Wait a minute and try again." }, { status: 429 });
  }

  const read = await readJsonBody(req, MAX_BODY_BYTES);
  if ("error" in read) return Response.json({ error: read.error }, { status: read.status });

  const parsed = parseRecord(read.body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const record = parsed.record;

  const session = await getSession(record.vivaId);
  if (!session) return Response.json({ error: "This viva wasn't started on this server." }, { status: 404 });

  // Don't trust the browser's copy of what the viva was about.
  if (record.mode !== session.mode || JSON.stringify(record.plan) !== JSON.stringify(session.plan)) {
    return Response.json({ error: "The record doesn't match the viva that was started." }, { status: 409 });
  }

  // The viva must have started after its pass was issued, within the time allowed to connect.
  const issued = Date.parse(session.issuedAt);
  const started = Date.parse(record.startedAt);
  const ended = Date.parse(record.endedAt);
  const latestEnd = issued + TOKEN_START_WINDOW_MS + MODE_SECONDS[session.mode] * 1000 + SESSION_GRACE_MS;
  if (started < issued - CLOCK_SLACK_MS || started > issued + TOKEN_START_WINDOW_MS + CLOCK_SLACK_MS) {
    return Response.json({ error: "The viva's start time doesn't match when it was started." }, { status: 409 });
  }
  if (ended > latestEnd + CLOCK_SLACK_MS) {
    return Response.json({ error: "The viva ended later than its pass allowed." }, { status: 409 });
  }

  const saved = await saveRecordOnce({ ...record, receivedAt: new Date().toISOString() });
  if (!saved) return Response.json({ error: "This viva has already been saved." }, { status: 409 });

  return Response.json({ ok: true, vivaId: record.vivaId }, { status: 201 });
}
