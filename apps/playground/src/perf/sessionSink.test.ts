import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSummarySink, generateDragSchedule } from './sessionSink.ts';
import { PerfSummary } from './summary.ts';

describe('Performance Lab session sink and drag schedule', () => {
  it('records session counters and duration series into the summary', () => {
    const summary = new PerfSummary();
    const sink = createSummarySink(summary);
    sink.onDisplayCallback();
    sink.onZeroStepCallback();
    sink.onFixedStep();
    sink.onCatchUpStep();
    sink.onDroppedDebt(3);
    sink.onUpdate(1.25);
    sink.onUpdate(0.75);
    sink.onPublish(0.5);
    sink.onCommitNotification();
    sink.onListenerCount(2);

    assert.equal(summary.getCounter('display-callbacks'), 1);
    assert.equal(summary.getCounter('zero-step-callbacks'), 1);
    assert.equal(summary.getCounter('fixed-steps'), 1);
    assert.equal(summary.getCounter('catch-up-steps'), 1);
    assert.equal(summary.getCounter('dropped-debt-steps'), 3);
    assert.equal(summary.getCounter('commits'), 1);
    assert.equal(summary.seriesSnapshot().get('update-ms')?.mean, 1);
    assert.equal(summary.seriesSnapshot().get('publish-ms')?.count, 1);
    assert.equal(summary.seriesSnapshot().get('listeners')?.max, 2);
  });

  it('generates a deterministic drag schedule with begin, moves, and end', () => {
    const schedule = generateDragSchedule(1000, 100, 320);
    assert.equal(schedule[0]?.kind, 'begin');
    assert.equal(schedule[0]?.pointerId, 1);
    assert.equal(schedule.at(-1)?.kind, 'end');
    const moves = schedule.filter((event) => event.kind === 'move');
    assert.equal(moves.length, 8, 'moves at 100, 200, ..., 800 ms');
    assert.ok(moves.every((event) => event.x >= 24 && event.x <= 296), 'paddle stays clamped');
    const first = moves[0]!;
    assert.equal(first.atMs, 100);
    assert.equal(first.x, 320 / 2 + Math.sin((100 / 1000) * Math.PI * 4) * (320 / 2 - 24));
  });

  it('produces identical schedules for identical inputs', () => {
    assert.deepEqual(generateDragSchedule(2000, 16, 320), generateDragSchedule(2000, 16, 320));
  });
});
