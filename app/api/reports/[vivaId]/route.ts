// GET  /api/reports/:vivaId  the saved viva and its report, if scored already.
// POST /api/reports/:vivaId  scores it with Gemini (cached after the first time).
import { lecturerGuard } from "@/lib/reports/guard";
import { getCachedReport, scoreRecord } from "@/lib/reports/score";
import { createRateLimiter } from "@/lib/viva/rate-limit";
import { getRecord } from "@/lib/viva/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // one Gemini call per question, plus the consistency check

// Scoring costs several Gemini calls: 6 a minute from one address.
const scoreLimiter = createRateLimiter({ limit: 6, windowMs: 60_000 });

type Ctx = { params: Promise<{ vivaId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const blocked = lecturerGuard(req);
  if (blocked) return blocked;
  const { vivaId } = await ctx.params;
  const record = await getRecord(vivaId);
  if (!record) return Response.json({ error: "No saved viva with that id." }, { status: 404 });
  const report = await getCachedReport(vivaId);
  return Response.json({ record, report }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, ctx: Ctx) {
  const blocked = lecturerGuard(req, scoreLimiter);
  if (blocked) return blocked;
  const { vivaId } = await ctx.params;
  const record = await getRecord(vivaId);
  if (!record) return Response.json({ error: "No saved viva with that id." }, { status: 404 });
  if (!record.turns.some((t) => t.who === "student" && t.text.trim())) {
    return Response.json({ error: "The student didn't answer anything, so there's nothing to score." }, { status: 422 });
  }
  try {
    const report = await scoreRecord(record);
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Scoring failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't score this viva right now. Try again in a minute." }, { status: 502 });
  }
}
