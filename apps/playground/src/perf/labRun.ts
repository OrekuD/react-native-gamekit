/**
 * Performance Lab run controller (F1).
 *
 * Platform-neutral run lifecycle for the mounted-pipeline scenarios: run
 * identity and boundaries, UI→RN transfer merging with run-id guards, and
 * final result assembly. The controller is deliberately pure — it never
 * touches React, Reanimated, or the session — so the run rules are enforced
 * by node tests; the host component supplies the live pipeline around it.
 *
 * Run rules:
 * - A scenario cannot start without a mounted pipeline host (`start` throws).
 * - Run ids are monotonically issued; a stale id is rejected.
 * - UI transfers are merged only for the active run id; a late final
 *   transfer from a completed or aborted run is ignored.
 * - The result is emitted exactly once: after the host finishes its side
 *   AND the final UI transfer lands.
 */

import type { UiFrameSummary, UiTransfer } from './uiMetrics.ts';
import { createUiAggregator, summarizeUi } from './uiMetrics.ts';
import { CounterSeries, PerfSummary, type SeriesSnapshot } from './summary.ts';

export type PerfScenarioId = 'idle-active' | 'engine-drag' | 'stall' | 'native-drag';

export interface LabRunSpec {
  readonly scenario: PerfScenarioId;
  readonly durationMs: number;
}

/** Pointer pipeline stage counts for the native-input scenario. */
export interface InputStageCounters {
  /** Raw touches observed at the manual gesture (UI runtime). */
  readonly raw: number;
  /** Coalesced events that crossed into the RN runtime. */
  readonly forwarded: number;
  /** Input buffer samples taken by the session. */
  readonly sampled: number;
  /** Commits published by the session. */
  readonly committed: number;
  /** Commits presented to the canvas. */
  readonly presented: number;
}

export interface ScenarioResult {
  readonly runId: number;
  readonly scenario: PerfScenarioId;
  readonly game: string;
  readonly durationMs: number;
  /** RN-side session counters and durations. */
  readonly summary: PerfSummary;
  /** Merged UI frame summary; present only after the final UI transfer. */
  readonly ui: UiFrameSummary | undefined;
  /** Native-input stage counters; present only for the native-drag scenario. */
  readonly inputStages: InputStageCounters | undefined;
  /** Native input timestamp → first presented commit latency samples. */
  readonly inputToPresentMs: SeriesSnapshot | undefined;
}

export interface LabRunControllerOptions {
  readonly onComplete: (result: ScenarioResult) => void;
}

let nextIssuedRunId = 1;

/** Issue the next run id. The screen uses it as the host mount key. */
export function issueRunId(): number {
  const runId = nextIssuedRunId;
  nextIssuedRunId += 1;
  return runId;
}

export class LabRunController {
  readonly #onComplete: (result: ScenarioResult) => void;
  #hostAttached = false;
  #activeRunId = -1;
  #spec: LabRunSpec | undefined;
  #jsSummary = new PerfSummary();
  #durationMs = 0;
  #game = '';
  #uiMerged = createUiAggregator();
  #finalTransferLanded = false;
  #completed = false;
  #inputStages: { raw: number; forwarded: number } | undefined;
  #presentedCount = 0;
  #pendingForwardedAtMs: number | undefined;
  readonly #inputToPresent = new CounterSeries();

  constructor(options: LabRunControllerOptions) {
    this.#onComplete = options.onComplete;
  }

  get activeRunId(): number {
    return this.#activeRunId;
  }

  /** The mounted pipeline host registered itself. */
  attachHost(): void {
    this.#hostAttached = true;
  }

  /**
   * The pipeline host unmounted (or was never there): abort the active run —
   * its UI samples must never be consumed after the host is gone.
   */
  detachHost(): void {
    this.#hostAttached = false;
    this.abort();
  }

  /**
   * Begin a run. Throws when no pipeline host is mounted or the run id is
   * stale, so a renderer/pointer scenario can never run unmounted.
   */
  start(spec: LabRunSpec, runId: number): void {
    if (!this.#hostAttached) {
      throw new Error(
        'Performance Lab scenario requires the mounted game pipeline (GameView + renderer + pointer surface); cannot start an unmounted scenario.',
      );
    }
    if (runId <= this.#activeRunId) {
      throw new Error(`Performance Lab run id ${runId} is stale; the active run is ${this.#activeRunId}.`);
    }
    this.#activeRunId = runId;
    this.#spec = spec;
    this.#jsSummary = new PerfSummary();
    this.#uiMerged = createUiAggregator();
    this.#finalTransferLanded = false;
    this.#completed = false;
    this.#inputStages = undefined;
    this.#presentedCount = 0;
    this.#pendingForwardedAtMs = undefined;
    this.#inputToPresent.reset();
  }

  /** A UI→RN transfer arrived. Merged only for the active run id. */
  onUiTransfer(transfer: UiTransfer): void {
    if (this.#completed || transfer.runId !== this.#activeRunId) {
      return;
    }
    this.#uiMerged.replace(transfer);
    if (transfer.final) {
      this.#finalTransferLanded = true;
      this.#maybeComplete();
    }
  }

  /**
   * The host finished its side: session paused, RN summary assembled. The
   * result is emitted once the final UI transfer lands.
   */
  finishHost(summary: PerfSummary, durationMs: number, game: string): void {
    this.#jsSummary = summary;
    this.#durationMs = durationMs;
    this.#game = game;
    this.#maybeComplete();
  }

  /** Native-input stage counts read from UI-runtime shared values. */
  setInputStages(raw: number, forwarded: number): void {
    this.#inputStages = { raw, forwarded };
  }

  /**
   * A commit was presented (RN runtime). `forwardedAtMs` is the UI-runtime
   * timestamp of the most recent forwarded pointer event, read from a shared
   * value; when present and strictly older than the presentation, it yields
   * one input-to-present latency sample.
   */
  onPresentCommit(revision: number, atMs: number, forwardedAtMs: number | undefined): void {
    if (this.#completed) {
      return;
    }
    void revision;
    this.#presentedCount += 1;
    if (forwardedAtMs !== undefined && atMs >= forwardedAtMs) {
      this.#inputToPresent.record(atMs - forwardedAtMs);
    }
    this.#pendingForwardedAtMs = undefined;
  }

  /** Drop the active run without emitting a result. */
  abort(): void {
    this.#completed = true;
    this.#activeRunId = -1;
    this.#spec = undefined;
  }

  #maybeComplete(): void {
    if (this.#completed || !this.#finalTransferLanded || this.#spec === undefined) {
      return;
    }
    this.#completed = true;
    const runId = this.#activeRunId;
    this.#activeRunId = -1;
    const stages =
      this.#spec.scenario === 'native-drag' && this.#inputStages !== undefined
        ? {
            raw: this.#inputStages.raw,
            forwarded: this.#inputStages.forwarded,
            sampled: this.#jsSummary.seriesSnapshot().get('input-sample-ms')?.count ?? 0,
            committed: this.#jsSummary.getCounter('commits'),
            presented: this.#presentedCount,
          }
        : undefined;
    this.#onComplete({
      runId,
      scenario: this.#spec.scenario,
      game: this.#game,
      durationMs: this.#durationMs,
      summary: this.#jsSummary,
      ui: summarizeUi(this.#uiMerged),
      inputStages: stages,
      inputToPresentMs:
        this.#inputToPresent.count > 0 ? this.#inputToPresent.snapshot() : undefined,
    });
    this.#spec = undefined;
  }
}
