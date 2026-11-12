"use client";

// Student upload: title + assignment file. The server reads it, Gemini writes viva
// questions about the student's own work, then the student starts their viva.
import { useState, type FormEvent } from "react";

type Question = { id: string; text: string };
type Ready = { submissionId: string; title: string; questions: Question[] };

const ACCEPT = ".pdf,.py,.java,.cpp,.c,.h,.js,.ts,.txt,.md";

export default function SubmitPage() {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<Ready | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!file) return setError("Choose your assignment file.");
    if (file.size > 2 * 1024 * 1024) return setError("That file is over 2 MB.");
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("file", file);
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: passcode ? { "x-demo-code": passcode } : {},
        body: form,
        signal: AbortSignal.timeout(70_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status}).`);
      try {
        if (passcode) sessionStorage.setItem("proveit-passcode", passcode);
      } catch {
        // storage blocked: the viva page asks for the passcode again
      }
      setReady({ submissionId: body.submissionId, title: body.plan.assignmentTitle, questions: body.plan.questions });
    } catch (err) {
      setError(
        err instanceof Error && err.name === "TimeoutError"
          ? "That took too long. Try again."
          : err instanceof Error
            ? err.message
            : "Upload failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <main style={styles.card}>
        <header style={styles.header}>
          <h1 style={styles.title}>Submit your assignment</h1>
          <p style={styles.subtitle}>
            Upload your work and Prove It writes viva questions about it. Then you answer them out loud.
          </p>
        </header>

        {ready ? (
          <section aria-live="polite">
            <p style={styles.success}>Your questions are ready for “{ready.title}”.</p>
            <ol style={styles.questions}>
              {ready.questions.map((q) => (
                <li key={q.id} style={styles.question}>
                  {q.text}
                </li>
              ))}
            </ol>
            <p style={styles.hint}>
              The examiner asks these one by one and may follow up. Use headphones if you can.
            </p>
            <a href={`/viva-test?submission=${encodeURIComponent(ready.submissionId)}`} style={styles.primary}>
              Start my viva
            </a>
          </section>
        ) : (
          <form onSubmit={submit} style={styles.form}>
            <label style={styles.label}>
              Assignment title
              <input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Library system (OOP Assignment 1)"
                style={styles.input}
              />
            </label>
            <label style={styles.label}>
              <span>
                File <span style={styles.optional}>(PDF with selectable text, or code; up to 2 MB)</span>
              </span>
              <input
                required
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={styles.input}
              />
            </label>
            <label style={styles.label}>
              <span>
                Demo passcode <span style={styles.optional}>(if your lecturer gave you one)</span>
              </span>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoComplete="off"
                style={styles.input}
              />
            </label>
            {error && (
              <p role="alert" style={styles.error}>
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} style={{ ...styles.primary, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Reading your work and writing questions…" : "Upload and get my questions"}
            </button>
            {busy && <p style={styles.hint}>This usually takes 10–30 seconds.</p>}
          </form>
        )}

        <footer style={styles.footer}>
          <a href="/">Home</a>
        </footer>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", padding: "24px 16px", fontFamily: "system-ui, sans-serif", color: "#0f172a" },
  card: { maxWidth: 640, margin: "0 auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24 },
  header: { borderBottom: "1px solid #e2e8f0", paddingBottom: 16, marginBottom: 20 },
  title: { margin: 0, fontSize: 24, fontWeight: 700 },
  subtitle: { margin: "6px 0 0", fontSize: 14, color: "#475569" },
  form: { display: "grid", gap: 16 },
  label: { display: "grid", gap: 6, fontSize: 14, fontWeight: 600 },
  optional: { fontWeight: 400, color: "#64748b" },
  input: { font: "inherit", fontWeight: 400, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff" },
  primary: {
    display: "inline-block", justifySelf: "start", font: "inherit", fontWeight: 600, padding: "10px 18px",
    background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", textDecoration: "none",
  },
  error: { margin: 0, padding: "10px 12px", background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 6, fontSize: 14 },
  success: { margin: "0 0 12px", fontWeight: 600 },
  questions: { margin: "0 0 16px", paddingLeft: 20, display: "grid", gap: 10 },
  question: { lineHeight: 1.5 },
  hint: { margin: "0 0 16px", fontSize: 14, color: "#475569" },
  footer: { marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0", fontSize: 14 },
};
