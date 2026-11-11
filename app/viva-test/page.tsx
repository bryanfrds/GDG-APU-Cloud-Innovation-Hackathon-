"use client";

// Viva test page: a spoken viva with the AI examiner, with question progress,
// a countdown and a graceful ending. When it ends, the viva is saved to the server
// and can be downloaded.
import { useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import {
  MIC_MIME_TYPE,
  startMic,
  VoicePlayer,
  type MicCapture,
} from "@/lib/viva/audio";
import {
  addTypedLine,
  appendText,
  closeTurn,
  EMPTY_TRANSCRIPT,
  type Transcript,
} from "@/lib/viva/transcript";
import { createTypingMode, type TypingMode } from "@/lib/viva/typing";
import {
  MODE_SECONDS,
  SAMPLE_PLAN,
  type VivaMode,
  type VivaPlan,
} from "@/lib/viva/plan";
import { createEnding, startCountdown, type Ending } from "@/lib/viva/ending";
import { answerToolCalls } from "@/lib/viva/tool-calls";
import type { EndReason, VivaRecord } from "@/lib/viva/record";
import { recordFileName, sendRecord } from "@/lib/viva/save";
import {
  MAX_TYPED_CHARS,
  prepareTypedAnswer,
  typedAnswerMessage,
} from "@/lib/viva/typed-answer";
import {
  createVivaFinisher,
  IDLE_STATE,
  type Finisher,
  type FinisherState,
  type SaveState,
} from "@/lib/viva/finisher";

type Status =
  | "idle"
  | "starting"
  | "live"
  | "closing"
  | "ended"
  | "cancelled"
  | "error";

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
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState("");
  const [muted, setMuted] = useState(false);

  const [typingMode, setTypingMode] = useState(false);
  const typingRef = useRef<TypingMode | null>(null);
  typingRef.current ??= createTypingMode(() =>
    sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true }),
  );
  const typing = typingRef.current;
  const typedInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const planRef = useRef<VivaPlan | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<VoicePlayer | null>(null);
  const attemptRef = useRef(0);
  const endingRef = useRef<Ending | null>(null);
  const stopCountdownRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef(0);
  const questionIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<Transcript>(EMPTY_TRANSCRIPT);
  const passcodeRef = useRef("");
  passcodeRef.current = passcode;

  const finisherRef = useRef<Finisher | null>(null);
  finisherRef.current ??= createVivaFinisher({
    save: (record) => sendRecord(record, passcodeRef.current),
    onState: setFinished,
  });
  const finisher = finisherRef.current;

  useEffect(
    () => () => {
      finisherRef.current?.reset();
      teardown();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Auto-scroll transcript as new lines arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.lines]);

  function handleMessage(msg: LiveServerMessage) {
    if (msg.goAway) {
      wrapUp(
        "The session is ending, so the viva has stopped here.",
        "session_ended",
      );
      return;
    }
    if (msg.toolCall) {
      const functionResponses = answerToolCalls(msg.toolCall.functionCalls, {
        onStartQuestion: (id) => {
          questionIdRef.current = id;
          setQuestionId(id);
        },
        onEndViva: () => wrapUp("Examination complete.", "completed"),
        knownQuestionIds: planRef.current?.questions.map((q) => q.id),
      });
      sessionRef.current?.sendToolResponse({ functionResponses });
      return;
    }
    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) {
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
      const meta = {
        questionId: questionIdRef.current,
        atMs: Date.now() - startedAtRef.current,
      };
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

    const player = new VoicePlayer(() => {
      if (current()) setAiSpeaking(false);
    });
    playerRef.current = player;
    void player.resume();
    player.setMuted(muted);
    endingRef.current = createEnding({
      isPlaying: () => player.isPlaying(),
      onFinish: (notice) => {
        if (current()) endWithNotice(notice, "completed");
      },
    });

    try {
      const mic = await startMic((data) => {
        if (!typing.active)
          sessionRef.current?.sendRealtimeInput({
            audio: { data, mimeType: MIC_MIME_TYPE },
          });
      });
      if (!current()) return mic.stop();
      micRef.current = mic;

      const res = await fetch("/api/viva/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(passcode ? { "x-demo-code": passcode } : {}),
        },
        body: JSON.stringify({ plan: SAMPLE_PLAN, mode }),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          body.error ?? `Couldn't start the viva (${res.status})`,
        );
      if (!current()) return;

      const ai = new GoogleGenAI({
        apiKey: body.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const connecting = ai.live.connect({
        model: body.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onmessage: (m) => {
            if (current()) handleMessage(m);
          },
          onerror: () => {},
          onclose: (e) => {
            if (!current()) return;
            if (endingRef.current?.closing) {
              sessionRef.current = null;
              return;
            }
            fail(
              e.reason
                ? `The viva was disconnected: ${e.reason}`
                : `The viva was disconnected (code ${e.code}).`,
            );
          },
        },
      });
      connecting.then(
        (s) => !current() && s.close(),
        () => {},
      );
      const session = await withTimeout(
        connecting,
        STEP_TIMEOUT_MS,
        "Couldn't reach the AI examiner. Check your internet and try again.",
      );
      if (!current()) return;
      sessionRef.current = session;

      planRef.current = body.plan;
      startedAtRef.current = Date.now();
      const hasId = typeof body.vivaId === "string";
      finisher.begin({
        vivaId: hasId
          ? body.vivaId
          : `unsaved_${startedAtRef.current.toString(36)}`,
        canSave: hasId && body.canSave !== false,
        mode: body.mode === "demo" ? "demo" : "full",
        plan: body.plan,
        startedAt: startedAtRef.current,
      });
      setPlan(body.plan);
      setStatus("live");
      stopCountdownRef.current = startCountdown(
        Number(body.seconds) || MODE_SECONDS[mode],
        setSecondsLeft,
        timeUp,
      );
      session.sendClientContent({ turns: KICKOFF, turnComplete: true });
    } catch (err) {
      if (current()) fail(describeError(err));
    }
  }

  function timeUp() {
    stopListening();
    sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true });
    sessionRef.current?.sendClientContent({
      turns: TIME_UP,
      turnComplete: true,
    });
    wrapUp("Time's up. The viva has ended.", "time_up", {
      waitForSpeech: true,
    });
  }

  function wrapUp(
    notice: string,
    reason: EndReason,
    opts?: { waitForSpeech?: boolean },
  ) {
    if (!endingRef.current?.wrapUp(notice, opts)) return;
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
    finisher.finish("stopped", transcriptRef.current);
    teardown();
    setStatus(wasStarting ? "cancelled" : "ended");
    setAiSpeaking(false);
  }

  function download(toSave: VivaRecord) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(toSave, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = recordFileName(toSave);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const session = sessionRef.current;
    if (!session || status !== "live" || endingRef.current?.closing) return;
    const prepared = prepareTypedAnswer(typed);
    if ("error" in prepared) {
      setTypedError(prepared.error);
      return;
    }
    playerRef.current?.interrupt();
    switchTyping(true);
    session.sendClientContent(typedAnswerMessage(prepared.text));
    const meta = {
      questionId: questionIdRef.current,
      atMs: Date.now() - startedAtRef.current,
    };
    const next = addTypedLine(transcriptRef.current, prepared.text, meta);
    transcriptRef.current = next;
    setTranscript(next);
    setTyped("");
    setTypedError("");
  }

  function switchTyping(on: boolean) {
    if (typing.set(on)) setTypingMode(on);
  }

  function toggleMute(next: boolean) {
    setMuted(next);
    playerRef.current?.setMuted(next);
  }

  function teardown() {
    attemptRef.current++;
    typing.reset();
    setTypingMode(false);
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

  const running =
    status === "live" || status === "starting" || status === "closing";
  const questionIndex =
    plan && questionId
      ? plan.questions.findIndex((q) => q.id === questionId)
      : -1;
  const question = questionIndex >= 0 ? plan!.questions[questionIndex] : null;
  const lines = transcript.lines.filter((line) => line.text.trim().length > 0);
  const { record, saveState, saveError } = finished;
  const badgeStyle = getStatusBadgeStyle(status, aiSpeaking, typingMode);

  return (
    <div style={styles.page}>
      <main style={styles.card}>
        {/* Header */}
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>AI Oral Examination</h1>
          </div>
          <div
            data-testid="status"
            aria-live="polite"
            style={{
              ...styles.statusBadge,
              backgroundColor: badgeStyle.bg,
              color: badgeStyle.fg,
              borderColor: badgeStyle.border,
            }}
          >
            <span
              style={{ ...styles.statusDot, backgroundColor: badgeStyle.dot }}
            />
            <strong>{statusLabel(status, aiSpeaking, typingMode)}</strong>
          </div>
        </header>

        {/* Pre-session Setup */}
        <section style={styles.setupPanel}>
          <div style={styles.setupGrid}>
            <div style={styles.fieldGroup}>
              <label htmlFor="demo-passcode" style={styles.label}>
                Demo passcode <span style={styles.mutedText}>(optional)</span>
              </label>
              <input
                id="demo-passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                disabled={running}
                type="password"
                placeholder="Enter server code if required"
                autoComplete="off"
                style={{ ...styles.input, ...(running ? styles.disabled : {}) }}
              />
            </div>

            <fieldset style={styles.fieldset} disabled={running}>
              <legend style={styles.label}>Session length</legend>
              <div style={styles.radioRow}>
                <label
                  style={{
                    ...styles.radioPill,
                    ...(mode === "full" ? styles.radioPillActive : {}),
                    ...(running ? styles.disabled : {}),
                  }}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "full"}
                    onChange={() => setMode("full")}
                    style={styles.hiddenRadio}
                  />
                  Full viva ({formatLength(MODE_SECONDS.full)})
                </label>
                <label
                  style={{
                    ...styles.radioPill,
                    ...(mode === "demo" ? styles.radioPillActive : {}),
                    ...(running ? styles.disabled : {}),
                  }}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "demo"}
                    onChange={() => setMode("demo")}
                    style={styles.hiddenRadio}
                  />
                  Demo ({formatLength(MODE_SECONDS.demo)})
                </label>
              </div>
            </fieldset>
          </div>

          <div style={styles.actionBar}>
            {running ? (
              <button
                onClick={stop}
                style={{
                  ...styles.primaryBtn,
                  ...(status === "starting"
                    ? styles.neutralBtn
                    : styles.dangerBtn),
                }}
              >
                {status === "starting" ? "Cancel" : "End viva"}
              </button>
            ) : (
              <button onClick={start} style={styles.primaryBtn}>
                {status === "idle" ? "Start viva" : "Start again"}
              </button>
            )}

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={muted}
                onChange={(e) => toggleMute(e.target.checked)}
                style={styles.checkbox}
              />
              <span>Mute examiner voice</span>
            </label>
          </div>
        </section>

        {/* Active Question & Timer Banner */}
        {plan && (status === "live" || status === "closing") && (
          <div data-testid="progress" style={styles.progressBanner}>
            <div style={{ flex: 1 }}>
              {question ? (
                <>
                  <span style={styles.questionPill}>
                    Question {questionIndex + 1} of {plan.questions.length}
                  </span>
                  <p style={styles.questionText}>{question.text}</p>
                </>
              ) : (
                <p style={styles.questionText}>{plan.assignmentTitle}</p>
              )}
            </div>
            {secondsLeft !== null && status === "live" && (
              <div
                data-testid="timer"
                role="timer"
                style={{
                  ...styles.timerBox,
                  ...(secondsLeft <= 30 ? styles.timerUrgent : {}),
                }}
              >
                <span style={styles.timerLabel}>TIME LEFT</span>
                <span style={styles.timerValue}>{formatTime(secondsLeft)}</span>
              </div>
            )}
          </div>
        )}

        {/* Notice / Error Alert */}
        {error && (
          <div
            role="alert"
            style={{
              ...styles.alertBanner,
              ...(status === "error" ? styles.alertError : styles.alertNotice),
            }}
          >
            {error}
          </div>
        )}

        {/* Save & Download Bar */}
        {record && !running && (
          <div data-testid="save" style={styles.saveBanner}>
            <span style={styles.saveText}>
              {saveLabel(saveState, record)}
              {saveError && ` ${saveError.message}`}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {saveState === "failed" && saveError?.canRetry && (
                <button
                  onClick={() => finisher.retry()}
                  style={styles.secondaryBtn}
                >
                  Try saving again
                </button>
              )}
              <button
                onClick={() => download(record)}
                style={styles.secondaryBtn}
              >
                Download transcript
              </button>
            </div>
          </div>
        )}

        {/* Live Transcript Feed */}
        <section
          aria-label="Conversation"
          data-testid="transcript"
          style={styles.transcriptSection}
        >
          <div style={styles.transcriptHeader}>
            <span style={styles.sectionHeading}>Transcript</span>
            <span style={styles.mutedText}>
              {lines.length === 0
                ? "No messages yet"
                : `${lines.length} message${lines.length === 1 ? "" : "s"}`}
            </span>
          </div>

          <div style={styles.transcriptList}>
            {lines.length === 0 ? (
              <div style={styles.emptyTranscript}>
                {running
                  ? "The examiner will introduce the session shortly…"
                  : "Start the viva to begin your conversation with the AI examiner."}
              </div>
            ) : (
              lines.map((line, i) => {
                const isAi = line.who === "ai";
                return (
                  <div
                    key={i}
                    style={{
                      ...styles.messageRow,
                      justifyContent: isAi ? "flex-start" : "flex-end",
                    }}
                  >
                    <div
                      style={{
                        ...styles.messageBubble,
                        ...(isAi ? styles.aiBubble : styles.studentBubble),
                      }}
                    >
                      <div
                        style={{
                          ...styles.senderTag,
                          color: isAi ? "#475569" : "#dbeafe",
                        }}
                      >
                        {isAi ? "Examiner" : "You"}
                      </div>
                      <div style={styles.messageBody}>{line.text}</div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        {/* Typed Answer Fallback Form */}
        {status === "live" && (
          <form
            onSubmit={sendTyped}
            style={styles.typedForm}
            aria-label="Type an answer"
          >
            <div style={styles.typedHeader}>
              <label htmlFor="typed-answer" style={styles.label}>
                Type your answer{" "}
                <span style={styles.mutedText}>(optional fallback)</span>
              </label>
              {typingMode && (
                <span style={styles.micPausedBadge}>
                  Mic paused ·{" "}
                  <button
                    type="button"
                    onClick={() => {
                      switchTyping(false);
                      typedInputRef.current?.focus();
                    }}
                    style={styles.linkBtn}
                  >
                    Speak instead
                  </button>
                </span>
              )}
            </div>

            <textarea
              id="typed-answer"
              ref={typedInputRef}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (typedError) setTypedError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Write your response here (Enter to send, Shift+Enter for new line)…"
              rows={2}
              maxLength={MAX_TYPED_CHARS * 2}
              aria-invalid={typedError ? true : undefined}
              aria-describedby={`typed-count${typedError ? " typed-error" : ""}`}
              style={styles.textarea}
            />

            <div style={styles.typedFooter}>
              <span
                id="typed-count"
                style={{
                  fontSize: 13,
                  color: typed.length > MAX_TYPED_CHARS ? "#dc2626" : "#64748b",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {typed.length}/{MAX_TYPED_CHARS}
              </span>
              <button type="submit" style={styles.sendBtn}>
                Send answer
              </button>
            </div>

            {typedError && (
              <span id="typed-error" role="alert" style={styles.inlineError}>
                {typedError}
              </span>
            )}
          </form>
        )}
      </main>
    </div>
  );
}

function getStatusBadgeStyle(
  status: Status,
  aiSpeaking: boolean,
  typingMode: boolean,
) {
  switch (status) {
    case "live":
      if (aiSpeaking)
        return {
          bg: "#eff6ff",
          fg: "#1d4ed8",
          border: "#bfdbfe",
          dot: "#2563eb",
        };
      if (typingMode)
        return {
          bg: "#fefce8",
          fg: "#a16207",
          border: "#fef08a",
          dot: "#ca8a04",
        };
      return {
        bg: "#f0fdf4",
        fg: "#15803d",
        border: "#bbf7d0",
        dot: "#16a34a",
      };
    case "starting":
    case "closing":
      return {
        bg: "#fffbeb",
        fg: "#b45309",
        border: "#fde68a",
        dot: "#d97706",
      };
    case "error":
      return {
        bg: "#fef2f2",
        fg: "#b91c1c",
        border: "#fecaca",
        dot: "#dc2626",
      };
    default:
      return {
        bg: "#f1f5f9",
        fg: "#475569",
        border: "#e2e8f0",
        dot: "#94a3b8",
      };
  }
}

function statusLabel(status: Status, aiSpeaking: boolean, typingMode: boolean) {
  switch (status) {
    case "idle":
      return "Ready";
    case "starting":
      return "Allow microphone…";
    case "live":
      if (aiSpeaking) return "Examiner speaking…";
      return typingMode ? "Mic paused (typing)" : "Listening…";
    case "closing":
      return "Wrapping up…";
    case "ended":
      return "Session finished";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Connection error";
  }
}

function saveLabel(state: SaveState, record: VivaRecord) {
  const turns = `${record.turns.length} line${record.turns.length === 1 ? "" : "s"}`;
  switch (state) {
    case "saving":
      return `Saving the transcript (${turns})…`;
    case "saved":
      return `Saved (${turns}).`;
    case "failed":
      return "Couldn't save the examination transcript.";
    case "off":
      return `This transcript can't be saved on this server (${turns}); download it instead.`;
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
    if (err.name === "NotAllowedError")
      return "Microphone access was blocked. Allow it in your browser and try again.";
    if (err.name === "NotFoundError")
      return "No microphone was found. Plug one in and try again.";
    if (err.name === "NotReadableError")
      return "Your microphone is being used by another app. Close it and try again.";
    if (err.name === "InsecureContextError")
      return "The microphone only works on a secure (https) page.";
    if (err.name === "TimeoutError")
      return "The server took too long to respond. Try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
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
  page: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    padding: "32px 16px",
    boxSizing: "border-box",
  },
  card: {
    maxWidth: 680,
    margin: "0 auto",
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 20px rgba(15, 23, 42, 0.05)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: 16,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#0f172a",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: 14,
    color: "#64748b",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    border: "1px solid",
    whiteSpace: "nowrap",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  setupPanel: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  setupGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    alignItems: "end",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
  },
  mutedText: {
    fontWeight: 400,
    color: "#64748b",
    fontSize: 13,
  },
  input: {
    fontSize: 14,
    padding: "8px 12px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    outline: "none",
  },
  fieldset: {
    border: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  radioRow: {
    display: "flex",
    gap: 8,
  },
  radioPill: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#475569",
    cursor: "pointer",
    userSelect: "none",
  },
  radioPillActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 600,
  },
  hiddenRadio: {
    position: "absolute",
    opacity: 0,
    pointerEvents: "none",
  },
  disabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  actionBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 4,
  },
  primaryBtn: {
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 20px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
  },
  dangerBtn: {
    backgroundColor: "#dc2626",
    boxShadow: "0 1px 2px rgba(220, 38, 38, 0.2)",
  },
  neutralBtn: {
    backgroundColor: "#475569",
    boxShadow: "none",
  },
  checkboxLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    color: "#475569",
    cursor: "pointer",
    userSelect: "none",
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: "#2563eb",
    cursor: "pointer",
  },
  progressBanner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: 16,
  },
  questionPill: {
    display: "inline-block",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#1d4ed8",
    marginBottom: 4,
  },
  questionText: {
    margin: 0,
    fontSize: 15,
    fontWeight: 500,
    lineHeight: 1.45,
    color: "#1e3a8a",
  },
  timerBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    backgroundColor: "#ffffff",
    border: "1px solid #bfdbfe",
    padding: "8px 14px",
    minWidth: 76,
  },
  timerUrgent: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    color: "#dc2626",
  },
  timerLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    opacity: 0.75,
  },
  timerValue: {
    fontSize: 18,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  alertBanner: {
    padding: "12px 16px",
    fontSize: 14,
    lineHeight: 1.4,
  },
  alertError: {
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  },
  alertNotice: {
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    color: "#334155",
  },
  saveBanner: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f0fdf4",
    border: "1px solid #bbf7d0",
    padding: "12px 16px",
  },
  saveText: {
    fontSize: 14,
    fontWeight: 500,
    color: "#166534",
  },
  secondaryBtn: {
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 14px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
  },
  transcriptSection: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  transcriptHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#64748b",
  },
  transcriptList: {
    minHeight: 180,
    maxHeight: 380,
    overflowY: "auto",
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  emptyTranscript: {
    margin: "auto",
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 14,
    maxWidth: 320,
    lineHeight: 1.5,
  },
  messageRow: {
    display: "flex",
    width: "100%",
  },
  messageBubble: {
    maxWidth: "82%",
    padding: "10px 14px",
    borderRadius: 14,
    fontSize: 14,
    lineHeight: 1.5,
  },
  aiBubble: {
    backgroundColor: "#ffffff",
    color: "#0f172a",
    border: "1px solid #e2e8f0",
    borderBottomLeftRadius: 4,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
  },
  studentBubble: {
    backgroundColor: "#2563eb",
    color: "#ffffff",
    borderBottomRightRadius: 4,
  },
  senderTag: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 3,
  },
  messageBody: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  typedForm: {
    borderTop: "1px solid #e2e8f0",
    paddingTop: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  typedHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  micPausedBadge: {
    fontSize: 12,
    backgroundColor: "#fefce8",
    color: "#854d0e",
    border: "1px solid #fef08a",
    padding: "3px 10px",
    borderRadius: 999,
  },
  linkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#1d4ed8",
    fontWeight: 600,
    fontSize: 12,
    textDecoration: "underline",
    cursor: "pointer",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 14,
    fontFamily: "inherit",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    resize: "vertical",
    outline: "none",
  },
  typedFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sendBtn: {
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
  },
  inlineError: {
    fontSize: 13,
    color: "#dc2626",
  },
} as const;
