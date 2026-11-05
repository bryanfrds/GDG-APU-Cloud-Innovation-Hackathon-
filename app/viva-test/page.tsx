"use client";

// Step 3 test page: get a pass from our server, then connect to Gemini Live with it.
// No microphone yet; that's step 4.
import { useRef, useState } from "react";
import { GoogleGenAI, Modality, type Session } from "@google/genai";

type Status = "idle" | "getting-pass" | "connecting" | "connected" | "error";

export default function VivaTestPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");
  const sessionRef = useRef<Session | null>(null);

  async function connect() {
    setDetail("");
    try {
      setStatus("getting-pass");
      const res = await fetch("/api/viva/token", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Token request failed (${res.status})`);

      setStatus("connecting");
      const ai = new GoogleGenAI({ apiKey: body.token, httpOptions: { apiVersion: "v1alpha" } });
      sessionRef.current = await ai.live.connect({
        model: body.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => setStatus("connected"),
          onmessage: () => {},
          onerror: (e) => {
            setStatus("error");
            setDetail(e.message || "Connection error");
          },
          onclose: (e) => {
            setStatus((s) => (s === "error" ? s : "idle"));
            if (e.reason) setDetail(`Closed: ${e.reason}`);
          },
        },
      });
    } catch (err) {
      setStatus("error");
      setDetail(err instanceof Error ? err.message : String(err));
    }
  }

  function disconnect() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("idle");
  }

  const busy = status === "getting-pass" || status === "connecting";

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
      <h1>Viva connection test</h1>
      <p>Gets a one-time pass from our server, then connects to Gemini Live with it.</p>
      {status === "connected" ? (
        <button onClick={disconnect}>Disconnect</button>
      ) : (
        <button onClick={connect} disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      )}
      <p data-testid="status">
        Status: <strong>{labels[status]}</strong>
      </p>
      {detail && <p style={{ color: "#b00020" }}>{detail}</p>}
    </main>
  );
}

const labels: Record<Status, string> = {
  idle: "Not connected",
  "getting-pass": "Getting a pass…",
  connecting: "Connecting to Gemini…",
  connected: "Connected",
  error: "Error",
};
