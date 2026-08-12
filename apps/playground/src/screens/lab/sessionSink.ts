import type { SessionDiagnostics } from 'rn-gamekit/testing';

import type { PerfSummary } from './summary';

/** Build a session diagnostics sink that records into a `PerfSummary`. */
export function createSummarySink(summary: PerfSummary): SessionDiagnostics {
  return {
    onDisplayCallback: () => summary.count('display-callbacks'),
    onZeroStepCallback: () => summary.count('zero-step-callbacks'),
    onFixedStep: () => summary.count('fixed-steps'),
    onCatchUpStep: () => summary.count('catch-up-steps'),
    onDroppedDebt: (steps) => summary.count('dropped-debt-steps', steps),
    onUpdate: (ms) => summary.record('update-ms', ms),
    onInputSample: (ms) => summary.record('input-sample-ms', ms),
    onSnapshot: (ms) => summary.record('snapshot-ms', ms),
    onDeepFreeze: (ms) => summary.record('deep-freeze-ms', ms),
    onPublish: (ms) => summary.record('publish-ms', ms),
    onCommitNotification: () => summary.count('commits'),
    onListenerCount: (count) => summary.record('listeners', count),
  };
}

/**
 * Deterministic scripted pointer schedule for the drag scenario.
 *
 * Pure and testable: generates begin, move, and end events at fixed offsets
 * so every run enqueues the same input sequence.
 */
export interface PointerEvent {
  readonly atMs: number;
  readonly kind: 'begin' | 'move' | 'end';
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

export function generateDragSchedule(
  durationMs: number,
  moveIntervalMs = 16,
  logicalWidth = 320,
): readonly PointerEvent[] {
  const events: PointerEvent[] = [];
  let offset = 0;
  events.push({ atMs: 0, kind: 'begin', pointerId: 1, x: logicalWidth / 2, y: 90 });
  while (offset + moveIntervalMs < durationMs - 100) {
    offset += moveIntervalMs;
    const phase = (offset / durationMs) * Math.PI * 4;
    const x = logicalWidth / 2 + Math.sin(phase) * (logicalWidth / 2 - 24);
    events.push({ atMs: offset, kind: 'move', pointerId: 1, x, y: 90 });
  }
  events.push({ atMs: durationMs - 80, kind: 'end', pointerId: 1, x: logicalWidth / 2, y: 90 });
  return events;
}
