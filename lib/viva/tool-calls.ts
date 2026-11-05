// Turns the examiner's tool calls (start_question, end_viva) into page events,
// and builds the replies Gemini waits for before it carries on talking.
import type { FunctionCall, FunctionResponse } from "@google/genai";

export type VivaEvents = {
  onStartQuestion: (questionId: string) => void;
  onEndViva: (reason: string) => void;
  /** The plan's question ids. When given, an id outside the plan gets an error reply. */
  knownQuestionIds?: string[];
};

/** Handles every call and returns one reply per call, so the examiner never waits forever. */
export function answerToolCalls(calls: FunctionCall[] | undefined, events: VivaEvents): FunctionResponse[] {
  return (calls ?? []).map((call) => {
    const args = (call.args ?? {}) as Record<string, unknown>;
    if (call.name === "start_question") {
      const id = typeof args.question_id === "string" ? args.question_id.trim() : "";
      if (!id) return { id: call.id, name: call.name, response: { error: "question_id is missing" } };
      const known = events.knownQuestionIds;
      if (known && !known.includes(id)) {
        return { id: call.id, name: call.name, response: { error: `No question "${id}". Use one of: ${known.join(", ")}` } };
      }
      events.onStartQuestion(id);
      return { id: call.id, name: call.name, response: { ok: true } };
    }
    if (call.name === "end_viva") {
      events.onEndViva(typeof args.reason === "string" ? args.reason : "other");
      // Without this, the examiner tends to add another goodbye after ending.
      return { id: call.id, name: call.name, response: { ok: true, note: "The viva is over. Say nothing more." } };
    }
    return { id: call.id, name: call.name, response: { error: `Unknown tool: ${call.name}` } };
  });
}
