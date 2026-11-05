import { describe, expect, it, vi } from "vitest";
import { answerToolCalls } from "./tool-calls";

const events = () => ({ onStartQuestion: vi.fn(), onEndViva: vi.fn() });

describe("answerToolCalls", () => {
  it("reports the question the examiner is starting, and says ok", () => {
    const e = events();
    const replies = answerToolCalls([{ id: "c1", name: "start_question", args: { question_id: "q2" } }], e);
    expect(e.onStartQuestion).toHaveBeenCalledWith("q2");
    expect(replies).toEqual([{ id: "c1", name: "start_question", response: { ok: true } }]);
  });

  it("reports the end of the viva with its reason", () => {
    const e = events();
    const replies = answerToolCalls([{ id: "c2", name: "end_viva", args: { reason: "time_up" } }], e);
    expect(e.onEndViva).toHaveBeenCalledWith("time_up");
    expect(replies[0].response).toEqual({ ok: true, note: "The viva is over. Say nothing more." });
  });

  it("answers every call in a batch, in order, and fires each event", () => {
    const e = events();
    const replies = answerToolCalls(
      [
        { id: "a", name: "start_question", args: { question_id: "q3" } },
        { id: "b", name: "end_viva", args: {} },
      ],
      e,
    );
    expect(replies.map((r) => r.id)).toEqual(["a", "b"]);
    expect(e.onStartQuestion).toHaveBeenCalledWith("q3");
    expect(e.onEndViva).toHaveBeenCalledWith("other"); // no reason given
  });

  it("treats an empty question id as missing", () => {
    const e = events();
    const [reply] = answerToolCalls([{ id: "z", name: "start_question", args: { question_id: "  " } }], e);
    expect(reply.response).toEqual({ error: "question_id is missing" });
    expect(e.onStartQuestion).not.toHaveBeenCalled();
  });

  it("rejects a question id that isn't in the plan, so the examiner can correct itself", () => {
    const e = { ...events(), knownQuestionIds: ["q1", "q2"] };
    const [bad] = answerToolCalls([{ id: "c", name: "start_question", args: { question_id: "q9" } }], e);
    expect(bad.response).toEqual({ error: 'No question "q9". Use one of: q1, q2' });
    expect(e.onStartQuestion).not.toHaveBeenCalled();
    const [good] = answerToolCalls([{ id: "d", name: "start_question", args: { question_id: "q2" } }], e);
    expect(good.response).toEqual({ ok: true });
  });

  it("still replies (with an error) to a bad or unknown call, so the examiner doesn't wait forever", () => {
    const e = events();
    const replies = answerToolCalls(
      [
        { id: "x", name: "start_question", args: {} },
        { id: "y", name: "open_door", args: {} },
      ],
      e,
    );
    expect(e.onStartQuestion).not.toHaveBeenCalled();
    expect(replies).toEqual([
      { id: "x", name: "start_question", response: { error: "question_id is missing" } },
      { id: "y", name: "open_door", response: { error: "Unknown tool: open_door" } },
    ]);
  });

  it("handles a message with no calls", () => {
    expect(answerToolCalls(undefined, events())).toEqual([]);
  });
});
