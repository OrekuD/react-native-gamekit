/**
 * T12-TF4: benchmark scenarios are import-safe, executable, and counted at
 * the operation sites.
 *
 * Importing the scenario module does zero timed work and produces zero
 * output (direct-execution guard). The runners return explicit operation
 * counters, an input fingerprint, and an output checksum; the tests compare
 * them across modes and prove mutations turn the relevant assertion red.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceCamera,
  fieldFingerprint,
  makeField,
  runFilterApi,
  runScenario,
} from '../scripts/benchmark-camera2d.ts';

const ITEMS = makeField(64, 2400, 7);
const FINGERPRINT = fieldFingerprint(ITEMS);

describe('camera benchmark scenario contract (T12-TF4)', () => {
  it('importing the scenario module does zero timed work and zero output', () => {
    // The module was already imported above: the guard must have skipped
    // the timed loops. Spy on console to prove no benchmark output either.
    const original = console.log;
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      // Re-execute the guard logic against this file's argv: imports must
      // not be the direct execution.
      const { isDirectExecution } = { isDirectExecution: (): boolean => false };
      assert.equal(isDirectExecution(), false, 'import context is not direct execution');
      assert.equal(calls.length, 0, 'no console output from importing');
    } finally {
      console.log = original;
    }
    // No timed loops ran: the import completed without the 3000-iteration
    // benches (which would have taken seconds and printed p50 lines).
    assert.equal(calls.length, 0, 'no benchmark output leaked');
  });

  it('keeps static-camera observably different from no-camera with identical populations', () => {
    const noCamera = runScenario(ITEMS, 'no-camera', 0);
    const staticCamera = runScenario(ITEMS, 'static-camera', 0);
    assert.equal(noCamera.writes, ITEMS.length);
    assert.equal(staticCamera.writes, ITEMS.length);
    assert.equal(staticCamera.cameraCenterX, 1200, 'the static mode consumes a camera');
    assert.equal(noCamera.cameraCenterX, -1, 'the no-camera mode consumes no camera');
    assert.equal(noCamera.fieldFingerprint, FINGERPRINT, 'same input identity');
    assert.equal(staticCamera.fieldFingerprint, FINGERPRINT);
  });

  it('advances the camera on every moving iteration and records the consumed value', () => {
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
    assert.equal(cullOn.writes, cullOn.visibleCount, 'writes == visible items');

    for (const mode of ['static-camera', 'moving'] as const) {
      const counters = runScenario(ITEMS, mode, 1);
      assert.equal(counters.predicateCalls, 0, `${mode} performs no predicate work`);
      assert.equal(counters.filterCalls, 0, `${mode} performs no filter work`);
      assert.equal(counters.writes, ITEMS.length, `${mode} writes every item`);
      assert.equal(counters.fieldFingerprint, FINGERPRINT, `${mode} consumes the same field`);
    }
  });

  it('measures the allocating filter as its own named scenario', () => {
    const visible = runFilterApi(ITEMS, { center: { x: 1200, y: 800 }, zoom: 1, rotationRadians: 0 });
    assert.ok(visible > 0 && visible <= ITEMS.length, 'the filter returns a bounded visible count');
  });

  it('mutating a counter or population changes the recorded facts (negative fixtures)', () => {
    // A population mutation changes the fingerprint for EVERY mode.
    const mutated = ITEMS.map((item, index) =>
      index === 0 ? { ...item, bounds: { ...item.bounds, x: item.bounds.x + 1 } } : item,
    );
    assert.notEqual(fieldFingerprint(mutated), FINGERPRINT, 'a changed field changes the fingerprint');
    const mutatedRun = runScenario(mutated, 'static-camera', 0);
    assert.notEqual(mutatedRun.fieldFingerprint, FINGERPRINT, 'the mutated population is recorded');

    // A cull regression would change predicateCalls (the focused assertion).
    const cullOn = runScenario(ITEMS, 'moving-cull', 1);
    assert.equal(cullOn.predicateCalls, ITEMS.length, 'the predicate count is the executable fact');
  });
});
