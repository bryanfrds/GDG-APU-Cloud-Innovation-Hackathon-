import { describe, expect, it, vi } from "vitest";
import { SAMPLE_PLAN } from "./plan";
import type { VivaRecord } from "./record";
import { recordFileName, sendRecord } from "./save";

const record: VivaRecord = {
  version: 1,
  vivaId: "viva_0123456789abcdef01234567",
  submissionId: null,
  mode: "demo",
  plan: SAMPLE_PLAN,
  startedAt: "2026-11-05T10:00:00.000Z",
  endedAt: "2026-11-05T10:00:30.000Z",
  endReason: "completed",
  truncated: false,
  turns: [],
};

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("sendRecord", () => {
  it("posts the record, with the passcode when there is one", async () => {
    const fetchImpl = reply(201, { ok: true, vivaId: record.vivaId });
    expect(await sendRecord(record, "letmein", fetchImpl)).toEqual({ ok: true, alreadySaved: false });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/viva/records");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-demo-code": "letmein" });
    expect(JSON.parse(init.body)).toEqual(record);
  });

  it("leaves the passcode header out when there isn't one", async () => {
    const fetchImpl = reply(201, { ok: true });
    await sendRecord(record, "", fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers).not.toHaveProperty("x-demo-code");
  });

  it("treats an identical retry the server already has as saved", async () => {
    expect(await sendRecord(record, "", reply(200, { ok: true, alreadySaved: true }))).toEqual({ ok: true, alreadySaved: true });
  });

  it("offers a retry when the server is busy or broken, or can't be reached", async () => {
    expect(await sendRecord(record, "", reply(429, { error: "Too many saves." }))).toEqual({ ok: false, error: "Too many saves.", canRetry: true });
    expect(await sendRecord(record, "", reply(500, {}))).toEqual({ ok: false, error: "Saving failed (500).", canRetry: true });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await sendRecord(record, "", offline)).toEqual({ ok: false, error: "Couldn't reach the server to save the viva.", canRetry: true });
  });

  it("doesn't offer a retry when the server refused the record itself", async () => {
    const result = await sendRecord(record, "", reply(409, { error: "The record doesn't match the viva that was started." }));
    expect(result).toEqual({ ok: false, error: "The record doesn't match the viva that was started.", canRetry: false });
  });

  it("copes with an error page that isn't JSON", async () => {
    const html = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    expect(await sendRecord(record, "", html)).toEqual({ ok: false, error: "Saving failed (502).", canRetry: true });
  });
});

describe("recordFileName", () => {
  it("names the file by date and viva id", () => {
    expect(recordFileName(record)).toBe("viva-2026-11-05-viva_0123456789abcdef01234567.json");
  });
});
