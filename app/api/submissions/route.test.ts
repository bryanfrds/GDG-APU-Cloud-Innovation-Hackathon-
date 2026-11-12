import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateQuestions = vi.fn();
vi.mock("@/lib/submissions/generate", () => ({ generateQuestions }));

const PLAN = {
  assignmentTitle: "Linked lists",
  questions: [
    { id: "q1", text: "Why a doubly linked list?", focus: "Design" },
    { id: "q2", text: "What does your remove() do at the tail?", focus: "Edge cases" },
  ],
};

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

function upload(fields: { title?: string; file?: File }, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (fields.title !== undefined) form.set("title", fields.title);
  if (fields.file) form.set("file", fields.file);
  return new Request("http://localhost/api/submissions", { method: "POST", headers, body: form });
}

const javaFile = () => new File(["class LinkedList { void remove() {} }"], "LinkedList.java");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "submissions-"));
  vi.stubEnv("VIVA_DATA_DIR", dir);
  vi.stubEnv("DEMO_PASSCODE", "");
  generateQuestions.mockReset();
  generateQuestions.mockResolvedValue({ plan: PLAN, details: [{ id: "q1", topic: "Design", snippet: "class LinkedList" }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/submissions", () => {
  it("saves the work and its questions, and returns the questions but never the text", async () => {
    const { POST } = await loadRoute();
    const res = await POST(upload({ title: "Linked lists", file: javaFile() }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submissionId).toMatch(/^sub_[0-9a-f]{20}$/);
    expect(body.plan).toEqual(PLAN);
    expect(JSON.stringify(body)).not.toContain("class LinkedList");
    expect(generateQuestions).toHaveBeenCalledWith("Linked lists", "class LinkedList { void remove() {} }");

    const { getSubmission } = await import("@/lib/submissions/store");
    const saved = await getSubmission(body.submissionId);
    expect(saved).toMatchObject({ title: "Linked lists", fileName: "LinkedList.java", kind: "code", plan: PLAN });
    expect(saved?.text).toContain("class LinkedList");
  });

  it("needs the passcode when one is set, before reading anything", async () => {
    vi.stubEnv("DEMO_PASSCODE", "letmein");
    const { POST } = await loadRoute();
    expect((await POST(upload({ title: "T", file: javaFile() }))).status).toBe(401);
    expect((await POST(upload({ title: "T", file: javaFile() }, { "x-demo-code": "letmein" }))).status).toBe(201);
    expect(generateQuestions).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing title or file, and a file it can't read, without calling Gemini", async () => {
    const { POST } = await loadRoute();
    expect((await POST(upload({ file: javaFile() }))).status).toBe(400);
    expect((await POST(upload({ title: "T" }))).status).toBe(400);
    expect((await POST(upload({ title: "x".repeat(121), file: javaFile() }))).status).toBe(400);
    expect((await POST(upload({ title: "T", file: new File(["x"], "photo.png") }))).status).toBe(422);
    expect(generateQuestions).not.toHaveBeenCalled();
  });

  it("passes on a Gemini failure as 502 and saves nothing", async () => {
    generateQuestions.mockResolvedValue({ error: "Couldn't write questions." });
    const { POST } = await loadRoute();
    const res = await POST(upload({ title: "T", file: javaFile() }));
    expect(res.status).toBe(502);
    const { listSubmissionIds } = await import("@/lib/submissions/store");
    expect(await listSubmissionIds()).toEqual([]);
  });

  it("limits uploads to 5 a minute from one address", async () => {
    const { POST } = await loadRoute();
    const from = { "x-forwarded-for": "9.9.9.9" };
    for (let i = 0; i < 5; i++) await POST(upload({ title: "T", file: javaFile() }, from));
    expect((await POST(upload({ title: "T", file: javaFile() }, from))).status).toBe(429);
  });
});
