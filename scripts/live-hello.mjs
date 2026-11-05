// Step 2 test: ask Gemini Live one question, save its spoken reply as a WAV file and play it.
// Run: kv run --env-file .env.local -- npm run viva:hello
import { GoogleGenAI, Modality } from "@google/genai";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { wavHeader } from "./wav.mjs";

const MODEL = process.env.LIVE_MODEL ?? "gemini-3.8-live";
const SAMPLE_RATE = 24000; // Gemini Live speaks 24 kHz, 16-bit, mono PCM

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Run it with: kv run --env-file .env.local -- npm run viva:hello");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const audioChunks = [];
let spoken = "";

const done = new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error("Timed out after 30 s waiting for a reply")), 30000).unref();
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
        // Rejecting after resolve() does nothing, so this only fires on an early close.
        onclose: (e) => reject(new Error(`Connection closed before the reply finished: ${e.reason || e.code}`)),
      },
    })
    .then((session) => {
      session.sendClientContent({
        turns: "Introduce yourself in one sentence, then ask me my first viva question about a sorting assignment.",
        turnComplete: true,
      });
      done.finally(() => session.close()).catch(() => {});
    })
    .catch(reject);
});

await done;

const pcm = Buffer.concat(audioChunks);
mkdirSync("tmp", { recursive: true });
const file = "tmp/live-hello.wav";
writeFileSync(file, Buffer.concat([wavHeader(pcm.length, SAMPLE_RATE), pcm]));

console.log(`\nAI said: ${spoken.trim()}`);
console.log(`Saved ${(pcm.length / (SAMPLE_RATE * 2)).toFixed(1)}s of audio to ${file}`);
if (process.platform === "darwin" && !process.env.NO_PLAY) execFileSync("afplay", [file]);
