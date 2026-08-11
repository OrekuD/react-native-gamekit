import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PerfSummary } from './summary.ts';
import { LabRunController } from './labRun.ts';
import { createUiAggregator } from './uiMetrics.ts';

function completeRun(controller: LabRunController, runId: number, finish = true): void {
  const summary = new PerfSummary();
  if (finish) {
    controller.finishHost(summary, 1000, 'brick-breaker');
  }
  const accumulator = createUiAggregator();
  accumulator.begin(runId);
  accumulator.record(16.7);
  controller.onUiTransfer(accumulator.flush()!);
}

describe('native latency measurement (F1 follow-up)', () => {
  it('records no sample when a presentation arrives before RN dispatch', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 1);
    // A commit published before any forward was acknowledged: no sample.
    controller.onCommit(1, 1000, 0);
    controller.onForwardResult(1, 990, 1, true);
    // The next commit's sampled counter advanced past the forward's buffer
    // count, so it is the first commit that sampled the input.
    controller.onCommit(2, 1016, 1);
    controller.onUiObserved(2, 1016);
    completeRun(controller, 1);
    const result = completed[0] as { inputToCommitMs: { count: number; p50: number } | undefined };
    assert.equal(result.inputToCommitMs?.count, 1, 'only the sampling commit matches');
    assert.equal(result.inputToCommitMs?.p50, 26, '1016 - 990');
  });

  it('records no sample for a commit that did not sample the forwarded input', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 2);
    controller.onForwardResult(1, 990, 1, true);
    // The next commit's sampled input counter did not advance past this forward:
    // an unrelated commit (counter still 0) must not consume the sequence.
    controller.onCommit(1, 1000, 0);
    controller.onUiObserved(1, 1000);
    controller.onCommit(2, 1016, 1);
    controller.onUiObserved(2, 1016);
    completeRun(controller, 2);
    const result = completed[0] as {
      inputToCommitMs: { count: number; p50: number };
      latencyCounters: { matched: number; unmatched: number; rejected: number; superseded: number };
    };
    assert.equal(result.inputToCommitMs.count, 1, 'only the sampling commit matches');
    assert.equal(result.inputToCommitMs.p50, 26);
    assert.deepEqual(result.latencyCounters, {
      matched: 1,
      unmatched: 0,
      rejected: 0,
      superseded: 0,
    });
  });

  it('rejected stale packets never become latency samples', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 3);
    controller.onForwardResult(1, 990, 0, false); // stale epoch packet rejected
    controller.onCommit(1, 1000, 0);
    controller.onUiObserved(1, 1000);
    controller.onCommit(2, 1016, 0);
    controller.onUiObserved(2, 1016);
    completeRun(controller, 3);
    const result = completed[0] as {
      inputToCommitMs: { count: number; p50: number } | undefined;
      latencyCounters: { rejected: number };
    };
    assert.equal(result.inputToCommitMs, undefined, 'no accepted input, no samples');
    assert.equal(result.latencyCounters.rejected, 1);
  });

  it('the first UI observation of the matching revision samples exactly once', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 4);
    controller.onForwardResult(1, 990, 1, true);
    controller.onCommit(1, 1000, 1);
    controller.onUiObserved(1, 1000); // first UI frame that sees the revision
    controller.onUiObserved(1, 1016); // later observation of the same revision: none
    completeRun(controller, 4);
    const result = completed[0] as {
      inputToUiObservedMs: { count: number; p50: number };
    };
    assert.equal(result.inputToUiObservedMs.count, 1, 'later observations of the revision record none');
    assert.equal(result.inputToUiObservedMs.p50, 10);
  });

  it('multiple forwards between commits follow the newest-accepted aggregation rule', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 5);
    controller.onForwardResult(1, 1000, 1, true);
    controller.onForwardResult(2, 1010, 2, true);
    controller.onForwardResult(3, 1020, 3, true);
    // The next commit sampled all three (counter 3): the newest accepted
    // input (seq 3) is the sample; 1 and 2 are superseded.
    controller.onCommit(1, 1033, 3);
    controller.onUiObserved(1, 1033);
    completeRun(controller, 5);
    const result = completed[0] as {
      inputToCommitMs: { count: number; p50: number };
      latencyCounters: { matched: number; superseded: number };
    };
    assert.equal(result.inputToCommitMs.count, 1);
    assert.equal(result.inputToCommitMs.p50, 13, 'newest accepted input: 1033 - 1020');
    assert.deepEqual({ matched: result.latencyCounters.matched, superseded: result.latencyCounters.superseded }, { matched: 1, superseded: 2 });
  });

  it('pending forwards at run end are unmatched and never fabricated', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 6);
    controller.onForwardResult(1, 2000, 5, true); // accepted after the last sampling commit
    completeRun(controller, 6);
    const result = completed[0] as {
      inputToCommitMs: { count: number; p50: number } | undefined;
      latencyCounters: { matched: number; unmatched: number };
    };
    assert.equal(result.inputToCommitMs, undefined);
    assert.deepEqual({ matched: result.latencyCounters.matched, unmatched: result.latencyCounters.unmatched }, { matched: 0, unmatched: 1 });
  });

  it('run replacement clears every sequence and pending association', () => {
    const completed: unknown[] = [];
    const controller = new LabRunController({ onComplete: (result) => completed.push(result) });
    controller.attachHost();
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 7);
    controller.onForwardResult(1, 1000, 1, true);
    completeRun(controller, 7);
    assert.equal(completed.length, 1);
    // A new run must not inherit the previous run's pending forward.
    controller.start({ scenario: 'native-drag', durationMs: 1000 }, 8);
    controller.onCommit(1, 1000, 0);
    controller.onUiObserved(1, 1000);
    completeRun(controller, 8);
    const result = completed[1] as { inputToCommitMs: { count: number } | undefined };
    assert.equal(result.inputToCommitMs, undefined, 'no stale forward from run 7 contaminates run 8');
  });
});
