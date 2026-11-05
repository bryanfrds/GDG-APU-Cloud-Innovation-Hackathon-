// Lists the Gemini models this key can use for live (real-time voice) sessions.
// Run: kv run --env-file .env.local -- npm run viva:models
import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Run it with: kv run --env-file .env.local -- npm run viva:models");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const pager = await ai.models.list();
for await (const model of pager) {
  const actions = model.supportedActions ?? [];
  if (actions.includes("bidiGenerateContent")) {
    console.log(model.name.replace("models/", ""), "-", model.displayName);
  }
}
