// How a viva ends: the countdown, and a graceful wrap-up that lets the examiner
// finish speaking before the page closes. Kept free of React so it can be tested
// with fake timers.

export type EndingOptions = {
  /** True while the examiner's voice is still playing. */
  isPlaying: () => boolean;
  /** Called once, when it's safe to close. */
  onFinish: (notice: string) => void;
  /** How long no audio must arrive or play before closing. */
  quietMs?: number;
  /** Close anyway after this long, in case audio never reports that it finished. */
  backstopMs?: number;
  now?: () => number;
};

export type Ending = {
  /** True once a wrap-up has started. */
  readonly closing: boolean;
  /** Tell the ending that a chunk of examiner audio just arrived. */
  audioArrived(): void;
  /**
   * Starts a graceful ending. Returns false if one was already started.
   * With waitForSpeech, it also waits until the examiner has started speaking
   * (for example after being told time is up), up to the backstop.
   */
  wrapUp(notice: string, opts?: { waitForSpeech?: boolean }): boolean;
  /** Stops everything without calling onFinish (the page was torn down). */
  cancel(): void;
};

const POLL_MS = 250;

export function createEnding({
  isPlaying,
  onFinish,
  quietMs = 1500,
  backstopMs = 15000,
  now = Date.now,
}: EndingOptions): Ending {
  let closing = false;
  let done = false;
  let lastAudioAt = -Infinity;
  let waitingForSpeech = false;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const finish = (notice: string) => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    timers = [];
    onFinish(notice);
  };

  return {
    get closing() {
      return closing;
    },
    audioArrived() {
      lastAudioAt = now();
      waitingForSpeech = false;
    },
    wrapUp(notice, opts = {}) {
      if (closing || done) return false;
      closing = true;
      waitingForSpeech = Boolean(opts.waitForSpeech);
      const check = () => {
        if (done) return;
        if (isPlaying()) lastAudioAt = now(); // quiet time counts from when playback stops
        const quiet = now() - lastAudioAt >= quietMs;
        if (waitingForSpeech || !quiet) {
          timers.push(setTimeout(check, POLL_MS));
          return;
        }
        finish(notice);
      };
      timers.push(setTimeout(check, POLL_MS));
      timers.push(setTimeout(() => finish(notice), backstopMs));
      return true;
    },
    cancel() {
      done = true;
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
}

/**
 * Counts down from `seconds`, calling onTick with whole seconds left (only when it
 * changes) and onZero once. Uses the clock, so a throttled background tab stays right.
 * Returns a function that stops it.
 */
export function startCountdown(
  seconds: number,
  onTick: (secondsLeft: number) => void,
  onZero: () => void,
  now: () => number = Date.now,
): () => void {
  const deadline = now() + seconds * 1000;
  let last = seconds;
  onTick(seconds);
  const timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((deadline - now()) / 1000));
    if (left !== last) {
      last = left;
      onTick(left);
    }
    if (left === 0) {
      clearInterval(timer);
      onZero();
    }
  }, POLL_MS);
  return () => clearInterval(timer);
}
