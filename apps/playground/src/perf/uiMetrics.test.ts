import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UI_BUCKET_MS,
  UI_CAP_MS,
  UI_TRANSFER_INTERVAL_MS,
  createUiAggregator,
  histogramPercentile,
  summarizeUi,
  uiBucketIndex,
} from './uiMetrics.ts';

describe('UI metric aggregation (F1)', () => {
  it('aggregates in constant space: bucket count never grows with sample count', () => {
    const aggregator = createUiAggregator();
    aggregator.begin(1);
    for (let frame = 0; frame < 100_000; frame += 1) {
      aggregator.record(16.7);
    }
    assert.equal(aggregator.buckets.length, 256, 'fixed bucket array');
    assert.equal(aggregator.count, 100_000, 'every frame recorded');
  });

  it('ignores frames recorded before the run begins', () => {
    const aggregator = createUiAggregator();
    aggregator.record(16.7);
    assert.equal(aggregator.count, 0, 'no run: nothing recorded');
    aggregator.begin(7);
    aggregator.record(16.7);
    assert.equal(aggregator.count, 1);
  });

  it('transfers at most once per second of elapsed time at 60/90/120 Hz', () => {
    const aggregator = createUiAggregator();
    aggregator.begin(1);
    // 120 Hz: 60 frames is only 500 ms of elapsed time — the hard-coded
    // "60 frames" interval would violate the 1 transfer/second rule.
    let transfers = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      if (aggregator.record(1000 / 120) !== undefined) {
        transfers += 1;
      }
    }
    assert.equal(transfers, 0, 'no transfer before a full second elapses');
    for (let frame = 60; frame < 121; frame += 1) {
      if (aggregator.record(1000 / 120) !== undefined) {
        transfers += 1;
      }
    }
    assert.equal(transfers, 1, 'exactly one transfer in the first second');
    assert.equal(aggregator.count, 121);

    // 60 Hz: a transfer lands at the 61st frame (the gate is elapsed-time
    // based; 60 × 1000/60 ms sums to 999.99… due to float accumulation).
    const sixty = createUiAggregator();
    sixty.begin(1);
    let atSixty = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      if (sixty.record(1000 / 60) !== undefined) {
        atSixty += 1;
      }
    }
    assert.equal(atSixty, 0, '60 Hz: no transfer before a full second');
    assert.ok(sixty.record(1000 / 60) !== undefined, '60 Hz transfers within a frame of the one-second mark');

    // 90 Hz: 90 frames = 1000 ms (±1 frame for float accumulation).
    const ninety = createUiAggregator();
    ninety.begin(1);
    let atNinety = 0;
    for (let frame = 0; frame < 90; frame += 1) {
      if (ninety.record(1000 / 90) !== undefined) {
        atNinety += 1;
      }
    }
    assert.equal(atNinety, 0, '90 Hz: no transfer before a full second');
    assert.ok(ninety.record(1000 / 90) !== undefined, '90 Hz transfers within a frame of the one-second mark');
  });

  it('flushes exactly one final transfer with the run id, then nothing', () => {
    const aggregator = createUiAggregator();
    aggregator.begin(3);
    aggregator.record(8.3);
    const final = aggregator.flush();
    assert.ok(final !== undefined);
    assert.equal(final.final, true);
    assert.equal(final.runId, 3);
    assert.equal(final.count, 1);
    assert.equal(aggregator.flush(), undefined, 'second flush emits nothing');
    aggregator.begin(9);
    assert.equal(aggregator.flush()!.runId, 9, 'a fresh run flushes again');
  });

  it('bins deltas with a hard cap and preserves the raw maximum', () => {
    assert.equal(uiBucketIndex(16.7), 66);
    assert.equal(uiBucketIndex(-1), 0);
    assert.equal(uiBucketIndex(200), 255, 'stall-sized deltas clamp into the cap bucket');
    assert.ok(UI_CAP_MS > 0);
    assert.ok(UI_TRANSFER_INTERVAL_MS === 1000);
    assert.ok(UI_BUCKET_MS === 0.25);
  });

  it('computes percentiles from the histogram on known distributions', () => {
    const aggregator = createUiAggregator();
    aggregator.begin(1);
    for (let sample = 0; sample < 1000; sample += 1) {
      aggregator.record(16.7);
    }
    const summary = summarizeUi(aggregator);
    assert.equal(summary.count, 1000);
    assert.equal(summary.min, 16.7);
    assert.equal(summary.max, 16.7);
    assert.ok(Math.abs(summary.mean - 16.7) < 1e-6, 'mean within float tolerance');
    // 16.7 ms bins into bucket 66 ([16.5, 16.75)); midpoint 16.625.
    assert.equal(summary.p50, 16.625);
    assert.equal(summary.p95, 16.625);
    assert.equal(summary.p99, 16.625);
  });

  it('replaces the accumulator with cumulative transfer snapshots', () => {
    // Transfers are cumulative snapshots: each one is a superset of the
    // previous, so the latest accepted transfer is the complete state and
    // earlier ones must not be added on top.
    const merged = createUiAggregator();
    const first = createUiAggregator();
    first.begin(1);
    first.record(10);
    first.record(20);
    merged.replace(first.flush()!);
    assert.equal(merged.count, 2);
    const second = createUiAggregator();
    second.begin(1);
    second.record(10);
    second.record(20);
    second.record(30);
    merged.replace(second.flush()!);
    assert.equal(merged.count, 3, 'latest snapshot wins, no double counting');
    assert.equal(merged.minMs, 10);
    assert.equal(merged.maxMs, 30);
    assert.equal(summarizeUi(merged).mean, 20);
  });

  it('returns a zero summary for an untouched accumulator', () => {
    const summary = summarizeUi(createUiAggregator());
    assert.equal(summary.count, 0);
    assert.equal(summary.p95, 0);
  });

  it('computes histogram percentiles with nearest-rank semantics', () => {
    // 10 samples: 5 in bucket 0, 5 in bucket 40.
    const buckets = new Array<number>(256).fill(0);
    buckets[0] = 5;
    buckets[40] = 5;
    assert.equal(histogramPercentile(buckets, 10, 0.5), UI_BUCKET_MS / 2, '5th sample is in bucket 0');
    assert.equal(histogramPercentile(buckets, 10, 0.95), 40 * UI_BUCKET_MS + UI_BUCKET_MS / 2);
    assert.equal(histogramPercentile(buckets, 0, 0.5), 0);
  });
});
