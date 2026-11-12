// Checks shared by the viva API routes: the optional demo passcode and the caller's address.
import { timingSafeEqual } from "node:crypto";

/**
 * On a public URL, set DEMO_PASSCODE so strangers can't use the API.
 * Left unset (local dev), every request passes.
 */
export function passcodeOk(req: Request): boolean {
  const passcode = process.env.DEMO_PASSCODE;
  return !passcode || sameText(req.headers.get("x-demo-code") ?? "", passcode);
}

/**
 * Cloud Run adds the real caller address to the END of x-forwarded-for; anything
 * before it was written by the caller and can be faked. Assumes no load balancer in front.
 */
export function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
}

/** Reads a JSON body up to maxBytes. Empty body gives {}. */
export async function readJsonBody(
  req: Request,
  maxBytes: number,
): Promise<{ body: Record<string, unknown> } | { error: string; status: number }> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return { error: "The request is too large.", status: 413 };
  const raw = await req.text();
  if (Buffer.byteLength(raw) > maxBytes) return { error: "The request is too large.", status: 413 };
  if (!raw.trim()) return { body: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "The request body must be a JSON object.", status: 400 };
    }
    return { body: parsed };
  } catch {
    return { error: "The request body isn't valid JSON.", status: 400 };
  }
}

/** Compares two strings without leaking how many characters matched. */
function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
