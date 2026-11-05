// Typing mode: while the student types answers, the mic is paused. Mixing a silent
// audio stream with typed answers makes Gemini think the student said nothing, so it
// moves on or answers its own question. Kept free of React so it can be tested.

export type TypingMode = {
  /** True while typing: mic audio must not be sent. */
  readonly active: boolean;
  /** Turns typing mode on or off. Returns false if it was already in that mode. */
  set(on: boolean): boolean;
  /** Back to speaking, without telling Gemini (a new viva is starting). */
  reset(): void;
};

/** `onStartTyping` runs each time typing mode turns on: tell Gemini the audio has stopped. */
export function createTypingMode(onStartTyping: () => void): TypingMode {
  let active = false;
  return {
    get active() {
      return active;
    },
    set(on) {
      if (active === on) return false;
      active = on;
      if (on) onStartTyping();
      // Turning it off needs no message: the next mic chunk reopens the audio stream.
      return true;
    },
    reset() {
      active = false;
    },
  };
}
