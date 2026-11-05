import { describe, expect, it } from "vitest";
import { buildExaminerInstructions, parseMode, parsePlan, SAMPLE_PLAN, VIVA_TOOLS } from "./plan";

const good = {
  assignmentTitle: "  Linked lists  ",
  questions: [
    { id: "q1", text: " What does your insert function do? ", focus: "Explains pointer updates" },
    { id: "q2", text: "What happens with an empty list?" },
  ],
};

describe("parsePlan", () => {
  it("accepts a good plan and trims it", () => {
    const result = parsePlan(good);
    expect(result).toEqual({
      plan: {
        assignmentTitle: "Linked lists",
        questions: [
          { id: "q1", text: "What does your insert function do?", focus: "Explains pointer updates" },
          { id: "q2", text: "What happens with an empty list?" },
        ],
      },
    });
  });

  it("accepts the sample plan", () => {
    expect(parsePlan(SAMPLE_PLAN)).toEqual({ plan: SAMPLE_PLAN });
  });

  it.each([
    ["nothing", undefined],
    ["no title", { ...good, assignmentTitle: " " }],
    ["no questions", { ...good, questions: [] }],
    ["too many questions", { ...good, questions: Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, text: "Why?" })) }],
    ["a bad id", { ...good, questions: [{ id: "q 1!", text: "Why?" }] }],
    ["a repeated id", { ...good, questions: [{ id: "q1", text: "A?" }, { id: "q1", text: "B?" }] }],
    ["an empty question", { ...good, questions: [{ id: "q1", text: "" }] }],
    ["a very long question", { ...good, questions: [{ id: "q1", text: "x".repeat(401) }] }],
  ])("rejects %s", (_label, input) => {
    expect(parsePlan(input)).toHaveProperty("error");
  });
});

describe("parseMode", () => {
  it("only gives demo mode when asked, otherwise full", () => {
    expect(parseMode("demo")).toBe("demo");
    expect(parseMode("full")).toBe("full");
    expect(parseMode("anything else")).toBe("full");
    expect(parseMode(undefined)).toBe("full");
  });
});

describe("buildExaminerInstructions", () => {
  const { plan } = parsePlan(good) as { plan: typeof SAMPLE_PLAN };

  it("lists every question with its id and focus", () => {
    const text = buildExaminerInstructions(plan, "full");
    expect(text).toContain("Assignment: Linked lists");
    expect(text).toContain("[q1] What does your insert function do?");
    expect(text).toContain("A good answer: Explains pointer updates");
    expect(text).toContain("[q2] What happens with an empty list?");
  });

  it("tells the examiner to report progress, not give answers, and end with the tool", () => {
    const text = buildExaminerInstructions(plan, "full");
    expect(text).toMatch(/call start_question/);
    expect(text).toMatch(/call end_viva/);
    expect(text).toMatch(/Never give away the answer/);
    expect(text).toMatch(/about 5 minutes/);
  });

  it("keeps the demo to one question", () => {
    const text = buildExaminerInstructions(plan, "demo");
    expect(text).toMatch(/30-second demo/);
    expect(text).toMatch(/only the first question/);
  });
});

describe("VIVA_TOOLS", () => {
  it("declares start_question and end_viva", () => {
    const names = VIVA_TOOLS.flatMap((t) => t.functionDeclarations ?? []).map((f) => f.name);
    expect(names).toEqual(["start_question", "end_viva"]);
  });
});
