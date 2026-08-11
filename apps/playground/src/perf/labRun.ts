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
  /** Native forward timestamp → first commit that sampled the input. */
  readonly inputToCommitMs: SeriesSnapshot | undefined;
  /** That commit's revision → first UI frame that observed it. */
  readonly inputToUiObservedMs: SeriesSnapshot | undefined;
  /** Explainable sample accounting for the native latency metric. */
  readonly latencyCounters:
    | { readonly matched: number; readonly unmatched: number; readonly rejected: number; readonly superseded: number }
    | undefined;
  /** Trailing-flush samplers still mounted at run end (must be 0). */
  readonly samplersAtEnd: number;
}

export interface LabRunControllerOptions {
  readonly onComplete: (result: ScenarioResult) => void;
}

/** Bounded pending structures for the native latency metric (F1 follow-up). */
const MAX_PENDING_FORWARDS = 64;
const MAX_PENDING_REVISIONS = 32;

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
  /** Bounded pending forwards: acknowledged on the RN side, awaiting the
   * first commit whose sampled-input counter reaches their buffer count. */
  readonly #pending: { seq: number; atMs: number; bufferCount: number }[] = [];
  /** Bounded revision → forward timestamp map awaiting UI observation. */
  readonly #matchedByRevision = new Map<number, number>();
  #latencyMatched = 0;
  #latencyUnmatched = 0;
  #latencyRejected = 0;
  #latencySuperseded = 0;
  #samplersAtEnd = 0;
  readonly #inputToCommit = new CounterSeries();
  readonly #inputToUiObserved = new CounterSeries();

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
    this.#pending.length = 0;
    this.#matchedByRevision.clear();
    this.#latencyMatched = 0;
    this.#latencyUnmatched = 0;
    this.#latencyRejected = 0;
    this.#latencySuperseded = 0;
    this.#samplersAtEnd = 0;
    this.#inputToCommit.reset();
    this.#inputToUiObserved.reset();
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
  /** The sampler count observed at run end (F2 acceptance evidence). */
  setSamplerCount(count: number): void {
    this.#samplersAtEnd = count;
  }

  setInputStages(raw: number, forwarded: number): void {
    this.#inputStages = { raw, forwarded };
  }

  /**
   * RN-side result of dispatching one pointer packet (F1 follow-up).
   *
   * `seq`/`atMs` are the UI-runtime forward sequence and timestamp carried
   * with the packet; `bufferCount` is the session input buffer's accepted-
   * event counter at dispatch time; `accepted` is the binding's verdict.
   * Rejected (stale epoch/generation) packets are counted and never become
   * samples; accepted packets enter the bounded pending structure.
   */
  onForwardResult(seq: number, atMs: number, bufferCount: number, accepted: boolean): void {
    if (this.#completed) {
      return;
    }
    if (!accepted) {
      this.#latencyRejected += 1;
      return;
    }
    if (this.#pending.length >= MAX_PENDING_FORWARDS) {
      this.#pending.shift();
      this.#latencySuperseded += 1;
    }
    this.#pending.push({ seq, atMs, bufferCount });
  }

  /**
   * A commit was published (RN runtime). `sampledCount` is the session input
   * buffer's accepted-event counter after the commit's last sampled step, so
   * only a commit that actually sampled an accepted forward can consume it.
   * Multiple forwards in one commit follow the documented aggregation rule:
   * the newest accepted input is the sample; older ones are superseded.
   */
  onCommit(revision: number, atMs: number, sampledCount: number): void {
    if (this.#completed) {
      return;
    }
    this.#presentedCount += 1;
    let matchIndex = -1;
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const entry = this.#pending[index];
      if (entry !== undefined && entry.bufferCount <= sampledCount) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex < 0) {
      return; // This commit did not sample any pending forward.
    }
    const matched = this.#pending[matchIndex]!;
    this.#pending.length = matchIndex; // Drop the matched entry and everything older.
    this.#latencySuperseded += matchIndex; // Older pending forwards in the same commit.
    this.#latencyMatched += 1;
    if (atMs >= matched.atMs) {
      this.#inputToCommit.record(atMs - matched.atMs);
    }
    if (this.#matchedByRevision.size >= MAX_PENDING_REVISIONS) {
      this.#matchedByRevision.delete(this.#matchedByRevision.keys().next().value as number);
    }
    this.#matchedByRevision.set(revision, matched.atMs);
  }

  /**
   * The first UI frame that observed `revision` (the UI alpha clock's reset
   * detects the new commit). Later observations of the same revision record
   * nothing; Skia GPU presentation is not proven, so this stage is named
   * honestly `input-to-ui-observed`.
   */
  onUiObserved(revision: number, atMs: number): void {
    if (this.#completed) {
      return;
    }
    const forwardAtMs = this.#matchedByRevision.get(revision);
    if (forwardAtMs === undefined) {
      return;
    }
    this.#matchedByRevision.delete(revision);
    if (atMs >= forwardAtMs) {
      this.#inputToUiObserved.record(atMs - forwardAtMs);
    }
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
      inputToCommitMs: this.#inputToCommit.count > 0 ? this.#inputToCommit.snapshot() : undefined,
      inputToUiObservedMs:
        this.#inputToUiObserved.count > 0 ? this.#inputToUiObserved.snapshot() : undefined,
      latencyCounters:
        this.#spec.scenario !== 'native-drag'
          ? undefined
          : {
              matched: this.#latencyMatched,
              unmatched: this.#pending.length + this.#matchedByRevision.size,
              rejected: this.#latencyRejected,
              superseded: this.#latencySuperseded,
            },
      samplersAtEnd: this.#samplersAtEnd,
    });
    this.#spec = undefined;
  }
}
