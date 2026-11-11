// Loads a student's saved question plan from the Python submissions service, server to server.
// The service URL and the demo passcode never reach the browser.
import { parsePlan, type VivaPlan } from "./plan";

export type PlanResult = { plan: VivaPlan } | { error: string; status: number };

const SAFE_SUBMISSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const FETCH_TIMEOUT_MS = 10_000;

/** The submissions service base URL, or null when this deployment has none (demo mode). */
export function submissionsApiUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.PROVE_IT_API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function isSubmissionId(input: unknown): input is string {
  return typeof input === "string" && SAFE_SUBMISSION_ID.test(input);
}

/** Fetches and validates the saved viva plan for one submission. Never returns private grading data. */
export async function loadSubmissionPlan(submissionId: string): Promise<PlanResult> {
  const base = submissionsApiUrl();
  if (!base) return { error: "Submissions are not set up on this server.", status: 503 };
  if (!isSubmissionId(submissionId)) return { error: "Unknown submission.", status: 404 };

  let res: Response;
  try {
    res = await fetch(`${base}/api/submissions/${encodeURIComponent(submissionId)}/viva-plan`, {
      headers: { "x-demo-code": process.env.DEMO_PASSCODE ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("Submissions service unreachable", err);
    return { error: "Could not reach the submissions service. Try again.", status: 502 };
  }

  if (res.status === 404) {
    // The service uses 404 both for an unknown submission and for questions not generated yet.
    const detail = await res.json().then((b) => String(b?.detail ?? ""), () => "");
    return /not been generated/i.test(detail)
      ? { error: "Questions for this submission aren't ready yet.", status: 409 }
      : { error: "Unknown submission.", status: 404 };
  }
  if (res.status === 429) return { error: "Too many requests. Wait a minute and try again.", status: 429 };
  if (res.status === 422) return { error: "The saved questions can't be used for a viva.", status: 422 };
  if (!res.ok) {
    // 401/403/5xx from the service is our misconfiguration or outage, not the student's fault.
    console.error("Submissions service returned", res.status);
    return { error: "The submissions service is unavailable. Try again.", status: 502 };
  }

  const parsed = parsePlan(await res.json().catch(() => null));
  if ("error" in parsed) return { error: "The saved questions can't be used for a viva.", status: 422 };
  return { plan: parsed.plan };
}
