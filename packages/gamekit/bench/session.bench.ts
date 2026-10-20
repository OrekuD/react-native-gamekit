/**
 * Whole-session Node/V8 microbenchmark, not a device FPS gate.
 * Run with `pnpm --filter rn-gamekit exec node --import tsx bench/session.bench.ts`.
 * An optional module path selects a baseline createGameSession implementation.
 * The single-slot driver deliberately does not retain historical callbacks.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineGame, defineScene } from '../src/index';
import type { FrameDriver } from '../src/core/frameDriver';
import type * as SessionModule from '../src/core/session/createGameSession';

const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {},
  scenes: {
    play: defineScene({
      actions: [],
      create: () => ({ count: 0 }),
      update: ({ state }) => ({ count: state.count + 1 }),
      snapshot: ({ state }) => state,
    }),
  },
  initialScene: 'play',
});

const WARMUP = 10_000;
const CALLBACKS = 50_000;
const SAMPLES = 7;

async function main() {
  const modulePath = resolve(process.argv[2] ?? 'src/core/session/createGameSession.ts');
  const { createGameSessionWithDriver } = await import(pathToFileURL(modulePath).href) as
    typeof SessionModule;
  console.log(JSON.stringify({ node: process.version, platform: process.platform,
    arch: process.arch, modulePath, warmup: WARMUP, callbacks: CALLBACKS, samples: SAMPLES }));

  for (const hz of [60, 120]) {
    for (const listeners of [0, 1, 4, 16]) {
      const timings: number[] = [];
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        let pending: ((time: number) => void) | undefined;
        const driver: FrameDriver = {
          requestFrame(callback) { pending = callback; return 1; },
          cancelFrame() { pending = undefined; },
        };
        const session = createGameSessionWithDriver(game, { frameDriver: driver });
        let observedTick = 0;
        for (let i = 0; i < listeners; i += 1) {
          session.addCommitListener((frame) => { observedTick = frame.tick; });
        }
        session.start();
        for (let i = 0; i <= WARMUP; i += 1) pending!(i * 1000 / hz);
        const start = performance.now();
        for (let i = 1; i <= CALLBACKS; i += 1) pending!((WARMUP + i) * 1000 / hz);
        timings.push((performance.now() - start) * 1000 / CALLBACKS);
        const expected = (WARMUP + CALLBACKS) * 60 / hz;
        assert.equal(session.getRenderFrame().tick, expected);
        if (listeners > 0) assert.equal(observedTick, expected);
        session.dispose();
        assert.equal(pending, undefined);
      }
      const sorted = [...timings].sort((a, b) => a - b);
      console.log(JSON.stringify({ hz, listeners,
        medianUsPerCallback: Number(sorted[Math.floor(SAMPLES / 2)]!.toFixed(3)),
        minUs: Number(sorted[0]!.toFixed(3)),
        maxUs: Number(sorted[SAMPLES - 1]!.toFixed(3)),
      }));
    }
  }
}

void main();
