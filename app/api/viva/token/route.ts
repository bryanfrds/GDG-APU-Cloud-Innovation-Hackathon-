// Hands the browser a short-lived, single-use pass for one viva.
// The real GEMINI_API_KEY stays on the server.
import { GoogleGenAI, Modality } from "@google/genai";
import { SESSION_GRACE_MS, TOKEN_START_WINDOW_MS, VIVA_MODEL } from "@/lib/viva/config";
import {
  buildExaminerInstructions,
  MODE_SECONDS,
  parseMode,
  parsePlan,
  SAMPLE_PLAN,
  type VivaPlan,
  VIVA_TOOLS,
} from "@/lib/viva/plan";
import { createRateLimiter } from "@/lib/viva/rate-limit";
import { clientAddress, passcodeOk, readJsonBody } from "@/lib/viva/request-guard";
import { newVivaId, saveSession } from "@/lib/viva/store";
import { isSubmissionId, loadSubmissionPlan, submissionsApiUrl } from "@/lib/viva/submission-plan";

export const dynamic = "force-dynamic";

// At most 10 passes per minute from one address: plenty for a demo, and it
// stops a script from minting hundreds of viva sessions on our bill.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// A full plan (4 questions with focus notes) is under 3 KB; anything near 16 KB is not a plan.
const MAX_BODY_BYTES = 16_000;

export async function POST(req: Request) {
  // Rate limit first, so wrong passcode guesses are limited too.
  if (!limiter.allow(clientAddress(req))) {
    return Response.json({ error: "Too many vivas started. Wait a minute and try again." }, { status: 429 });
  }
  if (!passcodeOk(req)) {
    return Response.json({ error: "Wrong or missing demo passcode." }, { status: 401 });
  }

  // The body says what this viva is about: { submissionId?, plan?, mode? }.
  // - submissionId: the questions saved for that submission are loaded here on the server.
  // - plan: a client-written plan. Only for demos: refused once a submissions service is configured,
  //   so a student can't send their own questions (VIVA_ALLOW_CLIENT_PLAN=1 re-enables it for testing).
  // - neither: the sample plan.
  const read = await readJsonBody(req, MAX_BODY_BYTES);
  if ("error" in read) return Response.json({ error: read.error }, { status: read.status });
  const body = read.body;

  let parsed: { plan: VivaPlan } | { error: string; status: number };
  let submissionId: string | undefined;
  if (body.submissionId !== undefined) {
    if (!isSubmissionId(body.submissionId)) return Response.json({ error: "Unknown submission." }, { status: 404 });
    submissionId = body.submissionId;
    parsed = await loadSubmissionPlan(submissionId);
  } else if (body.plan === undefined) {
    parsed = { plan: SAMPLE_PLAN };
  } else if (submissionsApiUrl() && process.env.VIVA_ALLOW_CLIENT_PLAN !== "1") {
    return Response.json({ error: "Start the viva from a submission." }, { status: 400 });
  } else {
    const checked = parsePlan(body.plan);
    parsed = "error" in checked ? { error: checked.error, status: 400 } : checked;
  }
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status });
  const mode = parseMode(body.mode);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server is missing GEMINI_API_KEY" }, { status: 500 });
  }

  // Tokens are a v1alpha feature of the Gemini API.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const now = Date.now();

  let token;
  try {
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(now + TOKEN_START_WINDOW_MS).toISOString(),
        // Room to connect, then the viva's time limit, then a little grace to finish the last sentence.
        expireTime: new Date(
          now + TOKEN_START_WINDOW_MS + MODE_SECONDS[mode] * 1000 + SESSION_GRACE_MS,
        ).toISOString(),
        // Setting the constraints without lockAdditionalFields locks every Live
        // setting, so a pass can't be reused with other tools or settings.
        liveConnectConstraints: {
          model: VIVA_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: buildExaminerInstructions(parsed.plan, mode),
            tools: VIVA_TOOLS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
      },
    });
  } catch (err) {
    console.error("Failed to create viva token", err);
    return Response.json({ error: "Could not start the viva. Try again." }, { status: 502 });
  }

  // Remember what this viva was locked to, so the saved record can be checked against it.
  // If that fails (say the disk isn't writable), still let the viva happen; it just can't be saved.
  const vivaId = newVivaId();
  let canSave = true;
  try {
    await saveSession({ vivaId, submissionId, plan: parsed.plan, mode, issuedAt: new Date(now).toISOString() });
  } catch (err) {
    console.error("Failed to save viva session; this viva can't be saved", err);
    canSave = false;
  }

  return Response.json(
    { token: token.name, model: VIVA_MODEL, vivaId, submissionId, canSave, mode, seconds: MODE_SECONDS[mode], plan: parsed.plan },
    { headers: { "Cache-Control": "no-store" } },
  );
}
