import { describe, expect, it } from "vitest";
import { toQuestions } from "./generate";

const q = (question: string, topic = "Recursion", snippet = "def f(n): ...") => ({ question, topic, snippet });

describe("toQuestions", () => {
  it("turns Gemini's answer into a plan the viva accepts, keeping topics and snippets private", () => {
    const result = toQuestions("Fibonacci", { questions: [q("Why recursion?"), q("What is the base case?"), q("Big O?"), q("Memoise it?"), q("Extra")] });
    expect("plan" in result && result.plan).toEqual({
      assignmentTitle: "Fibonacci",
      questions: [
        { id: "q1", text: "Why recursion?", focus: "Recursion" },
        { id: "q2", text: "What is the base case?", focus: "Recursion" },
        { id: "q3", text: "Big O?", focus: "Recursion" },
        { id: "q4", text: "Memoise it?", focus: "Recursion" },
      ],
    });
    expect("details" in result && result.details[0]).toEqual({ id: "q1", topic: "Recursion", snippet: "def f(n): ..." });
  });

  it("flattens line breaks and hidden characters, and shortens long questions", () => {
    const result = toQuestions("T", { questions: [q("Line one\nline​ two"), q("x".repeat(600))] });
    if (!("plan" in result)) throw new Error(result.error);
    expect(result.plan.questions[0].text).toBe("Line one line two");
    expect(result.plan.questions[0].text).not.toMatch(/[\n​]/);
    expect(result.plan.questions[1].text.length).toBeLessThanOrEqual(400);
  });

  it("refuses too few or empty questions, and junk", () => {
    expect(toQuestions("T", { questions: [q("Only one")] })).toHaveProperty("error");
    expect(toQuestions("T", { questions: [q("Fine"), q("   ")] })).toHaveProperty("error");
    expect(toQuestions("T", null)).toHaveProperty("error");
    expect(toQuestions("T", { questions: "nope" })).toHaveProperty("error");
  });
});
