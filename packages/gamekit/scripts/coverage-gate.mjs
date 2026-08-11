#!/usr/bin/env node
/**
 * T11 CI guardrail: coverage gate for new pure engine logic.
 *
 * Runs the library test suite with experimental coverage and fails when any
 * tracked pure module falls below the required line coverage. These modules
 * carry the deterministic performance contracts (alpha clock, coalescer,
 * containment mirror, deep-freeze cache, diagnostics sink) — a regression in
 * their tests is a regression in the architecture.
 *
 * Note: simulator/CI FPS is never a device gate (see the profiling guide).
 */
import { execFileSync } from 'node:child_process';

const MIN_LINE_COVERAGE = 80;

// The coverage report keys per-file rows by basename.
const TRACKED_MODULES = [
  'alphaClock.ts',
  'pointerCoalescer.ts',
  'pointerContainment.ts',
  'deepFreeze.ts',
  // Task 7 executable modules (R8/RF9): the asset manifest/validation, the
  // animation sampler/state, the sprite transform math, the store, the hook
  // lifecycle, and the batch policy coordinator. Native components
  // (Sprite/GameSprite/SpriteBatch/GameWorld2D) cannot run headlessly; their
  // pure coordinators are gated here and mounted/native acceptance is
  // recorded separately.
  'defineAssets.ts',
  'validation.ts',
  'sampleSpriteClip.ts',
  'spriteAnimationState.ts',
  'spriteTransform.ts',
  'createGameAssetStore.ts',
  'useGameAssets.ts',
  'spriteBatchPolicy.ts',
  // diagnostics.ts is intentionally excluded: it is a type-only interface
  // (F4 gating) with no runtime statements; its contract is enforced by the
  // session's zero-read tests, not by line coverage.
];

const output = execFileSync(
  process.execPath,
  ['--import', 'tsx', '--experimental-test-coverage', '--test', 'test/*.test.ts', 'test/*.test.tsx'],
  { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' },
);

const coverage = new Map();
for (const line of output.split('\n')) {
  const match = line.replace(/^#\s*/, '').trim().match(/^([\w./-]+\.ts)\s+\|\s+([\d.]+)\s+\|/);
  if (match !== null) {
    coverage.set(match[1], Number.parseFloat(match[2]));
  }
}

let failed = false;
for (const module of TRACKED_MODULES) {
  const percent = coverage.get(module);
  if (percent === undefined) {
    console.error(`coverage gate: no coverage data for ${module}`);
    failed = true;
    continue;
  }
  const status = percent >= MIN_LINE_COVERAGE ? 'ok' : 'FAIL';
  if (status === 'FAIL') {
    failed = true;
  }
  console.log(`coverage gate: ${module} ${percent.toFixed(1)}% (>= ${MIN_LINE_COVERAGE}%) ${status}`);
}
if (failed) {
  console.error(`coverage gate failed: tracked pure modules need >= ${MIN_LINE_COVERAGE}% line coverage`);
  process.exit(1);
}
console.log('coverage gate passed.');
