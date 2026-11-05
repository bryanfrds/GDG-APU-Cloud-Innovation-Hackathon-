import { describe, expect, it, vi } from "vitest";
import { createVivaFinisher, type FinisherState, type LiveViva } from "./finisher";
import { SAMPLE_PLAN } from "./plan";
import type { VivaRecord } from "./record";
import type { SaveResult } from "./save";
import { appendText, EMPTY_TRANSCRIPT } from "./transcript";

const START = Date.parse("2026-11-05T10:00:00Z");
const viva = (overrides: Partial<LiveViva> = {}): LiveViva => ({
  vivaId: "viva_0123456789abcdef01234567",
  canSave: true,
  mode: "demo",
  plan: SAMPLE_PLAN,
  startedAt: START,
  ...overrides,
});
const transcript = appendText(EMPTY_TRANSCRIPT, "ai", "Which algorithm?", { questionId: "q1", atMs: 500 });

/** A save we can finish by hand, to test what happens when results arrive late. */
function controllableSave() {
  const pending: { record: VivaRecord; resolve: (r: SaveResult) => void }[] = [];
  const save = vi.fn((record: VivaRecord) => new Promise<SaveResult>((resolve) => pending.push({ record, resolve })));
  return { save, pending };
}

function setup() {
  const { save, pending } = controllableSave();
  const states: FinisherState[] = [];
  const finisher = createVivaFinisher({ save, onState: (s) => states.push(s), now: () => START + 20_000 });
  const lastState = () => states.at(-1)!;
  return { finisher, save, pending, states, lastState };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createVivaFinisher", () => {
  it("builds the record from the transcript and saves it", async () => {
    const { finisher, save, pending, lastState } = setup();
    finisher.begin(viva());
    finisher.finish("completed", transcript);
    expect(save).toHaveBeenCalledTimes(1);
    expect(lastState().saveState).toBe("saving");
    expect(pending[0].record).toMatchObject({ endReason: "completed", turns: [{ text: "Which algorithm?", questionId: "q1" }] });
    pending[0].resolve({ ok: true, alreadySaved: false });
    await flush();
    expect(lastState()).toMatchObject({ saveState: "saved", saveError: null });
  });

  it("saves only once, however many endings are reported", () => {
    const { finisher, save } = setup();
    finisher.begin(viva());
    finisher.finish("completed", transcript);
    finisher.finish("error", transcript);
    finisher.finish("stopped", transcript);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["completed", "completed"],
    ["time_up", "time_up"],
    ["session_ended", "session_ended"],
  ] as const)("keeps the wrap-up reason (%s) when End is pressed during the goodbye", (wrapReason, expected) => {
    const { finisher, pending } = setup();
    finisher.begin(viva());
    finisher.wrappingUp(wrapReason);
    finisher.finish("stopped", transcript);
    expect(pending[0].record.endReason).toBe(expected);
  });

  it("records 'stopped' when End is pressed before any wrap-up", () => {
    const { finisher, pending } = setup();
    finisher.begin(viva());
    finisher.finish("stopped", transcript);
    expect(pending[0].record.endReason).toBe("stopped");
  });

  it("keeps the first wrap-up reason if a second one arrives", () => {
    const { finisher, pending } = setup();
    finisher.begin(viva());
    finisher.wrappingUp("time_up");
    finisher.wrappingUp("completed"); // the examiner calls end_viva after time-up
    finisher.finish("completed", transcript);
    expect(pending[0].record.endReason).toBe("time_up");
  });

  it("ignores a late save result from the previous viva", async () => {
    const { finisher, pending, lastState } = setup();
    finisher.begin(viva());
    finisher.finish("completed", transcript); // viva A's save is still in flight
    finisher.begin(viva({ vivaId: "viva_bbbbbbbbbbbbbbbbbbbbbbbb", canSave: false }));
    finisher.finish("completed", transcript); // viva B can't be saved
    expect(lastState().saveState).toBe("off");
    pending[0].resolve({ ok: true, alreadySaved: false }); // A finishes late
    await flush();
    expect(lastState().saveState).toBe("off");
    expect(lastState().record?.vivaId).toBe("viva_bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("never posts a viva that can't be saved, and says so", () => {
    const { finisher, save, lastState } = setup();
    finisher.begin(viva({ canSave: false }));
    finisher.finish("completed", transcript);
    expect(save).not.toHaveBeenCalled();
    expect(lastState()).toMatchObject({ saveState: "off", record: expect.any(Object) });
  });

  it("saves nothing when no viva went live, or after a reset", () => {
    const { finisher, save } = setup();
    finisher.finish("stopped", transcript); // cancelled before it went live
    finisher.begin(viva());
    finisher.reset(); // page closed mid-viva
    finisher.finish("stopped", transcript);
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a failed save and can retry it", async () => {
    const { finisher, save, pending, lastState } = setup();
    finisher.begin(viva());
    finisher.finish("completed", transcript);
    pending[0].resolve({ ok: false, error: "Couldn't reach the server to save the viva.", canRetry: true });
    await flush();
    expect(lastState()).toMatchObject({ saveState: "failed", saveError: { canRetry: true } });
    finisher.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(pending[1].record).toBe(pending[0].record); // the same record again
    pending[1].resolve({ ok: true, alreadySaved: true });
    await flush();
    expect(lastState().saveState).toBe("saved");
  });

  it("starts each viva with a clean status", () => {
    const { finisher, states } = setup();
    finisher.begin(viva());
    expect(states.at(-1)).toEqual({ record: null, saveState: "idle", saveError: null });
  });
});
