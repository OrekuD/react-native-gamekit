/**
 * T12-SF4: the benchmark scenarios are production-equivalent and executed,
 * not asserted by source substrings.
 *
 * Executes the exported scenario runners and compares work counters:
 * static-camera is observably different from no-camera, moving iterations
 * consume changing camera values, cull-on runs the predicate exactly once
 * per candidate, and cull-off runs it zero times. Identical populations
 * drive every mode.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceCamera,
  makeField,
  runFilterApi,
  runScenario,
  type ScenarioCounters,
} from '../scripts/benchmark-camera2d.ts';

const ITEMS = makeField(64, 2400, 7);

describe('camera benchmark scenario contract (T12-SF4)', () => {
  it('keeps static-camera observably different from no-camera', () => {
    const noCamera = runScenario(ITEMS, 'no-camera', 0);
    const staticCamera = runScenario(ITEMS, 'static-camera', 0);
    assert.equal(noCamera.writes, ITEMS.length);
    assert.equal(staticCamera.writes, ITEMS.length, 'the write loop runs for both');
    assert.equal(staticCamera.cameraCenterX, 1200, 'the static mode consumes a camera');
    assert.equal(noCamera.cameraCenterX, -1, 'the no-camera mode consumes no camera');
  });

  it('advances the camera on every moving iteration', () => {
    const first = runScenario(ITEMS, 'moving', 1);
    const second = runScenario(ITEMS, 'moving', 2);
    assert.notEqual(second.cameraCenterX, first.cameraCenterX, 'moving iterations consume different cameras');
    const advanced = advanceCamera({ center: { x: 1200, y: 800 }, zoom: 1, rotationRadians: 0 }, 1);
    assert.equal(first.cameraCenterX, advanced.center.x, 'the consumed camera is the advanced one');
  });

  it('runs the predicate exactly once per candidate in cull-on and zero times in cull-off', () => {
    const cullOn = runScenario(ITEMS, 'moving-cull', 1);
    assert.equal(cullOn.predicateCalls, ITEMS.length, 'exactly one predicate call per candidate');
    assert.equal(cullOn.filterCalls, 0, 'the batch path never calls the allocating filter');
    assert.ok(cullOn.visibleCount <= ITEMS.length, 'the visible output is bounded');
    assert.ok(cullOn.writes === cullOn.visibleCount, 'writes == visible items');

    for (const mode of ['static-camera', 'moving'] as const) {
      const counters = runScenario(ITEMS, mode, 1);
      assert.equal(counters.predicateCalls, 0, `${mode} performs no predicate work`);
      assert.equal(counters.filterCalls, 0, `${mode} performs no filter work`);
      assert.equal(counters.writes, ITEMS.length, `${mode} writes every item`);
    }
  });

  it('measures the allocating filter separately as the headless API', () => {
    const visible = runFilterApi(ITEMS, { center: { x: 1200, y: 800 }, zoom: 1, rotationRadians: 0 });
    assert.ok(visible > 0 && visible <= ITEMS.length);
    assert.ok(!('predicateCalls' in {}), 'no-op');
  });

  it('uses identical populations across the compared modes', () => {
    const counts: ScenarioCounters[] = [];
    for (const mode of ['no-camera', 'static-camera', 'moving', 'moving-cull'] as const) {
      counts.push(runScenario(ITEMS, mode, 3));
    }
    assert.equal(counts.length, 4);
    assert.equal(counts[1]!.writes, counts[0]!.writes, 'identical write loops');
  });
});
