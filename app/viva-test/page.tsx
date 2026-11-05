"use client";

// Viva test page: a spoken viva with the AI examiner, with question progress,
// a countdown and a graceful ending. Plain on purpose; the real screens get
// designed separately and reuse lib/viva.
import { useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { MIC_MIME_TYPE, startMic, VoicePlayer, type MicCapture } from "@/lib/viva/audio";
import { appendText, closeTurn, EMPTY_TRANSCRIPT, type Transcript } from "@/lib/viva/transcript";
import { MODE_SECONDS, SAMPLE_PLAN, type VivaMode, type VivaPlan } from "@/lib/viva/plan";
import { createEnding, startCountdown, type Ending } from "@/lib/viva/ending";
import { answerToolCalls } from "@/lib/viva/tool-calls";

type Status = "idle" | "starting" | "live" | "closing" | "ended" | "cancelled" | "error";

const STEP_TIMEOUT_MS = 15000;
const KICKOFF = "The student is ready. Begin the viva.";
const TIME_UP =
  "Time is up. Don't ask anything else: thank the student in one sentence, then call end_viva.";

export default function VivaTestPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<Transcript>(EMPTY_TRANSCRIPT);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [mode, setMode] = useState<VivaMode>("full");
  const [plan, setPlan] = useState<VivaPlan | null>(null);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const planRef = useRef<VivaPlan | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<VoicePlayer | null>(null);
  // Each Start gets a new number. Anything from an older attempt (a late close
  // event, a slow mic prompt) sees it's no longer current and cleans up quietly.
  const attemptRef = useRef(0);
  // The current viva's graceful ending (time-up, end_viva or Gemini's goAway).
  // While it's closing, the connection dropping is expected, not an error.
  const endingRef = useRef<Ending | null>(null);
  const stopCountdownRef = useRef<(() => void) | null>(null);

  // Clean up the mic and connection if the page is closed mid-viva.
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMessage(msg: LiveServerMessage) {
    if (msg.goAway) {
      // Gemini warns that it will close the connection soon.
      wrapUp("The session is ending, so the viva has stopped here.");
      return;
    }
    if (msg.toolCall) {
      // The examiner reports progress and waits for a reply before it carries on.
      const functionResponses = answerToolCalls(msg.toolCall.functionCalls, {
        onStartQuestion: setQuestionId,
        onEndViva: () => wrapUp("Viva complete. Thank you!"),
        knownQuestionIds: planRef.current?.questions.map((q) => q.id),
      });
      sessionRef.current?.sendToolResponse({ functionResponses });
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
          endingRef.current?.audioArrived();
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
    setPlan(null);
    setQuestionId(null);
    setSecondsLeft(null);
    setStatus("starting");

    // Must be created inside the click so the browser lets it make sound.
    const player = new VoicePlayer(() => {
      if (current()) setAiSpeaking(false);
    });
    playerRef.current = player;
    void player.resume();
    endingRef.current = createEnding({
      isPlaying: () => player.isPlaying(),
      onFinish: (notice) => {
        if (current()) endWithNotice(notice);
      },
    });

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
        headers: { "content-type": "application/json", ...(passcode ? { "x-demo-code": passcode } : {}) },
        // TODO(Person 1): send the submission id instead, once questions come from the real work.
        body: JSON.stringify({ plan: SAMPLE_PLAN, mode }),
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
            if (endingRef.current?.closing) {
              // Expected while wrapping up. Local playback keeps going, and the
              // ending closes the page once the examiner has finished speaking.
              sessionRef.current = null;
              return;
            }
            fail(e.reason ? `The viva was disconnected: ${e.reason}` : `The viva was disconnected (code ${e.code}).`);
          },
        },
      });
      // If the connection opens after we gave up, close it.
      connecting.then((s) => !current() && s.close(), () => {});
      const session = await withTimeout(connecting, STEP_TIMEOUT_MS, "Couldn't reach the AI examiner. Check your internet and try again.");
      if (!current()) return;
      sessionRef.current = session;

      planRef.current = body.plan;
      setPlan(body.plan);
      setStatus("live");
      stopCountdownRef.current = startCountdown(Number(body.seconds) || MODE_SECONDS[mode], setSecondsLeft, timeUp);
      session.sendClientContent({ turns: KICKOFF, turnComplete: true });
    } catch (err) {
      if (current()) fail(describeError(err));
    }
  }

  /** The countdown ran out: stop listening and ask the examiner to close. */
  function timeUp() {
    stopListening();
    // Tell Gemini the student's audio has ended, so it isn't waiting for the rest of a sentence.
    sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true });
    sessionRef.current?.sendClientContent({ turns: TIME_UP, turnComplete: true });
    // Wait for the examiner to start its thank-you, then for it to finish.
    wrapUp("Time's up. The viva has ended.", { waitForSpeech: true });
  }

  /** Ends the viva gracefully: stop listening, then let the examiner finish speaking. */
  function wrapUp(notice: string, opts?: { waitForSpeech?: boolean }) {
    if (!endingRef.current?.wrapUp(notice, opts)) return; // already ending
    stopListening();
    setStatus("closing");
  }

  function stopListening() {
    stopCountdownRef.current?.();
    stopCountdownRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
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
    const wasStarting = status === "starting";
    teardown();
    setStatus(wasStarting ? "cancelled" : "ended");
    setAiSpeaking(false);
  }

  /** Stops everything from the current attempt and marks it as finished. */
  function teardown() {
    attemptRef.current++;
    endingRef.current?.cancel();
    endingRef.current = null;
    planRef.current = null;
    stopListening();
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.close();
    playerRef.current?.close();
    playerRef.current = null;
  }

  const running = status === "live" || status === "starting" || status === "closing";
  const questionIndex = plan && questionId ? plan.questions.findIndex((q) => q.id === questionId) : -1;
  const question = questionIndex >= 0 ? plan!.questions[questionIndex] : null;
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

      <fieldset style={styles.fieldset} disabled={running}>
        <legend>Length</legend>
        <label>
          <input type="radio" name="mode" checked={mode === "full"} onChange={() => setMode("full")} /> Full viva ({formatLength(MODE_SECONDS.full)})
        </label>{" "}
        <label>
          <input type="radio" name="mode" checked={mode === "demo"} onChange={() => setMode("demo")} /> Demo ({formatLength(MODE_SECONDS.demo)})
        </label>
      </fieldset>

      {running ? (
        <button onClick={stop} style={styles.button}>
          {status === "starting" ? "Cancel" : "End viva"}
        </button>
      ) : (
        <button onClick={start} style={styles.button}>
          {status === "idle" ? "Start viva" : "Start again"}
        </button>
      )}

      <p data-testid="status" aria-live="polite" style={{ margin: "12px 0" }}>
        <strong>{statusLabel(status, aiSpeaking)}</strong>
      </p>
      {plan && (status === "live" || status === "closing") && (
        <div data-testid="progress" style={styles.progress}>
          <span>
            {question ? (
              <>
                <strong>
                  Question {questionIndex + 1} of {plan.questions.length}:
                </strong>{" "}
                {question.text}
              </>
            ) : (
              plan.assignmentTitle
            )}
          </span>
          {secondsLeft !== null && status === "live" && (
            <span data-testid="timer" role="timer" style={{ whiteSpace: "nowrap" }}>
              {formatTime(secondsLeft)} left
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: status === "error" ? "#b00020" : "#555" }}>
          {error}
        </p>
      )}

      <section aria-label="Conversation" data-testid="transcript">
        {lines.map((line, i) =>
          // A line can be empty while Gemini's first chunk was only leaked tags.
          line.text.trim() ? (
            <p key={i} style={line.who === "ai" ? styles.ai : styles.student}>
              <strong>{line.who === "ai" ? "Examiner" : "You"}:</strong> {line.text}
            </p>
          ) : null,
        )}
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
    case "closing":
      return "Wrapping up…";
    case "ended":
      return "Viva ended";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Something went wrong";
  }
}

function formatLength(seconds: number) {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Microphone access was blocked. Allow it in your browser and try again.";
    if (err.name === "NotFoundError") return "No microphone was found. Plug one in and try again.";
    if (err.name === "NotReadableError") return "Your microphone is being used by another app. Close it and try again.";
    if (err.name === "InsecureContextError") return "The microphone only works on a secure (https) page.";
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
  fieldset: { border: "1px solid #ddd", borderRadius: 8, margin: "0 0 12px", padding: "8px 12px" },
  progress: {
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "baseline",
    background: "#f7f7f7",
    border: "1px solid #e5e5e5",
    borderRadius: 8,
    padding: "8px 12px",
    margin: "0 0 12px",
  },
} as const;
