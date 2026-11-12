"use client";

// Lecturer view: every saved viva, newest first, with scores and flags.
import { useEffect, useState } from "react";
import { END_REASON, LABEL_COLOURS, rememberPasscode, savedPasscode, ui, when } from "@/lib/reports/ui";

type Row = {
  vivaId: string;
  assignmentTitle: string;
  sample: boolean;
  mode: "full" | "demo";
  endReason: string;
  startedAt: string;
  answers: number;
  typedAnswers: number;
  score: { overall: number; label: string; flagged: boolean } | null;
};

export default function LecturerPage() {
  const [passcode, setPasscode] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(code: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/reports", { headers: code ? { "x-demo-code": code } : {}, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Couldn't load vivas (${res.status}).`);
      rememberPasscode(code);
      setRows(body.vivas);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load vivas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const code = savedPasscode();
    setPasscode(code);
    void load(code);
  }, []);

  const scored = (rows ?? []).filter((r) => r.score);
  const average = scored.length ? scored.reduce((s, r) => s + r.score!.overall, 0) / scored.length : null;

  return (
    <div style={ui.page}>
      <main style={ui.card}>
        <header style={ui.header}>
          <h1 style={ui.title}>Lecturer reports</h1>
          <p style={ui.subtitle}>Every viva students have finished. Open one to see the answers and score it.</p>
        </header>

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
          <button type="submit" style={ui.button} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </form>
        {error && (
          <p role="alert" style={ui.error}>
            {error}
          </p>
        )}

        {rows && (
          <>
            <section style={ui.stats} aria-label="Class summary">
              <div style={ui.stat}>
                <div style={ui.statValue}>{rows.length}</div>
                <div style={ui.muted}>vivas finished</div>
              </div>
              <div style={ui.stat}>
                <div style={ui.statValue}>{average === null ? "–" : Math.round(average)}</div>
                <div style={ui.muted}>average score ({scored.length} scored)</div>
              </div>
              <div style={ui.stat}>
                <div style={ui.statValue}>{scored.filter((r) => r.score!.label === "Needs Review").length}</div>
                <div style={ui.muted}>need review</div>
              </div>
              <div style={ui.stat}>
                <div style={ui.statValue}>{scored.filter((r) => r.score!.flagged).length}</div>
                <div style={ui.muted}>answers didn&apos;t match the work</div>
              </div>
            </section>

            {rows.length === 0 ? (
              <p style={ui.muted}>No vivas yet. They appear here once a student finishes one.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#475569" }}>
                      <th style={th}>When</th>
                      <th style={th}>Assignment</th>
                      <th style={th}>Answers</th>
                      <th style={th}>Ended</th>
                      <th style={th}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.vivaId} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={td}>{when(r.startedAt)}</td>
                        <td style={td}>
                          <a href={`/lecturer/${r.vivaId}`}>{r.assignmentTitle}</a>
                          {r.sample && <span style={{ ...ui.muted, marginLeft: 6 }}>(sample)</span>}
                          {r.mode === "demo" && <span style={{ ...ui.muted, marginLeft: 6 }}>(30 s demo)</span>}
                        </td>
                        <td style={td}>
                          {r.answers}
                          {r.typedAnswers > 0 && <span style={ui.muted}> ({r.typedAnswers} typed)</span>}
                        </td>
                        <td style={td}>{END_REASON[r.endReason] ?? r.endReason}</td>
                        <td style={td}>
                          {r.score ? (
                            <span style={{ ...ui.pill, background: LABEL_COLOURS[r.score.label]?.bg, color: LABEL_COLOURS[r.score.label]?.fg }}>
                              {Math.round(r.score.overall)} · {r.score.label}
                              {r.score.flagged ? " · ⚑" : ""}
                            </span>
                          ) : (
                            <a href={`/lecturer/${r.vivaId}`}>Score it</a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <footer style={ui.footer}>
          <a href="/">Home</a>
        </footer>
      </main>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 8px 8px 0", fontWeight: 600 };
const td: React.CSSProperties = { padding: "10px 8px 10px 0", verticalAlign: "top" };
