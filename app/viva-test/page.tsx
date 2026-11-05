"use client";

// Viva test page: a spoken viva with the AI examiner, with question progress,
// a countdown and a graceful ending. When it ends, the viva is saved to the server
// and can be downloaded. Plain on purpose; the real screens get designed
// separately and reuse lib/viva.
import { useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { MIC_MIME_TYPE, startMic, VoicePlayer, type MicCapture } from "@/lib/viva/audio";
import { appendText, closeTurn, EMPTY_TRANSCRIPT, type Transcript } from "@/lib/viva/transcript";
import { MODE_SECONDS, SAMPLE_PLAN, type VivaMode, type VivaPlan } from "@/lib/viva/plan";
import { createEnding, startCountdown, type Ending } from "@/lib/viva/ending";
import { answerToolCalls } from "@/lib/viva/tool-calls";
import type { EndReason, VivaRecord } from "@/lib/viva/record";
import { recordFileName, sendRecord } from "@/lib/viva/save";
import { createVivaFinisher, IDLE_STATE, type Finisher, type FinisherState, type SaveState } from "@/lib/viva/finisher";

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
  const [finished, setFinished] = useState<FinisherState>(IDLE_STATE);

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
  // Refs, not state, so tags and the saved record are current inside event handlers.
  const startedAtRef = useRef(0);
  const questionIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<Transcript>(EMPTY_TRANSCRIPT);
  const passcodeRef = useRef("");
  passcodeRef.current = passcode;
  // Builds and saves each viva's record once, with the right end reason (lib/viva/finisher.ts).
  const finisherRef = useRef<Finisher | null>(null);
  finisherRef.current ??= createVivaFinisher({
    save: (record) => sendRecord(record, passcodeRef.current),
    onState: setFinished,
  });
  const finisher = finisherRef.current;

  // Clean up the mic and connection if the page is closed mid-viva.
  // Closing the page mid-viva doesn't save it: there's no reliable moment to send it.
  useEffect(
    () => () => {
      finisherRef.current?.reset();
      teardown();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function handleMessage(msg: LiveServerMessage) {
    if (msg.goAway) {
      // Gemini warns that it will close the connection soon.
      wrapUp("The session is ending, so the viva has stopped here.", "session_ended");
      return;
    }
    if (msg.toolCall) {
      // The examiner reports progress and waits for a reply before it carries on.
      const functionResponses = answerToolCalls(msg.toolCall.functionCalls, {
        onStartQuestion: (id) => {
          questionIdRef.current = id;
          setQuestionId(id);
        },
        onEndViva: () => wrapUp("Viva complete. Thank you!", "completed"),
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
      // Tag new lines with the question being asked now and the time since the viva began.
      const meta = { questionId: questionIdRef.current, atMs: Date.now() - startedAtRef.current };
      let next = transcriptRef.current;
      if (heard) next = appendText(next, "student", heard, meta);
      if (said) next = appendText(next, "ai", said, meta);
      if (content.interrupted) next = closeTurn(next, "interrupted");
      else if (content.turnComplete) next = closeTurn(next, "complete");
      transcriptRef.current = next;
      setTranscript(next);
    }
  }

  async function start() {
    teardown();
    const attempt = attemptRef.current;
    const current = () => attemptRef.current === attempt;

    setError("");
    transcriptRef.current = EMPTY_TRANSCRIPT;
    setTranscript(EMPTY_TRANSCRIPT);
    finisher.reset();
    setFinished(IDLE_STATE);
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
        // The finisher already knows why it's wrapping up, so the reason here is only a fallback.
        if (current()) endWithNotice(notice, "completed");
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
      startedAtRef.current = Date.now();
      const hasId = typeof body.vivaId === "string";
      finisher.begin({
        // Without a server id the record can still be downloaded, under a local one.
        vivaId: hasId ? body.vivaId : `unsaved_${startedAtRef.current.toString(36)}`,
        canSave: hasId && body.canSave !== false,
        mode: body.mode === "demo" ? "demo" : "full",
        plan: body.plan,
        startedAt: startedAtRef.current,
      });
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
    wrapUp("Time's up. The viva has ended.", "time_up", { waitForSpeech: true });
  }

  /** Ends the viva gracefully: stop listening, then let the examiner finish speaking. */
  function wrapUp(notice: string, reason: EndReason, opts?: { waitForSpeech?: boolean }) {
    if (!endingRef.current?.wrapUp(notice, opts)) return; // already ending
    finisher.wrappingUp(reason);
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
    finisher.finish("error", transcriptRef.current);
    teardown();
    setError(message);
    setStatus("error");
    setAiSpeaking(false);
  }

  function endWithNotice(message: string, reason: EndReason) {
    finisher.finish(reason, transcriptRef.current);
    teardown();
    setError(message);
    setStatus("ended");
    setAiSpeaking(false);
  }

  function stop() {
    const wasStarting = status === "starting";
    // If the examiner was already saying goodbye, the finisher keeps that reason instead.
    finisher.finish("stopped", transcriptRef.current);
    teardown();
    setStatus(wasStarting ? "cancelled" : "ended");
    setAiSpeaking(false);
  }

  function download(toSave: VivaRecord) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(toSave, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = recordFileName(toSave);
    // Older Safari and Firefox only download from a link that's on the page.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Stops everything from the current attempt and marks it as finished. */
  function teardown() {
    attemptRef.current++;
    endingRef.current?.cancel();
    endingRef.current = null;
    planRef.current = null;
    questionIdRef.current = null;
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
  const { record, saveState, saveError } = finished;

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

      {record && !running && (
        <div data-testid="save" style={styles.save}>
          <span>
            {saveLabel(saveState, record)}
            {saveError && ` ${saveError.message}`}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            {saveState === "failed" && saveError?.canRetry && (
              <button onClick={() => finisher.retry()}>Try saving again</button>
            )}
            <button onClick={() => download(record)}>Download transcript</button>
          </span>
        </div>
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

function saveLabel(state: SaveState, record: VivaRecord) {
  const turns = `${record.turns.length} line${record.turns.length === 1 ? "" : "s"}`;
  switch (state) {
    case "saving":
      return `Saving the viva (${turns})…`;
    case "saved":
      return `Saved (${turns}).`;
    case "failed":
      return "Couldn't save the viva.";
    case "off":
      return `This viva can't be saved on this server (${turns}); download it instead.`;
    default:
      return "";
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
  save: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid #e5e5e5",
    borderRadius: 8,
    padding: "8px 12px",
    margin: "0 0 12px",
  },
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
