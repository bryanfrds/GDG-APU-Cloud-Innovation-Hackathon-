// Step 2 test: ask Gemini Live one question, save its spoken reply as a WAV file and play it.
// Run: kv run --env-file .env.local -- npm run viva:hello
import { GoogleGenAI, Modality } from "@google/genai";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MODEL = process.env.LIVE_MODEL ?? "gemini-3.8-live";
const SAMPLE_RATE = 24000; // Gemini Live speaks 24 kHz, 16-bit, mono PCM

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const audioChunks = [];
let spoken = "";

const done = new Promise((resolve, reject) => {
  ai.live
    .connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {}, // also send back the words it said, as text
        systemInstruction:
          "You are an examiner running a short, friendly viva about a student's assignment.",
      },
      callbacks: {
        onopen: () => console.log(`Connected to ${MODEL}`),
        onmessage: (msg) => {
          const content = msg.serverContent;
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) audioChunks.push(Buffer.from(part.inlineData.data, "base64"));
          }
          if (content?.outputTranscription?.text) spoken += content.outputTranscription.text;
          if (content?.turnComplete) resolve();
        },
        onerror: (e) => reject(e.error ?? e),
        onclose: (e) => {
          if (!audioChunks.length) reject(new Error(`Closed before any reply: ${e.reason || e.code}`));
        },
      },
    })
    .then((session) => {
      session.sendClientContent({
        turns: "Introduce yourself in one sentence, then ask me my first viva question about a sorting assignment.",
        turnComplete: true,
      });
      done.finally(() => session.close());
    })
    .catch(reject);
});

await done;

const pcm = Buffer.concat(audioChunks);
mkdirSync("tmp", { recursive: true });
const file = "tmp/live-hello.wav";
writeFileSync(file, Buffer.concat([wavHeader(pcm.length), pcm]));

console.log(`\nAI said: ${spoken.trim()}`);
console.log(`Saved ${(pcm.length / (SAMPLE_RATE * 2)).toFixed(1)}s of audio to ${file}`);
if (process.platform === "darwin" && !process.env.NO_PLAY) execFileSync("afplay", [file]);

function wavHeader(dataLength) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  h.writeUInt16LE(2, 32); // bytes per sample
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}
