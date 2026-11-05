import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePlayer } from "./audio";

// A tiny stand-in for the browser's AudioContext, enough to watch scheduling.
class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  startedAt = -1;
  stopped = false;
  connectedTo: unknown = null;
  connect(to: unknown) {
    this.connectedTo = to;
  }
  start(t: number) {
    this.startedAt = t;
  }
  stop() {
    this.stopped = true;
  }
  end() {
    this.onended?.();
  }
}

class FakeAudioContext {
  static last: FakeAudioContext;
  currentTime = 0;
  state = "running";
  destination = {};
  sources: FakeSource[] = [];
  closed = false;
  constructor() {
    FakeAudioContext.last = this;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  gains: { gain: { value: number }; connectedTo: unknown }[] = [];
  createGain() {
    const g = { gain: { value: 1 }, connectedTo: null as unknown, connect(to: unknown) { g.connectedTo = to; } };
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

/** base64 of `seconds` of silent 24 kHz 16-bit audio. */
function chunk(seconds: number) {
  return Buffer.alloc(Math.round(24000 * seconds) * 2).toString("base64");
}

describe("VoicePlayer", () => {
  beforeEach(() => vi.stubGlobal("AudioContext", FakeAudioContext));
  afterEach(() => vi.unstubAllGlobals());

  it("plays chunks back to back with no gaps or overlaps", () => {
    const player = new VoicePlayer();
    player.play(chunk(0.5));
    player.play(chunk(0.25));
    player.play(chunk(1));
    const starts = FakeAudioContext.last.sources.map((s) => s.startedAt);
    expect(starts[0]).toBeCloseTo(0.05);
    expect(starts[1]).toBeCloseTo(0.55);
    expect(starts[2]).toBeCloseTo(0.8);
  });

  it("says it's idle only when the last queued chunk finishes", () => {
    const onIdle = vi.fn();
    const player = new VoicePlayer(onIdle);
    player.play(chunk(0.5));
    player.play(chunk(0.5));
    const [a, b] = FakeAudioContext.last.sources;
    a.end();
    expect(onIdle).not.toHaveBeenCalled();
    b.end();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("stops everything at once when interrupted, and reports idle once", () => {
    const onIdle = vi.fn();
    const player = new VoicePlayer(onIdle);
    player.play(chunk(0.5));
    player.play(chunk(0.5));
    player.interrupt();
    const sources = FakeAudioContext.last.sources;
    expect(sources.every((s) => s.stopped)).toBe(true);
    sources.forEach((s) => s.end()); // a late ended event must not fire onIdle again
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("starts fresh after an interruption instead of queueing behind old audio", () => {
    const player = new VoicePlayer();
    player.play(chunk(2));
    player.interrupt();
    FakeAudioContext.last.currentTime = 0.3;
    player.play(chunk(0.5));
    expect(FakeAudioContext.last.sources[1].startedAt).toBeCloseTo(0.35);
  });

  it("never reports idle after it's closed", () => {
    const onIdle = vi.fn();
    const player = new VoicePlayer(onIdle);
    player.play(chunk(0.5));
    player.close();
    FakeAudioContext.last.sources.forEach((s) => s.end());
    expect(onIdle).not.toHaveBeenCalled();
    expect(FakeAudioContext.last.closed).toBe(true);
  });

  it("runs a one-off callback when the queued audio finishes, keeping the normal one", () => {
    const onIdle = vi.fn();
    const done = vi.fn();
    const player = new VoicePlayer(onIdle);
    player.play(chunk(0.5));
    expect(player.isPlaying()).toBe(true);
    player.whenIdle(done);
    FakeAudioContext.last.sources[0].end();
    expect(done).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(player.isPlaying()).toBe(false);
    player.play(chunk(0.5));
    FakeAudioContext.last.sources[1].end();
    expect(done).toHaveBeenCalledTimes(1); // one-off
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it("plays every chunk through one volume control that can be muted", () => {
    const player = new VoicePlayer();
    const ctx = FakeAudioContext.last;
    const [volume] = ctx.gains;
    expect(volume.connectedTo).toBe(ctx.destination);
    player.play(chunk(0.5));
    expect(ctx.sources[0].connectedTo).toBe(volume);
    player.setMuted(true);
    expect(volume.gain.value).toBe(0);
    player.setMuted(false);
    expect(volume.gain.value).toBe(1);
  });

  it("still reports speaking and idle while muted, so the ending works", () => {
    const onIdle = vi.fn();
    const player = new VoicePlayer(onIdle);
    player.setMuted(true);
    player.play(chunk(0.5));
    expect(player.isPlaying()).toBe(true);
    FakeAudioContext.last.sources[0].end();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("ignores empty chunks", () => {
    const player = new VoicePlayer();
    player.play("");
    expect(FakeAudioContext.last.sources).toHaveLength(0);
  });
});
