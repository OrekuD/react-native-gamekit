/**
 * Desktop Node sprite playback/sampling CPU benchmark, not device FPS.
 *
 * node --import tsx bench/spriteAnimation.bench.ts
 * node --import tsx bench/spriteAnimation.bench.ts --module /tmp/baseline/src/sprites.ts
 *
 * The alternate module must export the sprites entry point and resolve its
 * imports. Export the entry point, both sprites modules and assets/errors.ts
 * from the same historical commit. Preserve the original package module type
 * (this package has no `type: module`) so tsx applies the same transformation.
 * Timings are batch averages for 1,000 sprites; p95 is a percentile of those
 * averages, not individual-call tail latency. Reference changes are observed
 * outputs, not total allocation or retained-memory measurements. Timed work
 * includes loop dispatch, state assignment and checksum/reference bookkeeping.
 * No React, worklet runtime, native rendering or I/O is measured.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SpriteSheetDescriptor } from '../src/assets/types';
import type * as SpriteApi from '../src/sprites';

type Api = typeof SpriteApi;
type State = SpriteApi.SpriteAnimationState;
type Scenario = 'active-loop-advance' | 'zero-delta' | 'full-loop' | 'reset-at-start';

const SPRITES = 1000;
const WARMUP_BATCHES = 100;
const SAMPLES = 40;
const BATCHES_PER_SAMPLE = 100;
const frameNames = Object.freeze(Array.from({ length: 8 }, (_, index) => `frame-${index}`));
const clip = Object.freeze({ frames: frameNames, frameDurationMs: 125, mode: 'loop' as const });
const descriptor: SpriteSheetDescriptor = Object.freeze({
  kind: 'sprite-sheet',
  source: 1,
  frames: Object.freeze(Object.fromEntries(frameNames.map((name, index) => [
    name, Object.freeze({ x: index * 16, y: 0, width: 16, height: 16 }),
  ]))),
  animations: Object.freeze({ run: clip }),
});

function measure(batch: () => void) {
  for (let index = 0; index < WARMUP_BATCHES; index += 1) batch();
  const timings: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < BATCHES_PER_SAMPLE; index += 1) batch();
    timings.push((performance.now() - start) * 1000 / BATCHES_PER_SAMPLE);
  }
  timings.sort((first, second) => first - second);
  return {
    medianUsPer1000Sprites: Number(timings[Math.floor(SAMPLES / 2)]!.toFixed(3)),
    p95UsPer1000Sprites: Number(timings[Math.ceil(SAMPLES * 0.95) - 1]!.toFixed(3)),
  };
}

function playback(api: Api, scenario: Scenario): void {
  const states: State[] = Array.from({ length: SPRITES }, () => api.startSpriteAnimation(descriptor, 'run'));
  const transition = scenario === 'reset-at-start'
    ? (state: State) => api.resetSpriteAnimation(state)
    : (state: State) => api.advanceSpriteAnimation(descriptor, state,
      scenario === 'active-loop-advance' ? 1 / 60 : scenario === 'full-loop' ? 1 : 0);
  let referenceChanges = 0;
  let calls = 0;
  let checksum = 0;
  const timing = measure(() => {
    for (let index = 0; index < SPRITES; index += 1) {
      const previous = states[index]!;
      const next = transition(previous);
      referenceChanges += Number(next !== previous);
      states[index] = next;
      checksum += next.elapsedMs;
      calls += 1;
    }
  });
  assert.ok(Number.isFinite(checksum));
  for (const state of states) {
    assert.ok(state.elapsedMs >= 0 && state.elapsedMs < 1000);
    assert.equal(state.completed, false);
    if (scenario !== 'active-loop-advance') assert.equal(state.elapsedMs, 0);
  }
  console.log(JSON.stringify({
    scenario, ...timing, observedCallsIncludingWarmup: calls,
    outputReferenceChangesPer1000Calls: referenceChanges / calls * SPRITES, checksum,
  }));
}

function sampling(api: Api): void {
  let tick = 0;
  let checksum = 0;
  const timing = measure(() => {
    for (let sprite = 0; sprite < SPRITES; sprite += 1) {
      checksum += api.sampleSpriteClipFrame(clip, tick * (1000 / 60) + sprite * 17);
    }
    tick += 1;
  });
  assert.ok(Number.isFinite(checksum) && checksum > 0);
  // Separate correctness probes keep assertion overhead out of timing.
  for (const [elapsed, expected] of [[0, 0], [124, 0], [125, 1], [999, 7], [1000, 0], [-1, 7]]) {
    assert.equal(api.sampleSpriteClipFrame(clip, elapsed!), expected);
  }
  console.log(JSON.stringify({ scenario: 'sample-loop-frame', ...timing, checksum }));
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--module');
  if (flag !== -1 && process.argv[flag + 1] === undefined) throw new Error('--module requires a path');
  const moduleUrl = flag === -1
    ? new URL('../src/sprites.ts', import.meta.url).href
    : pathToFileURL(resolve(process.argv[flag + 1]!)).href;
  const imported = await import(moduleUrl) as Api & { readonly default?: Api };
  const api = typeof imported.startSpriteAnimation === 'function' ? imported : imported.default;
  if (api === undefined || typeof api.sampleSpriteClipFrame !== 'function') {
    throw new Error('The module must export the sprites playback and sampling API');
  }
  console.log(JSON.stringify({
    node: process.version, platform: process.platform, arch: process.arch, module: moduleUrl,
    spritesPerBatch: SPRITES, warmupBatches: WARMUP_BATCHES,
    samples: SAMPLES, batchesPerSample: BATCHES_PER_SAMPLE,
    timingUnit: 'microseconds per 1000 sprites; percentile of batch averages',
  }));
  for (const scenario of ['active-loop-advance', 'zero-delta', 'full-loop', 'reset-at-start'] as const) {
    playback(api, scenario);
  }
  sampling(api);
}

void main();
