"use client";

// Step 4 test page: a spoken conversation with the AI examiner.
// Mic in, AI voice out, both sides written out live. Plain on purpose;
// the real screens get designed separately and reuse lib/viva.
import { useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { MIC_MIME_TYPE, startMic, VoicePlayer, type MicCapture } from "@/lib/viva/audio";

type Status = "idle" | "starting" | "live" | "ended" | "error";
type Line = { who: "ai" | "student"; text: string };

const KICKOFF =
  "The student is ready. Greet them in one sentence, then ask your first question " +
  "about their sorting algorithms assignment.";

export default function VivaTestPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<VoicePlayer | null>(null);
  const endedByUser = useRef(false);

  // Clean up the mic and connection if the page is closed mid-viva.
  useEffect(() => () => teardown(), []);

  function addText(who: Line["who"], text: string) {
    if (!text) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.who === who) {
        return [...prev.slice(0, -1), { who, text: last.text + text }];
      }
      return [...prev, { who, text: text.trimStart() }];
    });
  }

  function handleMessage(msg: LiveServerMessage) {
    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) {
      // The student started talking over the AI: stop its voice straight away.
      playerRef.current?.interrupt();
      setAiSpeaking(false);
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        playerRef.current?.play(part.inlineData.data);
        setAiSpeaking(true);
      }
    }
    if (content.inputTranscription?.text) addText("student", content.inputTranscription.text);
    if (content.outputTranscription?.text) addText("ai", content.outputTranscription.text);
    if (content.turnComplete) setAiSpeaking(false);
  }

  async function start() {
    setError("");
    setLines([]);
    endedByUser.current = false;
    setStatus("starting");

    // Must be created inside the click so the browser lets it make sound.
    const player = new VoicePlayer();
    playerRef.current = player;
    void player.resume();

    try {
      const res = await fetch("/api/viva/token", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Couldn't start the viva (${res.status})`);

      const ai = new GoogleGenAI({ apiKey: body.token, httpOptions: { apiVersion: "v1alpha" } });
      const session = await ai.live.connect({
        model: body.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => {},
          onmessage: handleMessage,
          onerror: (e) => fail(e.message || "The connection to the AI failed."),
          onclose: (e) => {
            if (endedByUser.current) return;
            fail(e.reason ? `The viva was disconnected: ${e.reason}` : "The viva was disconnected.");
          },
        },
      });
      sessionRef.current = session;

      micRef.current = await startMic((data) => {
        sessionRef.current?.sendRealtimeInput({ audio: { data, mimeType: MIC_MIME_TYPE } });
      });

      setStatus("live");
      session.sendClientContent({ turns: KICKOFF, turnComplete: true });
    } catch (err) {
      fail(describeError(err));
    }
  }

  function fail(message: string) {
    teardown();
    setError(message);
    setStatus("error");
    setAiSpeaking(false);
  }

  function stop() {
    endedByUser.current = true;
    teardown();
    setStatus("ended");
    setAiSpeaking(false);
  }

  function teardown() {
    micRef.current?.stop();
    micRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    endedByUser.current = true; // don't report our own close as an error
    session?.close();
    playerRef.current?.close();
    playerRef.current = null;
  }

  const live = status === "live";

  return (
    <main style={styles.main}>
      <h1 style={{ marginBottom: 4 }}>Viva test</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Talk with the AI examiner. Use headphones if you can, so it doesn&apos;t hear itself.
      </p>

      {live ? (
        <button onClick={stop} style={styles.button}>
          End viva
        </button>
      ) : (
        <button onClick={start} disabled={status === "starting"} style={styles.button}>
          {status === "starting" ? "Starting…" : status === "idle" ? "Start viva" : "Start again"}
        </button>
      )}

      <p data-testid="status" style={{ margin: "12px 0" }}>
        <strong>{statusLabel(status, aiSpeaking)}</strong>
      </p>
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      <section aria-live="polite" aria-label="Conversation" data-testid="transcript">
        {lines.map((line, i) => (
          <p key={i} style={line.who === "ai" ? styles.ai : styles.student}>
            <strong>{line.who === "ai" ? "Examiner" : "You"}:</strong> {line.text}
          </p>
        ))}
      </section>
    </main>
  );
}

function statusLabel(status: Status, aiSpeaking: boolean) {
  switch (status) {
    case "idle":
      return "Not started";
    case "starting":
      return "Starting: allow the microphone if your browser asks…";
    case "live":
      return aiSpeaking ? "Examiner is speaking…" : "Listening…";
    case "ended":
      return "Viva ended";
    case "error":
      return "Something went wrong";
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Microphone access was blocked. Allow it in your browser and try again.";
    if (err.name === "NotFoundError") return "No microphone was found. Plug one in and try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "48px auto", padding: "0 16px" },
  button: { fontSize: 16, padding: "10px 18px", cursor: "pointer" },
  ai: { background: "#f2f2f2", padding: "8px 12px", borderRadius: 8 },
  student: { padding: "8px 12px" },
} as const;
