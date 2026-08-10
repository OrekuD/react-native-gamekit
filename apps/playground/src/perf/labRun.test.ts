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
    controller.onPresentCommit(5, 2000, 1990); // presented 10 ms after the last forwarded move
    controller.onPresentCommit(6, 3000, undefined); // no pending forward: no sample
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
      inputToPresentMs: { count: number; p50: number };
    };
    assert.deepEqual(result.inputStages, {
      raw: 240,
      forwarded: 31,
      sampled: 3,
      committed: 12,
      presented: 2,
    });
    assert.equal(result.inputToPresentMs.count, 1);
    assert.equal(result.inputToPresentMs.p50, 10);
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
