// What happens when a viva ends: build its record once, with the right end
// reason, save it (or say it can't be saved), and ignore results that arrive
// after a new viva has started. Kept free of React so it can be tested.
import type { VivaMode, VivaPlan } from "./plan";
import { buildRecord, type EndReason, type VivaRecord } from "./record";
import type { SaveResult } from "./save";
import type { Transcript } from "./transcript";

/** What the server told us about a viva when it issued the pass. */
export type LiveViva = {
  vivaId: string;
  canSave: boolean;
  mode: VivaMode;
  plan: VivaPlan;
  startedAt: number;
  /** The submission the viva is about, as the server locked it; null for the sample. */
  submissionId?: string | null;
};

export type SaveState = "idle" | "saving" | "saved" | "failed" | "off";

export type FinisherState = {
  record: VivaRecord | null;
  saveState: SaveState;
  saveError: { message: string; canRetry: boolean } | null;
};

export const IDLE_STATE: FinisherState = { record: null, saveState: "idle", saveError: null };

export type Finisher = {
  /** A viva has gone live. Any earlier viva's late results are ignored from now on. */
  begin(viva: LiveViva): void;
  /** The viva started wrapping up for this reason (end_viva, time-up, goAway). */
  wrappingUp(reason: EndReason): void;
  /**
   * The viva is over. Builds and saves its record, once. If it was already wrapping
   * up, the wrap-up's reason wins, so pressing End during the goodbye isn't "stopped".
   */
  finish(reason: EndReason, transcript: Transcript): void;
  /** Try the last failed save again. */
  retry(): void;
  /** Forget the current viva without saving it (cancelled, or the page was closed). */
  reset(): void;
};

export function createVivaFinisher(opts: {
  save: (record: VivaRecord) => Promise<SaveResult>;
  onState: (state: FinisherState) => void;
  now?: () => number;
}): Finisher {
  const now = opts.now ?? Date.now;
  let viva: LiveViva | null = null;
  let closingReason: EndReason | null = null;
  let generation = 0; // bumped for every new viva or reset, so stale saves are ignored
  let last: VivaRecord | null = null;

  const save = async (record: VivaRecord, gen: number) => {
    opts.onState({ record, saveState: "saving", saveError: null });
    const result = await opts.save(record);
    if (gen !== generation) return; // a newer viva took over
    opts.onState(
      result.ok
        ? { record, saveState: "saved", saveError: null }
        : { record, saveState: "failed", saveError: { message: result.error, canRetry: result.canRetry } },
    );
  };

  return {
    begin(next) {
      generation++;
      viva = next;
      closingReason = null;
      last = null;
      opts.onState(IDLE_STATE);
    },
    wrappingUp(reason) {
      if (viva && !closingReason) closingReason = reason;
    },
    finish(reason, transcript) {
      if (!viva) return; // nothing live, or already finished
      const current = viva;
      viva = null;
      const record = buildRecord({
        vivaId: current.vivaId,
        submissionId: current.submissionId ?? null,
        mode: current.mode,
        plan: current.plan,
        startedAt: current.startedAt,
        endedAt: now(),
        endReason: closingReason ?? reason,
        transcript,
      });
      last = record;
      if (current.canSave) void save(record, generation);
      else opts.onState({ record, saveState: "off", saveError: null });
    },
    retry() {
      if (last) void save(last, generation);
    },
    reset() {
      generation++;
      viva = null;
      closingReason = null;
    },
  };
}
