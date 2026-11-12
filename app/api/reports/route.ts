// GET /api/reports: the saved vivas, newest first, with each one's score if it has been scored.
import { kvList } from "@/lib/kv";
import { lecturerGuard } from "@/lib/reports/guard";
import { getCachedReport } from "@/lib/reports/score";
import { getRecord } from "@/lib/viva/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = lecturerGuard(req);
  if (blocked) return blocked;

  const ids = await kvList("proveit:vivas", 100);
  const rows = await Promise.all(
    ids.map(async (vivaId) => {
      const [record, report] = await Promise.all([getRecord(vivaId), getCachedReport(vivaId)]);
      if (!record) return null;
      const student = record.turns.filter((t) => t.who === "student");
      return {
        vivaId,
        assignmentTitle: record.plan.assignmentTitle,
        sample: !record.submissionId,
        mode: record.mode,
        endReason: record.endReason,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        answers: student.length,
        typedAnswers: student.filter((t) => t.typed).length,
        score: report ? { overall: report.overallScore, label: report.scoreLabel, flagged: report.inconsistency.flagged } : null,
      };
    }),
  );
  return Response.json({ vivas: rows.filter(Boolean) }, { headers: { "Cache-Control": "no-store" } });
}
