// POST /api/submissions: a student uploads their assignment (multipart: title + file).
// The server extracts the text, asks Gemini for viva questions about it, saves both,
// and returns the submission id plus the questions (never the extracted text).
import { extractAssignmentText, MAX_FILE_BYTES } from "@/lib/submissions/extract";
import { generateQuestions } from "@/lib/submissions/generate";
import { newSubmissionId, saveSubmission } from "@/lib/submissions/store";
import { stripHiddenChars } from "@/lib/viva/plan";
import { createRateLimiter } from "@/lib/viva/rate-limit";
import { clientAddress, passcodeOk } from "@/lib/viva/request-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Gemini can take ~20 s on a long assignment

// Each upload costs a Gemini call: 5 a minute from one address is plenty for a class demo.
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

export async function POST(req: Request) {
  if (!limiter.allow(clientAddress(req))) {
    return Response.json({ error: "Too many uploads. Wait a minute and try again." }, { status: 429 });
  }
  if (!passcodeOk(req)) {
    return Response.json({ error: "Wrong or missing demo passcode." }, { status: 401 });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES + 64_000) {
    return Response.json({ error: "That file is over 2 MB." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the title and file as a form." }, { status: 400 });
  }
  const title = stripHiddenChars(String(form.get("title") ?? "")).trim();
  const file = form.get("file");
  if (!title) return Response.json({ error: "Give the assignment a title." }, { status: 400 });
  if (title.length > 120) return Response.json({ error: "The title is too long (at most 120 characters)." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });

  const extracted = await extractAssignmentText(file.name, new Uint8Array(await file.arrayBuffer()));
  if ("error" in extracted) return Response.json({ error: extracted.error }, { status: 422 });

  const generated = await generateQuestions(title, extracted.text);
  if ("error" in generated) return Response.json({ error: generated.error }, { status: 502 });

  const submissionId = newSubmissionId();
  try {
    await saveSubmission({
      submissionId,
      title,
      fileName: stripHiddenChars(file.name).slice(0, 200),
      kind: extracted.kind,
      text: extracted.text,
      plan: generated.plan,
      details: generated.details,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to save submission", err);
    return Response.json({ error: "Couldn't save your submission. Try again." }, { status: 500 });
  }

  return Response.json(
    { submissionId, plan: generated.plan },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
