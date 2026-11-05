// Browser audio helpers for the voice viva: microphone in, AI voice out.

export const MIC_MIME_TYPE = "audio/pcm;rate=16000";
const OUTPUT_RATE = 24000; // Gemini Live speaks 24 kHz, 16-bit mono PCM

export type MicCapture = { stop: () => void };

/** Starts the microphone and calls onChunk with base64 16 kHz PCM every ~100 ms. */
export async function startMic(onChunk: (base64: string) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule("/viva-mic-worklet.js");
    await ctx.resume(); // Safari can leave it paused when created after an await
    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "viva-mic");
    // Route to the speakers through a muted gain: some Safari versions only
    // process nodes that are connected to the output.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toBase64(e.data));
    source.connect(worklet).connect(mute).connect(ctx.destination);

    return {
      stop: () => {
        worklet.port.onmessage = null;
        source.disconnect();
        worklet.disconnect();
        mute.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    throw err;
  }
}

/** Plays the AI's audio chunks back to back, and can cut off instantly when the student interrupts. */
export class VoicePlayer {
  private ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
  private nextStart = 0;
  private playing = new Set<AudioBufferSourceNode>();

  /** onIdle fires when the last queued audio finishes playing (not when Gemini finishes sending). */
  constructor(private onIdle?: () => void) {}

  play(base64: string) {
    const pcm = new Int16Array(fromBase64(base64));
    if (!pcm.length) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 0x8000;

    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime + 0.05, this.nextStart);
    node.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.playing.add(node);
    node.onended = () => {
      this.playing.delete(node);
      if (this.playing.size === 0) this.onIdle?.();
    };
  }

  /** Stops whatever the AI is saying right now (used when the student talks over it). */
  interrupt() {
    for (const node of this.playing) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    this.playing.clear();
    this.nextStart = 0;
    this.onIdle?.();
  }

  /** Browsers start audio paused until the user clicks; call this from the click. */
  resume() {
    return this.ctx.resume().catch(() => {});
  }

  close() {
    this.onIdle = undefined;
    this.interrupt();
    void this.ctx.close().catch(() => {});
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
