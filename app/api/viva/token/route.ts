// Hands the browser a short-lived, single-use pass for one viva.
// The real GEMINI_API_KEY stays on the server.
import { timingSafeEqual } from "node:crypto";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  EXAMINER_INSTRUCTIONS,
  TOKEN_SESSION_MS,
  TOKEN_START_WINDOW_MS,
  VIVA_MODEL,
} from "@/lib/viva/config";
import { createRateLimiter } from "@/lib/viva/rate-limit";

export const dynamic = "force-dynamic";

// At most 10 passes per minute from one address: plenty for a demo, and it
// stops a script from minting hundreds of 10-minute sessions on our bill.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(req: Request) {
  // On a public URL, set DEMO_PASSCODE so strangers can't run up the Gemini bill.
  // Left unset (local dev), anyone who can reach the server can start a viva.
  const passcode = process.env.DEMO_PASSCODE;
  if (passcode && !sameText(req.headers.get("x-demo-code") ?? "", passcode)) {
    return Response.json({ error: "Wrong or missing demo passcode." }, { status: 401 });
  }

  // Cloud Run adds the real caller address to the END of x-forwarded-for; anything
  // before it was written by the caller and can be faked.
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  if (!limiter.allow(ip)) {
    return Response.json({ error: "Too many vivas started. Wait a minute and try again." }, { status: 429 });
  }

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
        // Setting the constraints without lockAdditionalFields locks every Live
        // setting, so a pass can't be reused with other tools or settings.
        liveConnectConstraints: {
          model: VIVA_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: EXAMINER_INSTRUCTIONS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
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

/** Compares two strings without leaking how many characters matched. */
function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
