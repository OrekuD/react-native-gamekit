/**
 * UI frame-metric aggregation (F1).
 *
 * Constant-space, worklet-safe accumulator for UI presentation frame
 * deltas. Frame deltas are binned into a fixed histogram on the UI runtime
 * (no per-frame allocations, no growth with run length) and transferred to
 * the RN runtime at most once per second of **elapsed time** plus once at
 * run completion. Percentiles are computed from the histogram on the RN
 * side when the run finishes.
 *
 * Every function here is pure and worklet-compatible ('worklet' directives)
 * so the exact same code runs on the UI runtime and in the node test suite.
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

/** Constant-space UI aggregation state (mutable, worklet-owned). */
export interface UiAccumulator {
  runId: number;
  count: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  elapsedMs: number;
  lastTransferMs: number;
  /** Set once the final transfer has been emitted for the run. */
  flushed: boolean;
  readonly buckets: number[];
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

export function createUiAccumulator(): UiAccumulator {
  return {
    runId: -1,
    count: 0,
    sumMs: 0,
    minMs: 0,
    maxMs: 0,
    elapsedMs: 0,
    lastTransferMs: 0,
    flushed: false,
    buckets: new Array<number>(UI_BUCKET_COUNT).fill(0),
  };
}

/** Reset the accumulator for a run. Frames recorded under other ids are ignored. */
export function beginUiRun(accumulator: UiAccumulator, runId: number): void {
  'worklet';
  accumulator.runId = runId;
  accumulator.count = 0;
  accumulator.sumMs = 0;
  accumulator.minMs = 0;
  accumulator.maxMs = 0;
  accumulator.elapsedMs = 0;
  accumulator.lastTransferMs = 0;
  accumulator.flushed = false;
  for (let index = 0; index < accumulator.buckets.length; index += 1) {
    accumulator.buckets[index] = 0;
  }
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
 * Record one UI frame delta in constant time and constant space.
 *
 * Returns an intermediate transfer snapshot when a full transfer interval
 * has elapsed, otherwise `undefined`. Frames recorded under a run id that is
 * not the accumulator's current run are ignored entirely.
 */
export function recordUiFrame(
  accumulator: UiAccumulator,
  runId: number,
  deltaMs: number,
): UiTransfer | undefined {
  'worklet';
  if (runId !== accumulator.runId) {
    return undefined;
  }
  accumulator.count += 1;
  accumulator.sumMs += deltaMs;
  if (accumulator.count === 1) {
    accumulator.minMs = deltaMs;
    accumulator.maxMs = deltaMs;
  } else {
    if (deltaMs < accumulator.minMs) {
      accumulator.minMs = deltaMs;
    }
    if (deltaMs > accumulator.maxMs) {
      accumulator.maxMs = deltaMs;
    }
  }
  accumulator.elapsedMs += deltaMs;
  accumulator.buckets[uiBucketIndex(deltaMs)] += 1;
  if (accumulator.elapsedMs - accumulator.lastTransferMs >= UI_TRANSFER_INTERVAL_MS) {
    accumulator.lastTransferMs = accumulator.elapsedMs;
    return snapshot(accumulator, false);
  }
  return undefined;
}

/** Final transfer for the run; emits nothing once flushed or for a mismatched id. */
export function flushUi(accumulator: UiAccumulator, runId: number): UiTransfer | undefined {
  'worklet';
  if (runId !== accumulator.runId || accumulator.flushed) {
    return undefined;
  }
  accumulator.flushed = true;
  return snapshot(accumulator, true);
}

function snapshot(accumulator: UiAccumulator, final: boolean): UiTransfer {
  'worklet';
  return {
    runId: accumulator.runId,
    final,
    count: accumulator.count,
    sumMs: accumulator.sumMs,
    minMs: accumulator.minMs,
    maxMs: accumulator.maxMs,
    buckets: accumulator.buckets.slice(0, UI_BUCKET_COUNT),
  };
}

/** Merge a partial transfer into a run accumulator (RN side). */
export function mergeUiTransfers(into: UiAccumulator, transfer: UiTransfer): void {
  'worklet';
  into.runId = transfer.runId;
  into.count += transfer.count;
  into.sumMs += transfer.sumMs;
  if (transfer.count > 0) {
    if (into.count === transfer.count) {
      into.minMs = transfer.minMs;
      into.maxMs = transfer.maxMs;
    } else {
      into.minMs = Math.min(into.minMs, transfer.minMs);
      into.maxMs = Math.max(into.maxMs, transfer.maxMs);
    }
  }
  for (let index = 0; index < transfer.buckets.length; index += 1) {
    into.buckets[index] += transfer.buckets[index] ?? 0;
  }
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

/** Summarize an accumulator into the final UI frame summary. */
export function summarizeUi(accumulator: UiAccumulator): UiFrameSummary {
  'worklet';
  const count = accumulator.count;
  if (count === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  return {
    count,
    mean: accumulator.sumMs / count,
    min: accumulator.minMs,
    max: accumulator.maxMs,
    p50: histogramPercentile(accumulator.buckets, count, 0.5),
    p95: histogramPercentile(accumulator.buckets, count, 0.95),
    p99: histogramPercentile(accumulator.buckets, count, 0.99),
  };
}
