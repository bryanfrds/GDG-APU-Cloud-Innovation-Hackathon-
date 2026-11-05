import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../public/viva-mic-worklet.js", import.meta.url)),
  "utf8",
);

type Processor = { process: (inputs: Float32Array[][]) => boolean };

/** Loads the worklet as the browser would, at a given mic sample rate. */
function loadWorklet(sampleRate: number) {
  const chunks: Int16Array[] = [];
  let Cls: (new () => Processor) | undefined;
  class FakeProcessor {
    port = { postMessage: (buf: ArrayBuffer) => chunks.push(new Int16Array(buf)) };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", SOURCE)(
    FakeProcessor,
    (name: string, c: new () => Processor) => {
      expect(name).toBe("viva-mic");
      Cls = c;
    },
    sampleRate,
  );
  return { processor: new Cls!(), chunks };
}

/** Feeds `seconds` of a sine wave in 128-sample blocks, like the audio thread does. */
function feedSine(p: Processor, sampleRate: number, seconds: number, amplitude = 0.5) {
  let t = 0;
  for (let off = 0; off < sampleRate * seconds; off += 128) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++) block[i] = amplitude * Math.sin((2 * Math.PI * 440 * t++) / sampleRate);
    p.process([[block]]);
  }
}

describe("viva mic worklet", () => {
  for (const rate of [48000, 44100, 16000]) {
    it(`turns ${rate} Hz mic audio into 100 ms chunks at 16 kHz`, () => {
      const { processor, chunks } = loadWorklet(rate);
      feedSine(processor, rate, 2);
      expect(chunks.every((c) => c.length === 1600)).toBe(true);
      const samples = chunks.length * 1600;
      // 2 s at 16 kHz is 32000 samples; at most one partly-filled chunk is still pending.
      expect(samples).toBeGreaterThanOrEqual(32000 - 1600);
      expect(samples).toBeLessThanOrEqual(32000);
    });
  }

  it("keeps the volume and stays inside the 16-bit range", () => {
    const { processor, chunks } = loadWorklet(48000);
    feedSine(processor, 48000, 1, 0.5);
    const all = chunks.flatMap((c) => Array.from(c));
    const peak = Math.max(...all.map(Math.abs));
    expect(peak).toBeGreaterThan(0.45 * 0x7fff);
    expect(peak).toBeLessThanOrEqual(0.5 * 0x8000);
  });

  it("clips loud input instead of wrapping around", () => {
    const { processor, chunks } = loadWorklet(16000);
    feedSine(processor, 16000, 0.2, 3);
    const all = chunks.flatMap((c) => Array.from(c));
    expect(Math.max(...all)).toBe(0x7fff);
    expect(Math.min(...all)).toBe(-0x8000);
  });

  it("does nothing when there is no input yet", () => {
    const { processor, chunks } = loadWorklet(48000);
    expect(processor.process([[]])).toBe(true);
    expect(chunks).toHaveLength(0);
  });
});
