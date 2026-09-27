#!/usr/bin/env node
/**
 * Library coverage gate (GS-VALIDATION-01).
 *
 * Runs the library test suite with experimental coverage and fails when any
 * tracked module falls below the required LINE coverage. Scope honesty:
 * this gates targeted modules carrying deterministic contracts and the
 * ownership/error branches implicated by the game-systems review — it does
 * NOT enforce repository-wide 80% coverage, and the threshold is line
 * coverage only (branch/function numbers are reported, never gated).
 *
 * Wiring: `test:coverage:gate` runs in CI after the normal test task and
 * uses the same test discovery plus module mocking as `pnpm test`, with
 * the lcov reporter for repository-relative file identity (the default
 * table reporter keys rows by basename and cannot distinguish the four
 * `validation.ts` files).
 *
 * Note: simulator/CI FPS is never a device gate (see the profiling guide).
 */
import { execFileSync } from 'node:child_process';
import { parseLcov, checkGate } from './coverage-parse.mjs';

const MIN_LINE_COVERAGE = 80;

// Targeted modules by repository-relative path (see scope note above).
const TRACKED_MODULES = [
  'src/react/alphaClock.ts',
  'src/react/pointerCoalescer.ts',
  'src/react/pointerContainment.ts',
  'src/core/session/deepFreeze.ts',
  'src/assets/defineAssets.ts',
  'src/assets/validation.ts',
  'src/geometry/validation.ts',
  'src/sprites/sampleSpriteClip.ts',
  'src/sprites/spriteAnimationState.ts',
  'src/react/sprites/spriteTransform.ts',
  'src/react/assets/createGameAssetStore.ts',
  'src/react/assets/useGameAssets.ts',
  'src/react/sprites/spriteBatchPolicy.ts',
  'src/react/sprites/spriteSelection.ts',
  'src/tilemap/movement.ts',
  'src/tilemap/queries.ts',
  'src/react/tilemap/tilePresentation.ts',
  'src/react/particles/culling.ts',
  'src/particles/createParticleSystem.ts',
  'src/audio/createGameAudio.ts',
  'src/haptics/createGameHaptics.ts',
  'src/events/payload.ts',
  'src/storage/store.ts',
  'src/storage/serialization.ts',
  'src/storage/validation.ts',
];

let output;
try {
  output = execFileSync(
    process.execPath,
    [
      '--expose-gc',
      '--import',
      'tsx',
      '--experimental-test-module-mocks',
      '--experimental-test-coverage',
      '--test-reporter=lcov',
      '--test',
      'test/*.test.ts',
      'test/*.test.tsx',
    ],
    {
      cwd: new URL('..', import.meta.url).pathname,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    },
  );
} catch (e) {
  console.error(`coverage gate: covered test run failed (${e.message?.split('\n')[0] ?? e})`);
  process.exit(1);
}

let coverage;
try {
  coverage = parseLcov(output);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const { ok, lines } = checkGate(
  coverage,
  TRACKED_MODULES.map((path) => ({ path, min: MIN_LINE_COVERAGE })),
);
for (const line of lines) console.log(line);
if (!ok) {
  console.error(`coverage gate failed: tracked modules need >= ${MIN_LINE_COVERAGE}% line coverage`);
  process.exit(1);
}
console.log('coverage gate passed.');
