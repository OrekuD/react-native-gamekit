/**
 * UI frame-metric aggregation (F1).
 *
 * Constant-space aggregation of UI presentation frame deltas, built exactly
 * like the pointer coalescer: a factory returns a stateful object whose
 * methods are worklets that close over their own state. The UI runtime
 * captures the aggregator through the host's frame-callback closure (never
 * passed as a worklet argument — an object passed across runtimes is
 * serialized and its keys cannot be modified afterwards), so all mutation
 * happens on the UI-side copy and only transfer snapshots cross runtimes.
 *
 * Frames are binned into a fixed histogram (no per-frame allocations, no
 * growth with run length) and transferred to the RN runtime at most once
 * per second of **elapsed time** plus once at run completion. Percentiles
 * are computed from the histogram when the run finishes.
 */

/** Histogram bucket width in milliseconds. */
export const UI_BUCKET_MS = 0.25;
/** Fixed bucket count: covers 0..64 ms; larger deltas clamp into the cap. */
export const UI_BUCKET_COUNT = 256;
/** Hard cap of the histogram in milliseconds. */
export const UI_CAP_MS = UI_BUCKET_MS * UI_BUCKET_COUNT;
/** Elapsed-time interval between intermediate UI→RN transfers. */
export const UI_TRANSFER_INTERVAL_MS = 1000;

/** A fixed-size snapshot of the histogram sent UI→RN. */
export interface UiTransfer {
  /** Run id the samples belong to; receivers must reject mismatches. */
  readonly runId: number;
  /** True for the run-completion flush; intermediate transfers are false. */
  readonly final: boolean;
  readonly count: number;
  readonly sumMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** Fixed-size bucket counts (UI_BUCKET_COUNT entries). */
  readonly buckets: readonly number[];
}

/** UI frame summary merged on the RN runtime for the final result. */
export interface UiFrameSummary {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Worklet-safe, constant-space UI aggregation state. */
export interface UiAggregator {
  /** Reset for a run; frames recorded before a begin are ignored. */
  begin(runId: number): void;
  /**
   * Record one UI frame delta in constant time and space. Returns an
   * intermediate transfer when a full transfer interval has elapsed.
   */
  record(deltaMs: number): UiTransfer | undefined;
  /** Final transfer for the run; emits nothing once flushed. */
  flush(): UiTransfer | undefined;
  /**
   * Replace this (RN-side) accumulator with a transfer. Transfers are
   * cumulative snapshots of the UI-side aggregator (each one is a superset
   * of the previous), so the latest accepted transfer is the complete state;
   * merging them would double-count.
   */
  replace(transfer: UiTransfer): void;
  readonly runId: number;
  readonly count: number;
  readonly sumMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly buckets: number[];
}

export function createUiAggregator(runId = -1): UiAggregator {
  // Worklet-safe state: the UI runtime mutates this captured object through
  // the methods below; the JS copy is a separate snapshot (coalescer rule).
  const state = {
    runId,
    count: 0,
    sumMs: 0,
    minMs: 0,
    maxMs: 0,
    elapsedMs: 0,
    lastTransferMs: 0,
    flushed: false,
    buckets: new Array<number>(UI_BUCKET_COUNT).fill(0),
  };

  const begin = (runId: number): void => {
    'worklet';
    state.runId = runId;
    state.count = 0;
    state.sumMs = 0;
    state.minMs = 0;
    state.maxMs = 0;
    state.elapsedMs = 0;
    state.lastTransferMs = 0;
    state.flushed = false;
    for (let index = 0; index < state.buckets.length; index += 1) {
      state.buckets[index] = 0;
    }
  };

  const record = (deltaMs: number): UiTransfer | undefined => {
    'worklet';
    if (state.runId < 0) {
      return undefined; // No run in progress.
    }
    state.count += 1;
    state.sumMs += deltaMs;
    if (state.count === 1) {
      state.minMs = deltaMs;
      state.maxMs = deltaMs;
    } else {
      if (deltaMs < state.minMs) {
        state.minMs = deltaMs;
      }
      if (deltaMs > state.maxMs) {
        state.maxMs = deltaMs;
      }
    }
    state.elapsedMs += deltaMs;
    state.buckets[uiBucketIndex(deltaMs)] += 1;
    if (state.elapsedMs - state.lastTransferMs >= UI_TRANSFER_INTERVAL_MS) {
      state.lastTransferMs = state.elapsedMs;
      return {
        runId: state.runId,
        final: false,
        count: state.count,
        sumMs: state.sumMs,
        minMs: state.minMs,
        maxMs: state.maxMs,
        buckets: state.buckets.slice(0, UI_BUCKET_COUNT),
      };
    }
    return undefined;
  };

  const flush = (): UiTransfer | undefined => {
    'worklet';
    if (state.runId < 0 || state.flushed) {
      return undefined;
    }
    state.flushed = true;
    return {
      runId: state.runId,
      final: true,
      count: state.count,
      sumMs: state.sumMs,
      minMs: state.minMs,
      maxMs: state.maxMs,
      buckets: state.buckets.slice(0, UI_BUCKET_COUNT),
    };
  };

  const replace = (transfer: UiTransfer): void => {
    'worklet';
    state.runId = transfer.runId;
    state.count = transfer.count;
    state.sumMs = transfer.sumMs;
    state.minMs = transfer.minMs;
    state.maxMs = transfer.maxMs;
    for (let index = 0; index < state.buckets.length; index += 1) {
      state.buckets[index] = transfer.buckets[index] ?? 0;
    }
  };

  return {
    begin,
    record,
    flush,
    replace,
    get runId() {
      return state.runId;
    },
    get count() {
      return state.count;
    },
    get sumMs() {
      return state.sumMs;
    },
    get minMs() {
      return state.minMs;
    },
    get maxMs() {
      return state.maxMs;
    },
    get buckets() {
      return state.buckets;
    },
  };
}

/** The histogram bucket for a frame delta (clamped into the cap bucket). */
export function uiBucketIndex(deltaMs: number): number {
  'worklet';
  const index = Math.floor(deltaMs / UI_BUCKET_MS);
  if (index < 0) {
    return 0;
  }
  return index >= UI_BUCKET_COUNT ? UI_BUCKET_COUNT - 1 : index;
}

/**
 * Nearest-rank percentile over the histogram: the bucket containing the
 * `ceil(count * ratio)`-th sample; returns the bucket midpoint.
 */
export function histogramPercentile(
  buckets: readonly number[],
  count: number,
  ratio: number,
): number {
  'worklet';
  if (count <= 0) {
    return 0;
  }
  let target = Math.ceil(count * ratio);
  if (target < 1) {
    target = 1;
  }
  let seen = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    seen += buckets[index] ?? 0;
    if (seen >= target) {
      return index * UI_BUCKET_MS + UI_BUCKET_MS / 2;
    }
  }
  return UI_CAP_MS;
}

/** Summarize an aggregator into the final UI frame summary. */
export function summarizeUi(aggregator: UiAggregator): UiFrameSummary {
  'worklet';
  const count = aggregator.count;
  if (count === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  return {
    count,
    mean: aggregator.sumMs / count,
    min: aggregator.minMs,
    max: aggregator.maxMs,
    p50: histogramPercentile(aggregator.buckets, count, 0.5),
    p95: histogramPercentile(aggregator.buckets, count, 0.95),
    p99: histogramPercentile(aggregator.buckets, count, 0.99),
  };
}
