import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CounterSeries, PerfSummary } from './summary.ts';

describe('Performance Lab summary aggregation', () => {
  it('computes mean, min, max, and nearest-rank percentiles from samples', () => {
    const series = new CounterSeries();
    for (let value = 1; value <= 100; value += 1) {
      series.record(value);
    }
    const snapshot = series.snapshot();
    assert.equal(snapshot.count, 100);
    assert.equal(snapshot.mean, 50.5);
    assert.equal(snapshot.min, 1);
    assert.equal(snapshot.max, 100);
    assert.equal(snapshot.p50, 50);
    assert.equal(snapshot.p95, 95);
    assert.equal(snapshot.p99, 99);
  });

  it('returns an empty snapshot for an untouched series', () => {
    assert.deepEqual(new CounterSeries().snapshot(), {
      count: 0,
      mean: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    });
  });

  it('resets series without losing the series registry', () => {
    const series = new CounterSeries();
    series.record(5);
    series.reset();
    assert.equal(series.count, 0);
    assert.equal(series.snapshot().count, 0);
  });

  it('aggregates named series and event counters, sorted by name', () => {
    const summary = new PerfSummary();
    summary.count('fixed-steps', 2);
    summary.count('fixed-steps', 3);
    summary.count('zero-step', 1);
    summary.record('update', 1.5);
    summary.record('update', 2.5);
    assert.equal(summary.getCounter('fixed-steps'), 5);
    assert.equal(summary.getCounter('zero-step'), 1);
    assert.deepEqual([...summary.seriesSnapshot().keys()], ['update']);
    assert.equal(summary.seriesSnapshot().get('update')?.mean, 2);
    summary.reset();
    assert.equal(summary.getCounter('fixed-steps'), 0);
  });
});
