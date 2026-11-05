// Hands the browser a short-lived, single-use pass for one viva.
// The real GEMINI_API_KEY stays on the server.
import { GoogleGenAI, Modality } from "@google/genai";
import {
  EXAMINER_INSTRUCTIONS,
  TOKEN_SESSION_MS,
  TOKEN_START_WINDOW_MS,
  VIVA_MODEL,
} from "@/lib/viva/config";

export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server is missing GEMINI_API_KEY" }, { status: 500 });
  }

  // Tokens are a v1alpha feature of the Gemini API.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const now = Date.now();

  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(now + TOKEN_START_WINDOW_MS).toISOString(),
        expireTime: new Date(now + TOKEN_SESSION_MS).toISOString(),
        liveConnectConstraints: {
          model: VIVA_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: EXAMINER_INSTRUCTIONS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        lockAdditionalFields: [],
      },
    });

    return Response.json(
      { token: token.name, model: VIVA_MODEL },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("Failed to create viva token", err);
    return Response.json({ error: "Could not start the viva. Try again." }, { status: 502 });
  }
}
