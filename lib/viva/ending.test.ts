import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnding, startCountdown } from "./ending";

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

function setup(opts: { quietMs?: number; backstopMs?: number } = {}) {
  let playing = false;
  const onFinish = vi.fn();
  const ending = createEnding({ isPlaying: () => playing, onFinish, ...opts });
  return {
    ending,
    onFinish,
    play: (on: boolean) => {
      playing = on;
    },
  };
}

describe("createEnding", () => {
  it("finishes once no audio has arrived or played for the quiet period", () => {
    const { ending, onFinish } = setup();
    ending.audioArrived();
    ending.wrapUp("Done");
    vi.advanceTimersByTime(1400);
    expect(onFinish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onFinish).toHaveBeenCalledWith("Done");
  });

  it("waits while the examiner is still speaking", () => {
    const { ending, onFinish, play } = setup();
    play(true);
    ending.wrapUp("Done");
    vi.advanceTimersByTime(5000);
    expect(onFinish).not.toHaveBeenCalled();
    play(false);
    vi.advanceTimersByTime(1000);
    expect(onFinish).not.toHaveBeenCalled(); // quiet time counts from when playback stopped
    vi.advanceTimersByTime(800);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("doesn't end in a short gap between two chunks of speech", () => {
    const { ending, onFinish, play } = setup();
    ending.audioArrived();
    ending.wrapUp("Done");
    vi.advanceTimersByTime(1000); // first chunk finished, a gap...
    ending.audioArrived(); // ...then the next chunk arrives
    play(true);
    vi.advanceTimersByTime(1000);
    play(false);
    vi.advanceTimersByTime(1000);
    expect(onFinish).not.toHaveBeenCalled(); // only 1 s since the last chunk
    vi.advanceTimersByTime(800);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("with waitForSpeech, waits for the examiner to start its closing words", () => {
    const { ending, onFinish, play } = setup();
    ending.wrapUp("Time's up", { waitForSpeech: true });
    vi.advanceTimersByTime(6000); // slow to respond: must not cut it off
    expect(onFinish).not.toHaveBeenCalled();
    ending.audioArrived();
    play(true);
    vi.advanceTimersByTime(3000);
    play(false);
    vi.advanceTimersByTime(1800);
    expect(onFinish).toHaveBeenCalledWith("Time's up");
  });

  it("gives up at the backstop if audio never settles", () => {
    const { ending, onFinish, play } = setup({ backstopMs: 15000 });
    play(true); // never stops
    ending.wrapUp("Done");
    vi.advanceTimersByTime(14999);
    expect(onFinish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("ignores a second wrap-up, so it only ends once", () => {
    const { ending, onFinish } = setup();
    expect(ending.wrapUp("First")).toBe(true);
    expect(ending.wrapUp("Second")).toBe(false);
    expect(ending.closing).toBe(true);
    vi.advanceTimersByTime(20000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith("First");
  });

  it("never finishes after it's cancelled", () => {
    const { ending, onFinish } = setup();
    ending.wrapUp("Done");
    ending.cancel();
    vi.advanceTimersByTime(20000);
    expect(onFinish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("startCountdown", () => {
  it("ticks each whole second and calls onZero once", () => {
    const ticks: number[] = [];
    const onZero = vi.fn();
    startCountdown(3, (s) => ticks.push(s), onZero);
    vi.advanceTimersByTime(5000);
    expect(ticks).toEqual([3, 2, 1, 0]);
    expect(onZero).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays right when the tab is throttled and timers fire late", () => {
    const ticks: number[] = [];
    const onZero = vi.fn();
    startCountdown(30, (s) => ticks.push(s), onZero);
    vi.setSystemTime(29_000); // the clock moves on without the timers firing
    vi.advanceTimersByTime(250);
    expect(ticks.at(-1)).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it("stops when cancelled", () => {
    const onZero = vi.fn();
    const stop = startCountdown(2, () => {}, onZero);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onZero).not.toHaveBeenCalled();
  });
});
