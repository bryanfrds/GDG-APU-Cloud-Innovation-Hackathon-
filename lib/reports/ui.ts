// Shared bits for the lecturer pages (client side).
import type React from "react";

export function savedPasscode(): string {
  try {
    return sessionStorage.getItem("proveit-passcode") ?? "";
  } catch {
    return "";
  }
}

export function rememberPasscode(code: string) {
  try {
    if (code) sessionStorage.setItem("proveit-passcode", code);
  } catch {
    // storage blocked: asked again next time
  }
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}

export const END_REASON: Record<string, string> = {
  completed: "Finished",
  time_up: "Time ran out",
  session_ended: "Connection ended",
  stopped: "Student ended it",
  error: "Error",
};

export const LABEL_COLOURS: Record<string, { bg: string; fg: string }> = {
  Strong: { bg: "#dcfce7", fg: "#166534" },
  Adequate: { bg: "#fef9c3", fg: "#854d0e" },
  "Needs Review": { bg: "#fee2e2", fg: "#991b1b" },
};

export const ui: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", padding: "24px 16px", fontFamily: "system-ui, sans-serif", color: "#0f172a" },
  card: { maxWidth: 880, margin: "0 auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24 },
  title: { margin: 0, fontSize: 24, fontWeight: 700 },
  subtitle: { margin: "6px 0 0", fontSize: 14, color: "#475569" },
  header: { borderBottom: "1px solid #e2e8f0", paddingBottom: 16, marginBottom: 20 },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: { font: "inherit", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 0 },
  button: { font: "inherit", fontWeight: 600, padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" },
  error: { margin: "12px 0", padding: "10px 12px", background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 6, fontSize: 14 },
  muted: { color: "#475569", fontSize: 14 },
  pill: { display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 13, fontWeight: 600 },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "20px 0" },
  stat: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 },
  statValue: { fontSize: 24, fontWeight: 700 },
  footer: { marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0", fontSize: 14 },
};
