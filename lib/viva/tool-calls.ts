// Turns the examiner's tool calls (start_question, end_viva) into page events,
// and builds the replies Gemini waits for before it carries on talking.
import type { FunctionCall, FunctionResponse } from "@google/genai";

export type VivaEvents = {
  onStartQuestion: (questionId: string) => void;
  onEndViva: (reason: string) => void;
};

/** Handles every call and returns one reply per call, so the examiner never waits forever. */
export function answerToolCalls(calls: FunctionCall[] | undefined, events: VivaEvents): FunctionResponse[] {
  return (calls ?? []).map((call) => {
    const args = (call.args ?? {}) as Record<string, unknown>;
    if (call.name === "start_question") {
      const id = typeof args.question_id === "string" ? args.question_id : "";
      if (id) events.onStartQuestion(id);
      return { id: call.id, name: call.name, response: id ? { ok: true } : { error: "question_id is missing" } };
    }
    if (call.name === "end_viva") {
      events.onEndViva(typeof args.reason === "string" ? args.reason : "other");
      // Without this, the examiner tends to add another goodbye after ending.
      return { id: call.id, name: call.name, response: { ok: true, note: "The viva is over. Say nothing more." } };
    }
    return { id: call.id, name: call.name, response: { error: `Unknown tool: ${call.name}` } };
  });
}
