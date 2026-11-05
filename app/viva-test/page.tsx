"use client";

// Step 4 test page: a spoken conversation with the AI examiner.
// Mic in, AI voice out, both sides written out live. Plain on purpose;
// the real screens get designed separately and reuse lib/viva.
import { useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { MIC_MIME_TYPE, startMic, VoicePlayer, type MicCapture } from "@/lib/viva/audio";
import { appendText, closeTurn, EMPTY_TRANSCRIPT, type Transcript } from "@/lib/viva/transcript";

type Status = "idle" | "starting" | "live" | "ended" | "error";

const STEP_TIMEOUT_MS = 15000;
const KICKOFF =
  "The student is ready. Greet them in one sentence, then ask your first question " +
  "about their sorting algorithms assignment.";

export default function VivaTestPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<Transcript>(EMPTY_TRANSCRIPT);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [passcode, setPasscode] = useState("");

  const sessionRef = useRef<Session | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<VoicePlayer | null>(null);
  // Each Start gets a new number. Anything from an older attempt (a late close
  // event, a slow mic prompt) sees it's no longer current and cleans up quietly.
  const attemptRef = useRef(0);

  // Clean up the mic and connection if the page is closed mid-viva.
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMessage(msg: LiveServerMessage) {
    if (msg.goAway) {
      // Gemini is about to end the connection (it caps session length).
      endWithNotice("Time's up: the viva session reached its length limit.");
      return;
    }
    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) {
      // The student started talking over the AI: stop its voice straight away
      // and drop any audio that came with this message.
      playerRef.current?.interrupt();
    } else {
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          playerRef.current?.play(part.inlineData.data);
          setAiSpeaking(true);
        }
      }
    }

    const heard = content.inputTranscription?.text;
    const said = content.outputTranscription?.text;
    if (heard || said || content.turnComplete || content.interrupted) {
      setTranscript((t) => {
        let next = t;
        if (heard) next = appendText(next, "student", heard);
        if (said) next = appendText(next, "ai", said);
        if (content.interrupted) next = closeTurn(next, "interrupted");
        else if (content.turnComplete) next = closeTurn(next, "complete");
        return next;
      });
    }
  }

  async function start() {
    teardown();
    const attempt = attemptRef.current;
    const current = () => attemptRef.current === attempt;

    setError("");
    setTranscript(EMPTY_TRANSCRIPT);
    setAiSpeaking(false);
    setStatus("starting");

    // Must be created inside the click so the browser lets it make sound.
    const player = new VoicePlayer(() => {
      if (current()) setAiSpeaking(false);
    });
    playerRef.current = player;
    void player.resume();

    try {
      // Ask for the mic first, so the permission prompt doesn't eat into the
      // token's short start window. Audio before the session opens is dropped.
      const mic = await startMic((data) => {
        sessionRef.current?.sendRealtimeInput({ audio: { data, mimeType: MIC_MIME_TYPE } });
      });
      if (!current()) return mic.stop();
      micRef.current = mic;

      const res = await fetch("/api/viva/token", {
        method: "POST",
        headers: passcode ? { "x-demo-code": passcode } : {},
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Couldn't start the viva (${res.status})`);
      if (!current()) return;

      const ai = new GoogleGenAI({ apiKey: body.token, httpOptions: { apiVersion: "v1alpha" } });
      const connecting = ai.live.connect({
        model: body.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onmessage: (m) => {
            if (current()) handleMessage(m);
          },
          // A close event always follows an error, with the real reason; report that instead.
          onerror: () => {},
          onclose: (e) => {
            if (!current()) return; // we closed it, or it belongs to an older attempt
            fail(e.reason ? `The viva was disconnected: ${e.reason}` : `The viva was disconnected (code ${e.code}).`);
          },
        },
      });
      // If the connection opens after we gave up, close it.
      connecting.then((s) => !current() && s.close(), () => {});
      const session = await withTimeout(connecting, STEP_TIMEOUT_MS, "Couldn't reach the AI examiner. Check your internet and try again.");
      if (!current()) return;
      sessionRef.current = session;

      setStatus("live");
      session.sendClientContent({ turns: KICKOFF, turnComplete: true });
    } catch (err) {
      if (current()) fail(describeError(err));
    }
  }

  function fail(message: string) {
    teardown();
    setError(message);
    setStatus("error");
    setAiSpeaking(false);
  }

  function endWithNotice(message: string) {
    teardown();
    setError(message);
    setStatus("ended");
    setAiSpeaking(false);
  }

  function stop() {
    teardown();
    setStatus("ended");
    setAiSpeaking(false);
  }

  /** Stops everything from the current attempt and marks it as finished. */
  function teardown() {
    attemptRef.current++;
    micRef.current?.stop();
    micRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.close();
    playerRef.current?.close();
    playerRef.current = null;
  }

  const running = status === "live" || status === "starting";
  const lines = transcript.lines;

  return (
    <main style={styles.main}>
      <h1 style={{ marginBottom: 4 }}>Viva test</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Talk with the AI examiner. Use headphones if you can, so it doesn&apos;t hear itself.
      </p>

      <label style={{ display: "block", margin: "0 0 12px" }}>
        Demo passcode (only if this server asks for one){" "}
        <input
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          disabled={running}
          type="password"
          autoComplete="off"
          style={{ fontSize: 16 }}
        />
      </label>

      {running ? (
        <button onClick={stop} style={styles.button}>
          {status === "starting" ? "Cancel" : "End viva"}
        </button>
      ) : (
        <button onClick={start} style={styles.button}>
          {status === "idle" ? "Start viva" : "Start again"}
        </button>
      )}

      <p data-testid="status" style={{ margin: "12px 0" }}>
        <strong>{statusLabel(status, aiSpeaking)}</strong>
      </p>
      {error && (
        <p role="alert" style={{ color: status === "error" ? "#b00020" : "#555" }}>
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
    if (err.name === "TimeoutError") return "The server took too long to respond. Try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "48px auto", padding: "0 16px" },
  button: { fontSize: 16, padding: "10px 18px", cursor: "pointer" },
  ai: { background: "#f2f2f2", padding: "8px 12px", borderRadius: 8 },
  student: { padding: "8px 12px" },
} as const;
