import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PerfSummary } from './summary.ts';
import { LabRunController } from './labRun.ts';
import { createUiAggregator } from './uiMetrics.ts';

describe('Performance Lab run controller (F1)', () => {
  it('refuses to start a scenario without a mounted pipeline host', () => {
    const controller = new LabRunController({ onComplete: () => {} });
    assert.throws(
      () => controller.start({ scenario: 'idle-active', durationMs: 1000 }, 1),
      /mounted game pipeline/,
    );
  });

  it('refuses a stale run id after a newer run started', () => {
    const controller = new LabRunController({ onComplete: () => {} });
    controller.attachHost();
    controller.start({ scenario: 'idle-active', durationMs: 1000 }, 1);
    assert.throws(() => controller.start({ scenario: 'stall', durationMs: 1000 }, 1), /run id/);
  });

  it('ignores UI transfers from before or after the run id', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'idle-active', durationMs: 1000 }, 1);
    // A transfer from a previous run must not be consumed.
    controller.onUiTransfer({
      runId: 0,
      final: true,
      count: 1,
      sumMs: 16.7,
      minMs: 16.7,
      maxMs: 16.7,
      buckets: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    controller.finishHost(new PerfSummary(), 1000, 'brick-breaker');
    assert.equal(completed.length, 0, 'stale transfer cannot complete the run');
    // The matching final transfer completes it exactly once.
    const accumulator = createUiAggregator();
    accumulator.begin(1);
    accumulator.record(16.7);
    controller.onUiTransfer(accumulator.flush()!);
    assert.equal(completed.length, 1);
    controller.onUiTransfer({
      runId: 1,
      final: true,
      count: 2,
      sumMs: 33.4,
      minMs: 16.7,
      maxMs: 16.7,
      buckets: [2, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(completed.length, 1, 'late duplicate final transfer is ignored');
  });

  it('assembles the merged result only after host finish and the final UI transfer', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'engine-drag', durationMs: 1000 }, 2);
    controller.onUiTransfer({
      runId: 2,
      final: false,
      count: 60,
      sumMs: 1000,
      minMs: 16,
      maxMs: 17,
      buckets: new Array<number>(256).fill(0),
    });
    const summary = new PerfSummary();
    summary.count('commits', 10);
    controller.finishHost(summary, 1000, 'brick-breaker');
    assert.equal(completed.length, 0, 'non-final transfer does not complete');
    const accumulator = createUiAggregator();
    accumulator.begin(2);
    accumulator.record(16.5);
    controller.onUiTransfer(accumulator.flush()!);
    assert.equal(completed.length, 1);
    const result = completed[0] as {
      runId: number;
      ui: { count: number };
      summary: PerfSummary;
      inputStages: unknown;
      inputToPresentMs: unknown;
    };
    assert.equal(result.runId, 2);
    assert.equal(result.ui.count, 1, 'the final cumulative snapshot wins');
    assert.equal(result.summary.getCounter('commits'), 10);
    assert.equal(result.inputStages, undefined, 'engine-drag has no native stage counters');
    assert.equal(result.inputToPresentMs, undefined);
  });

  it('reports raw, forwarded, sampled, committed, and presented counts for native drag', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 3);
    controller.onForwardResult(3, 1990, 1, true); // accepted forward
    controller.onCommit(5, 2000, 1); // the commit that sampled it
    controller.onUiObserved(5, 2000); // first UI observation of that revision
    const summary = new PerfSummary();
    summary.count('commits', 12);
    summary.record('input-sample-ms', 0.1);
    summary.record('input-sample-ms', 0.1);
    summary.record('input-sample-ms', 0.1);
    controller.setInputStages(240, 31);
    controller.finishHost(summary, 1000, 'brick-breaker');
    const accumulator = createUiAggregator();
    accumulator.begin(3);
    accumulator.record(16.7);
    controller.onUiTransfer(accumulator.flush()!);
    const result = completed[0] as {
      inputStages: { raw: number; forwarded: number; sampled: number; committed: number; presented: number };
      inputToCommitMs: { count: number; p50: number };
      inputToUiObservedMs: { count: number };
      latencyCounters: { matched: number };
    };
    assert.deepEqual(result.inputStages, {
      raw: 240,
      forwarded: 31,
      sampled: 3,
      committed: 12,
      presented: 1,
    });
    assert.equal(result.inputToCommitMs.count, 1);
    assert.equal(result.inputToCommitMs.p50, 10);
    assert.equal(result.inputToUiObservedMs.count, 1);
    assert.equal(result.latencyCounters.matched, 1);
  });

  it('associates each accepted forward with its first sampling commit (F1 follow-up)', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 5);
    // Forward seq 1 at t=990, sampled by the commit at counter 1.
    controller.onForwardResult(1, 990, 1, true);
    controller.onCommit(1, 1000, 1);
    controller.onUiObserved(1, 1000);
    // Unrelated commits (counter unchanged) consume nothing.
    controller.onCommit(2, 1016, 1);
    controller.onCommit(3, 1033, 1);
    // Forward seq 2 at t=1980, sampled at counter 2.
    controller.onForwardResult(2, 1980, 2, true);
    controller.onCommit(4, 2000, 2);
    controller.onUiObserved(4, 2000);
    const summary = new PerfSummary();
    controller.finishHost(summary, 1000, 'brick-breaker');
    const accumulator = createUiAggregator();
    accumulator.begin(5);
    accumulator.record(16.7);
    controller.onUiTransfer(accumulator.flush()!);
    const result = completed[0] as {
      inputToCommitMs: { count: number; p50: number };
      inputToUiObservedMs: { count: number };
    };
    assert.equal(result.inputToCommitMs.count, 2, 'one sample per consumed forward');
    assert.equal(result.inputToCommitMs.p50, 10);
    assert.equal(result.inputToUiObservedMs.count, 2);
  });

  it('aborts a run on detach and never completes it', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'idle-active', durationMs: 1000 }, 4);
    controller.detachHost();
    controller.finishHost(new PerfSummary(), 1000, 'brick-breaker');
    const accumulator = createUiAggregator();
    accumulator.begin(4);
    accumulator.record(16.7);
    controller.onUiTransfer(accumulator.flush()!);
    assert.equal(completed.length, 0);
  });
});
