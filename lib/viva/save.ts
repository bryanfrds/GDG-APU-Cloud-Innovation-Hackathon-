// Sends a finished viva to the server (POST /api/viva/records) and explains the result.
import type { VivaRecord } from "./record";

export type SaveResult =
  | { ok: true; alreadySaved: boolean }
  | { ok: false; error: string; canRetry: boolean };

const TIMEOUT_MS = 15000;

export async function sendRecord(
  record: VivaRecord,
  passcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/viva/records", {
      method: "POST",
      headers: { "content-type": "application/json", ...(passcode ? { "x-demo-code": passcode } : {}) },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server to save the viva.", canRetry: true };
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string; alreadySaved?: boolean };
  if (res.ok) return { ok: true, alreadySaved: Boolean(body.alreadySaved) };

  // Busy or broken server: worth trying again. Anything else won't change on a retry.
  const canRetry = res.status === 429 || res.status >= 500;
  return { ok: false, error: body.error ?? `Saving failed (${res.status}).`, canRetry };
}

/** A file name for downloading a record, e.g. "viva-2026-11-05-viva_ab12….json". */
export function recordFileName(record: VivaRecord): string {
  return `viva-${record.startedAt.slice(0, 10)}-${record.vivaId}.json`;
}
