/**
 * T12-RF7: the camera benchmark stays honest.
 *
 * Source-level contract on `scripts/benchmark-camera2d.ts`: the
 * disabled-culling modes perform NO visibility predicate/filter work, the
 * moving scenarios advance the camera every iteration, and the report
 * records distributions (p50/p95/p99), not a single aggregate mean.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/benchmark-camera2d.ts', 'utf8');

describe('camera benchmark contract (T12-RF7)', () => {
  it('performs no visibility work in the cull-off modes', () => {
    // The no-camera and static/moving (cull-off) sections run before the
    // moving-cull section and must never call a visibility predicate or
    // filter.
    // Skip the imports: the section under test starts at the scenario loop.
    const scenarioStart = source.indexOf('function runScenario');
    const cullOffSection = source.slice(scenarioStart, source.indexOf("mode === 'moving-cull'"));
    assert.ok(!cullOffSection.includes('intersectsBounds2D'), 'no inline predicate in cull-off');
    assert.ok(!cullOffSection.includes('filterCameraVisible2D'), 'no filter in cull-off');
    // The cull-on branch computes the visible bounds per iteration.
    assert.ok(source.includes('const visible = batchVisibleBounds2D(cut, FIT as never, 24);'), 'cull-on computes the bounds');
  });

  it('advances the camera on every moving iteration', () => {
    assert.ok(source.includes('advanceCamera(stationary, iteration)'), 'the moving camera advances per iteration');
    assert.ok(
      source.includes("(x % 2400 + 2400) % 2400"),
      'the camera position changes deterministically',
    );
  });

  it('records distributions, not a single mean', () => {
    assert.ok(source.includes('p50'), 'p50 recorded');
    assert.ok(source.includes('p95'), 'p95 recorded');
    assert.ok(source.includes('p99'), 'p99 recorded');
    assert.ok(source.includes('warmup'), 'warmup is separated from the samples');
  });

  it('uses identical entity populations across the compared modes', () => {
    // The four modes run over the same makeField outputs.
    assert.ok(source.includes("for (const [label, items] of [['sparse', sparse], ['dense', dense]] as const)"),
      'one population set drives every mode');
  });
});
