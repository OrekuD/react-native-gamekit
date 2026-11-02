/**
 * Asset selection and acquisition benchmark (desktop Node, not device FPS).
 *
 * pnpm bench:assets
 * pnpm bench:assets --module /absolute/path/to/baseline-createGameAssetStore.ts
 *
 * A baseline module must export createGameAssetStoreCore and resolve its
 * imports; use absolute imports for a snapshot outside the repository.
 * Fixtures, fake immediate pipelines, warmups and sample counts stay the
 * same across modules. Cached acquisition holds another lease throughout;
 * cold acquisition includes store construction and disposal.
 *
 * Planning counts describe the flat-scan and grouped-index algorithms,
 * independently of the loaded implementation. Pipeline calls are observed.
 * Heap-used deltas are GC-noisy observations, not allocation counts or
 * retained memory. No native image decoding, rendering or I/O is measured.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defineAssets, image } from '../src/assets/defineAssets';
import type { AssetGroupMap, GameAssetLease } from '../src/assets/types';
import type {
  AssetPipelines,
  createGameAssetStoreCore,
} from '../src/react/assets/createGameAssetStore';

interface AssetModule {
  readonly createGameAssetStoreCore: typeof createGameAssetStoreCore;
}

interface Scenario {
  readonly name: string;
  readonly groupCount: number;
  readonly assetsPerGroup: number;
  readonly selectedGroups: number;
  readonly iterationsPerSample: number;
}

interface Counters {
  resolves: number;
  decodes: number;
  disposals: number;
  widthReads: number;
  heightReads: number;
  progressUpdates: number;
}

const SAMPLE_COUNT = 30;
const WARMUP_COUNT = 10;
const scenarios: readonly Scenario[] = [
  { name: 'reference-sized-14', groupCount: 1, assetsPerGroup: 14, selectedGroups: 1, iterationsPerSample: 50 },
  { name: '100-levels-one-group', groupCount: 100, assetsPerGroup: 20, selectedGroups: 1, iterationsPerSample: 20 },
  { name: '100-levels-five-groups', groupCount: 100, assetsPerGroup: 20, selectedGroups: 5, iterationsPerSample: 20 },
  { name: '1000-levels-twenty-groups', groupCount: 1000, assetsPerGroup: 20, selectedGroups: 20, iterationsPerSample: 5 },
];

function fixture(scenario: Scenario) {
  const manifest = defineAssets(Object.fromEntries(
    Array.from({ length: scenario.groupCount }, (_, group) => [
      `group-${group}`,
      Object.fromEntries(Array.from({ length: scenario.assetsPerGroup }, (_, asset) => [
        `asset-${asset}`, image(group * scenario.assetsPerGroup + asset + 1),
      ])),
    ]),
  ));
  // Select from the end in reverse order to exercise request ordering.
  const groups = Array.from({ length: scenario.selectedGroups }, (_, index) =>
    `group-${scenario.groupCount - index - 1}`);
  return { manifest, groups };
}

function fakePipelines() {
  const counters: Counters = {
    resolves: 0, decodes: 0, disposals: 0,
    widthReads: 0, heightReads: 0, progressUpdates: 0,
  };
  const pipelines: AssetPipelines = {
    resolve: async (source) => {
      counters.resolves += 1;
      return `local:${source}`;
    },
    decode: async () => {
      counters.decodes += 1;
      let disposed = false;
      return {
        width: () => { counters.widthReads += 1; return 64; },
        height: () => { counters.heightReads += 1; return 64; },
        dispose: () => {
          assert.equal(disposed, false, 'each decoded handle disposes exactly once');
          disposed = true;
          counters.disposals += 1;
        },
      };
    },
  };
  return { counters, pipelines };
}

function validateLease(
  lease: GameAssetLease<AssetGroupMap>,
  manifest: AssetGroupMap,
  groups: readonly string[],
): void {
  for (const group of groups) {
    for (const descriptor of Object.values(manifest[group]!)) {
      const loaded = lease.assets.get(descriptor);
      assert.equal(loaded.width, 64);
      assert.equal(loaded.height, 64);
      assert.equal(loaded.descriptor, descriptor);
      assert.notEqual(loaded.image, undefined);
    }
  }
}

async function measure(
  operation: () => Promise<void>,
  counters: Counters,
  iterationsPerSample: number,
) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) await operation();
  const before = { ...counters };
  const heapBefore = process.memoryUsage().heapUsed;
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < iterationsPerSample; index += 1) await operation();
    samples.push((performance.now() - start) / iterationsPerSample);
  }
  const heapAfter = process.memoryUsage().heapUsed;
  samples.sort((first, second) => first - second);
  const acquisitions = SAMPLE_COUNT * iterationsPerSample;
  const callsPerAcquisition = Object.fromEntries(
    (Object.keys(counters) as (keyof Counters)[]).map((key) => [
      key, (counters[key] - before[key]) / acquisitions,
    ]),
  );
  return {
    warmupAcquisitions: WARMUP_COUNT,
    samples: SAMPLE_COUNT,
    iterationsPerSample,
    medianUs: Number((samples[Math.floor(SAMPLE_COUNT / 2)]! * 1000).toFixed(3)),
    p95Us: Number((samples[Math.floor(SAMPLE_COUNT * 0.95)]! * 1000).toFixed(3)),
    heapUsedDeltaKiB: Number(((heapAfter - heapBefore) / 1024).toFixed(1)),
    callsPerAcquisition,
  };
}

async function runScenario(scenario: Scenario, api: AssetModule): Promise<void> {
  const { manifest, groups } = fixture(scenario);
  const selectedAssets = scenario.selectedGroups * scenario.assetsPerGroup;
  const manifestAssets = scenario.groupCount * scenario.assetsPerGroup;
  const common = {
    scenario: scenario.name, manifestAssets, selectedGroups: groups.length, selectedAssets,
    planningModel: {
      flatScanAssetComparisons: manifestAssets * groups.length,
      groupedIndexAssetVisits: selectedAssets,
    },
  };
  for (const mode of ['cached', 'cold'] as const) {
    const { counters, pipelines } = fakePipelines();
    const store = api.createGameAssetStoreCore(manifest, pipelines);
    const heldLease = await store.acquire({ groups });
    validateLease(heldLease, manifest, groups);
    assert.equal(counters.decodes, selectedAssets, 'only selected assets decode');
    let progress = 0;
    const options = {
      groups,
      onProgress: (value: number) => { counters.progressUpdates += 1; progress = value; },
    };
    const operation = async (): Promise<void> => {
      const owner = mode === 'cold' ? api.createGameAssetStoreCore(manifest, pipelines) : store;
      try {
        const lease = await owner.acquire(options);
        lease.dispose();
      } finally {
        if (mode === 'cold') owner.dispose();
      }
    };
    try {
      const timing = await measure(operation, counters, scenario.iterationsPerSample);
      assert.equal(progress, 1, 'each acquisition reaches complete progress');
      assert.equal(timing.callsPerAcquisition.progressUpdates, selectedAssets);
      assert.equal(timing.callsPerAcquisition.decodes, mode === 'cold' ? selectedAssets : 0);
      assert.equal(timing.callsPerAcquisition.disposals, mode === 'cold' ? selectedAssets : 0);
      console.log(JSON.stringify({ ...common, operation: mode, ...timing }));
    } finally {
      heldLease.dispose();
      store.dispose();
      assert.equal(counters.disposals, counters.decodes, 'every decoded handle is released');
    }
  }
}

async function main(): Promise<void> {
  const flagIndex = process.argv.indexOf('--module');
  if (flagIndex !== -1 && process.argv[flagIndex + 1] === undefined) throw new Error('--module requires a path');
  const moduleUrl = flagIndex === -1
    ? new URL('../src/react/assets/createGameAssetStore.ts', import.meta.url).href
    : pathToFileURL(resolve(process.argv[flagIndex + 1]!)).href;
  const imported = await import(moduleUrl) as AssetModule & { readonly default?: AssetModule };
  const api = typeof imported.createGameAssetStoreCore === 'function' ? imported : imported.default;
  if (api === undefined || typeof api.createGameAssetStoreCore !== 'function') {
    throw new Error('The module must export createGameAssetStoreCore');
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, module: moduleUrl }));
  console.log('Fake immediate pipelines measure loading CPU work only. Heap deltas are GC-noisy, not allocation counts.');
  for (const scenario of scenarios) await runScenario(scenario, api);
}

void main();
