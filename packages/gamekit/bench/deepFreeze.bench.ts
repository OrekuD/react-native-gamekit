/**
 * Snapshot-freezer CPU microbenchmark; this does not measure native FPS.
 *
 * Run: pnpm bench:deepfreeze [path/to/baseline/deepFreeze.ts]
 * Or: node --import tsx bench/deepFreeze.bench.ts /tmp/deepFreeze-before.ts
 * The optional module must export createDeepFreeze. Preserve a source version
 * before editing to compare equivalent workloads, rather than a weaker legacy
 * freezer with different validation rules.
 *
 * Frame creation and cache priming are outside each timed batch. Every batch
 * has its own freezer and graph, including separate baseline/current graphs.
 * Five warmup batches precede nine samples; report median time per snapshot.
 * Results are observations, never a machine-dependent pass/fail gate.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDeepFreeze } from '../src/core/session/deepFreeze';

type FreezerFactory = typeof createDeepFreeze;
type Freezer = ReturnType<FreezerFactory>;

interface Brick {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly alive: boolean;
}

interface Scenario {
  readonly name: string;
  readonly iterations: number;
  readonly prepare: (freeze: Freezer, iterations: number) => readonly unknown[];
}

const warmupBatches = 5;
const sampleBatches = 9;

function buildBricks(count: number): readonly Brick[] {
  return Array.from({ length: count }, (_, index) => ({
    x: index % 10, y: Math.floor(index / 10), w: 4, h: 2, alive: true,
  }));
}

function denseScenario(count: number, shared: boolean): Scenario {
  return {
    name: `${shared ? 'Shared' : 'Fresh'} dense ${count}`,
    iterations: shared ? (count === 32 ? 2_048 : 128) : (count === 32 ? 512 : 64),
    prepare(freeze, iterations) {
      const bricks = buildBricks(count);
      if (shared) freeze(bricks);
      return Array.from({ length: iterations }, (_, tick) => ({
        tick,
        bricks: shared
          ? [...bricks.slice(1), { x: 99, y: 99, w: 4, h: 2, alive: false }]
          : buildBricks(count),
        score: tick,
      }));
    },
  };
}

const scenarios: readonly Scenario[] = [
  denseScenario(32, true),
  denseScenario(1_000, true),
  denseScenario(32, false),
  denseScenario(1_000, false),
  {
    name: 'Shared array (1000 bricks)',
    iterations: 10_000,
    prepare(freeze, iterations) {
      const bricks = buildBricks(1_000);
      freeze(bricks);
      return Array.from({ length: iterations }, (_, tick) => ({ tick, bricks, score: tick }));
    },
  },
  {
    name: 'Same root (1000 bricks)',
    iterations: 100_000,
    prepare(freeze, iterations) {
      const root = { tick: 0, bricks: buildBricks(1_000), score: 0 };
      freeze(root);
      return Array.from({ length: iterations }, () => root);
    },
  },
  {
    name: 'Sparse length 1000000',
    iterations: 4,
    prepare(_freeze, iterations) {
      return Array.from({ length: iterations }, () => {
        const entries = new Array<unknown>(1_000_000);
        entries[0] = { value: 1 };
        entries[999_999] = { value: 2 };
        return entries;
      });
    },
  },
];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureBatch(factory: FreezerFactory, scenario: Scenario): number {
  const freeze = factory();
  const frames = scenario.prepare(freeze, scenario.iterations);
  const start = process.hrtime.bigint();
  for (const frame of frames) freeze(frame);
  return Number(process.hrtime.bigint() - start) / frames.length / 1_000;
}

async function main(): Promise<void> {
  const baselinePath = process.argv[2];
  const baselineModule = baselinePath === undefined
    ? undefined
    : await import(pathToFileURL(resolve(baselinePath)).href) as {
      createDeepFreeze?: FreezerFactory;
    };
  if (baselineModule !== undefined && typeof baselineModule.createDeepFreeze !== 'function') {
    throw new Error('The baseline module must export createDeepFreeze.');
  }
  const baseline = baselineModule?.createDeepFreeze;
  console.log(`Snapshot freezer CPU benchmark: Node ${process.version}, ${process.platform}/${process.arch}`);
  console.log(`Microseconds/snapshot; median ${sampleBatches} batches after ${warmupBatches} warmup batches.`);
  console.log('Frame creation and cache priming excluded. Native FPS is not measured.');
  console.log(`scenario | calls/batch | current (us)${baseline ? ' | baseline (us) | baseline/current' : ''}`);
  for (const scenario of scenarios) {
    const currentSamples: number[] = [];
    const baselineSamples: number[] = [];
    for (let batch = -warmupBatches; batch < sampleBatches; batch += 1) {
      // Alternate order so one implementation is not always measured first.
      const before = baseline && batch % 2 === 0 ? measureBatch(baseline, scenario) : undefined;
      const current = measureBatch(createDeepFreeze, scenario);
      const previous = baseline ? (before ?? measureBatch(baseline, scenario)) : undefined;
      if (batch >= 0) {
        currentSamples.push(current);
        if (previous !== undefined) baselineSamples.push(previous);
      }
    }
    const current = median(currentSamples);
    const previous = baseline ? median(baselineSamples) : undefined;
    const comparison = previous === undefined ? '' : ` | ${previous.toFixed(3)} | ${(previous / current).toFixed(2)}x`;
    console.log(`${scenario.name} | ${scenario.iterations} | ${current.toFixed(3)}${comparison}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
