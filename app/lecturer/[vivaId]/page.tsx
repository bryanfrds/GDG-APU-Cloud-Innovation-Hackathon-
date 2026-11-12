"use client";

// One student's viva: score per question, the "answers didn't match the work" check,
// and the full transcript. Scoring runs on demand and is cached.
import { use, useEffect, useState } from "react";
import { END_REASON, LABEL_COLOURS, rememberPasscode, savedPasscode, ui, when } from "@/lib/reports/ui";
import type { VivaRecord } from "@/lib/viva/record";
import type { VivaReport } from "@/src/lib/scoring/types";

export default function VivaReportPage({ params }: { params: Promise<{ vivaId: string }> }) {
  const { vivaId } = use(params);
  const [passcode, setPasscode] = useState("");
  const [record, setRecord] = useState<VivaRecord | null>(null);
  const [report, setReport] = useState<VivaReport | null>(null);
  const [error, setError] = useState("");
  const [scoring, setScoring] = useState(false);

  async function load(code: string) {
    setError("");
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(vivaId)}`, {
        headers: code ? { "x-demo-code": code } : {},
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? `Couldn't load this viva (${res.status}).`);
      rememberPasscode(code);
      setRecord(body.record);
      setReport(body.report);
    } catch {
      setError("Couldn't reach the server. Check your internet and try again.");
    }
  }

  async function score() {
    if (scoring) return;
    setScoring(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(vivaId)}`, {
        method: "POST",
        headers: passcode ? { "x-demo-code": passcode } : {},
        signal: AbortSignal.timeout(70_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.error ?? (res.status === 504 ? "Scoring took too long. Try again." : `Scoring failed (${res.status}).`),
        );
      }
      setReport(body.report);
    } catch (err) {
      setError(err instanceof Error && err.name !== "TimeoutError" ? err.message : "Scoring took too long. Try again.");
    } finally {
      setScoring(false);
    }
  }

  useEffect(() => {
    const code = savedPasscode();
    setPasscode(code);
    void load(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vivaId]);

  const scoreFor = (id: string) => report?.scoredAnswers.find((a) => a.questionId === id);
  const label = report ? LABEL_COLOURS[report.scoreLabel] : null;

  return (
    <div style={ui.page}>
      <main style={ui.card}>
        <p style={{ margin: "0 0 12px", fontSize: 14 }}>
          <a href="/lecturer">← All vivas</a>
        </p>

        {error && (
          <p role="alert" style={ui.error}>
            {error}
          </p>
        )}

        {!record ? (
          <form
            style={ui.row}
            onSubmit={(e) => {
              e.preventDefault();
              void load(passcode);
            }}
          >
            <label style={ui.muted} htmlFor="passcode">
              Demo passcode
            </label>
            <input id="passcode" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} style={ui.input} />
            <button type="submit" style={ui.button}>
              Open
            </button>
          </form>
        ) : (
          <>
            <header style={ui.header}>
              <h1 style={ui.title}>{record.plan.assignmentTitle}</h1>
              <p style={ui.subtitle}>
                {when(record.startedAt)} · {record.mode === "demo" ? "30-second demo" : "Full viva"} ·{" "}
                {END_REASON[record.endReason] ?? record.endReason}
                {!record.submissionId && " · sample questions"}
              </p>
            </header>

            <section style={{ ...ui.row, justifyContent: "space-between", marginBottom: 16 }}>
              {report ? (
                <div style={ui.row}>
                  <span style={{ fontSize: 40, fontWeight: 700 }}>{Math.round(report.overallScore)}</span>
                  <span style={ui.muted}>/ 100</span>
                  <span style={{ ...ui.pill, background: label?.bg, color: label?.fg }}>{report.scoreLabel}</span>
                </div>
              ) : (
                <p style={{ ...ui.muted, margin: 0 }}>Not scored yet.</p>
              )}
              {!report && (
                <button type="button" style={{ ...ui.button, opacity: scoring ? 0.6 : 1 }} onClick={score} disabled={scoring}>
                  {scoring ? "Scoring with Gemini… (about 20 s)" : "Score this viva"}
                </button>
              )}
            </section>

            {report?.inconsistency.flagged && (
              <div role="note" style={{ ...ui.error, background: "#fff7ed", color: "#9a3412", borderColor: "#fed7aa" }}>
                <strong>The answers given in the viva didn&apos;t match the submitted work</strong>
                {report.inconsistency.severity ? ` (${report.inconsistency.severity})` : ""}. {report.inconsistency.evidence}
                <br />
                Worth a closer look; it isn&apos;t proof on its own.
              </div>
            )}

            <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>Questions</h2>
            <ol style={{ paddingLeft: 20, display: "grid", gap: 16, margin: 0 }}>
              {record.plan.questions.map((q) => {
                const turns = record.turns.filter((t) => t.questionId === q.id && t.who === "student");
                const s = scoreFor(q.id);
                return (
                  <li key={q.id}>
                    <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{q.text}</p>
                    {turns.length === 0 ? (
                      <p style={ui.muted}>No answer.</p>
                    ) : (
                      turns.map((t, i) => (
                        <p key={i} style={{ margin: "0 0 4px", lineHeight: 1.5 }}>
                          {t.typed && <span style={{ ...ui.pill, background: "#e0e7ff", color: "#3730a3", marginRight: 6 }}>typed</span>}
                          {t.text}
                        </p>
                      ))
                    )}
                    {s && (
                      <p style={{ margin: "6px 0 0", fontSize: 14 }}>
                        <strong>{s.score}/10</strong> <span style={ui.muted}>· {s.feedback}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>

            <details style={{ marginTop: 24 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Full transcript</summary>
              <div style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 14 }}>
                {record.turns.map((t, i) => (
                  <p key={i} style={{ margin: 0 }}>
                    <strong>{t.who === "ai" ? "Examiner" : "Student"}:</strong> {t.text}
                    {t.typed && <span style={ui.muted}> (typed)</span>}
                  </p>
                ))}
              </div>
            </details>

            <p style={{ ...ui.muted, marginTop: 24 }}>
              The transcript comes from the student&apos;s browser. Typed answers could have been pasted. Use the score
              as a guide, not a verdict.
            </p>
          </>
        )}

        <footer style={ui.footer}>
          <a href="/">Home</a>
        </footer>
      </main>
    </div>
  );
}
