import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineAssets, image, spriteSheet } from '../src/assets/defineAssets';
import { GameAssetError } from '../src/assets/errors';
import { createGameAssetStoreCore, type NativeImageHandle } from '../src/react/assets/createGameAssetStore';

const manifest = defineAssets({ boot: { first: image(1), second: image(2) }, empty: {} });

function handle(overrides: Partial<NativeImageHandle> = {}): NativeImageHandle {
  return { width: () => 32, height: () => 32, dispose: () => undefined, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof GameAssetError && error.code === code;
}

describe('asset group selection', () => {
  it('preserves requested group order and declared asset order while deduplicating groups', async () => {
    const ordered = defineAssets({
      first: { a: image(1), b: image(2) },
      second: { c: image(3), d: image(4) },
      unused: { e: image(5) },
      empty: {},
    });
    const sources: number[] = [];
    const progress: number[] = [];
    const store = createGameAssetStoreCore(ordered, {
      resolve: async (source) => { sources.push(source); return String(source); },
      decode: async () => handle(),
    });
    const lease = await store.acquire({ groups: ['second', 'empty', 'first', 'second'], onProgress: (value) => progress.push(value) });
    assert.deepEqual(sources, [3, 4, 1, 2]);
    assert.deepEqual(progress, [0.25, 0.5, 0.75, 1]);
    assert.throws(() => lease.assets.get(ordered.unused.e), hasCode('ASSET_UNKNOWN_ASSET'));
    lease.dispose();
    store.dispose();
  });

  it('rejects any unknown group before resolving the valid groups in a request', async () => {
    let resolves = 0;
    const store = createGameAssetStoreCore(manifest, {
      resolve: async () => { resolves += 1; return 'source'; },
      decode: async () => handle(),
    });
    await assert.rejects(store.acquire({ groups: ['boot', 'missing'] as never }), (error) => {
      assert.ok(error instanceof GameAssetError);
      assert.equal(error.code, 'ASSET_UNKNOWN_GROUP');
      assert.deepEqual(error.path, ['missing']);
      return true;
    });
    assert.equal(resolves, 0);
    await assert.rejects(store.acquire({ groups: ['toString'] as never }), hasCode('ASSET_UNKNOWN_GROUP'));
    store.dispose();
  });

  it('loads declared groups whose names match object prototype properties', async () => {
    const special = defineAssets(Object.fromEntries([
      ['__proto__', { asset: image(1) }],
      ['constructor', { asset: image(2) }],
      ['toString', { asset: image(3) }],
    ]));
    const sources: number[] = [];
    const store = createGameAssetStoreCore(special, {
      resolve: async (source) => { sources.push(source); return String(source); },
      decode: async () => handle(),
    });
    const lease = await store.acquire({ groups: ['constructor', '__proto__', 'toString'] });
    assert.deepEqual(sources, [2, 1, 3]);
    lease.dispose();
    store.dispose();
  });
});

describe('asset acquisition cancellation boundaries', () => {
  for (const groups of [[], ['empty'], ['boot']] as const) {
    for (const action of ['abort', 'dispose'] as const) {
      it(`rejects ${action} from final progress for ${JSON.stringify(groups)}`, async () => {
        let disposals = 0;
        const controller = new AbortController();
        const store = createGameAssetStoreCore(manifest, {
          resolve: async (source) => String(source),
          decode: async () => handle({ dispose: () => { disposals += 1; } }),
        });
        await assert.rejects(store.acquire({
          groups,
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress === 1) {
              if (action === 'abort') controller.abort();
              else store.dispose();
            }
          },
        }), hasCode('ASSET_ABORTED'));
        assert.equal(disposals, groups[0] === 'boot' ? 2 : 0);
        store.dispose();
      });
    }
  }

  it('does not decode after disposal during source resolution', async () => {
    const resolution = deferred<string>();
    let decodes = 0;
    const store = createGameAssetStoreCore(manifest, {
      resolve: () => resolution.promise,
      decode: async () => { decodes += 1; return handle(); },
    });
    const pending = store.acquire({ groups: ['boot'] });
    store.dispose();
    resolution.resolve('first');
    await assert.rejects(pending, hasCode('ASSET_ABORTED'));
    assert.equal(decodes, 0);
    await assert.rejects(store.acquire({ groups: [] }), hasCode('ASSET_STORE_DISPOSED'));
  });

  it('stops before resolving another source when progress disposes the store', async () => {
    const sources: number[] = [];
    let disposals = 0;
    const store = createGameAssetStoreCore(manifest, {
      resolve: async (source) => { sources.push(source); return String(source); },
      decode: async () => handle({ dispose: () => { disposals += 1; } }),
    });
    await assert.rejects(store.acquire({ groups: ['boot'], onProgress: () => store.dispose() }), hasCode('ASSET_ABORTED'));
    assert.deepEqual(sources, [1]);
    assert.equal(disposals, 1);
  });

  it('detects a signal aborted by resolution before its listener is registered', async () => {
    const controller = new AbortController();
    let decodes = 0;
    let settled = false;
    const store = createGameAssetStoreCore(manifest, {
      resolve: async () => { controller.abort(); return 'first'; },
      decode: () => { decodes += 1; return new Promise(() => undefined); },
    });
    const pending = store.acquire({ groups: ['boot'], signal: controller.signal });
    const rejection = assert.rejects(pending, hasCode('ASSET_ABORTED')).then(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, true, 'cancellation detaches without waiting for another pipeline');
    assert.equal(decodes, 0);
    await rejection;
    store.dispose();
  });

  it('does not report progress when a decoded dimension callback cancels the request', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    let disposals = 0;
    const store = createGameAssetStoreCore(manifest, {
      resolve: async (source) => String(source),
      decode: async () => handle({
        width: () => { controller.abort(); return 32; },
        dispose: () => { disposals += 1; },
      }),
    });
    await assert.rejects(store.acquire({ groups: ['boot'], signal: controller.signal, onProgress: (value) => progress.push(value) }), hasCode('ASSET_ABORTED'));
    assert.deepEqual(progress, []);
    assert.equal(disposals, 1);
    store.dispose();
  });
});

describe('decoded dimensions and loaded ownership', () => {
  for (const dimension of ['width', 'height'] as const) {
    for (const value of [NaN, Infinity, 0, -1]) {
      it(`rejects ${dimension} ${String(value)} before publishing a lease`, async () => {
        let disposals = 0;
        const store = createGameAssetStoreCore(manifest, {
          resolve: async (source) => String(source),
          decode: async () => handle({ [dimension]: () => value, dispose: () => { disposals += 1; } }),
        });
        await assert.rejects(store.acquire({ groups: ['boot'] }), hasCode('ASSET_DECODE_FAILED'));
        assert.equal(disposals, 1);
        store.dispose();
      });
    }
  }

  it('snapshots dimensions once per shared decode and freezes only loaded records', async () => {
    const shared = defineAssets({ boot: { first: image(1), second: image(1) } });
    let widths = 0;
    let heights = 0;
    const native = handle({ width: () => { widths += 1; return 32; }, height: () => { heights += 1; return 32; } });
    const store = createGameAssetStoreCore(shared, { resolve: async () => 'shared', decode: async () => native });
    const first = await store.acquire({ groups: ['boot'] });
    const second = await store.acquire({ groups: ['boot'] });
    const loaded = first.assets.get(shared.boot.first);
    assert.equal(widths, 1);
    assert.equal(heights, 1);
    assert.equal(Object.isFrozen(loaded), true);
    assert.equal(Object.isFrozen(native), false, 'native handle methods remain owned by the pipeline');
    assert.throws(() => Object.assign(loaded, { width: 0 }), TypeError);
    assert.equal(first.assets.get(shared.boot.first), loaded, 'lookup reuses its validated record');
    assert.equal(second.assets.get(shared.boot.second).width, 32);
    first.dispose();
    second.dispose();
    store.dispose();
  });

  it('releases a native handle when reading decoded dimensions throws', async () => {
    const failure = new Error('dimension read failed');
    let disposals = 0;
    const store = createGameAssetStoreCore(manifest, {
      resolve: async (source) => String(source),
      decode: async () => handle({ width: () => { throw failure; }, dispose: () => { disposals += 1; } }),
    });
    await assert.rejects(store.acquire({ groups: ['boot'] }), (error) => error === failure);
    assert.equal(disposals, 1);
    store.dispose();
  });
});

describe('exceptional native cleanup', () => {
  it('releases all resources and evicts handles even when native disposal throws', async () => {
    const failure = new Error('dispose first');
    let decodes = 0;
    const disposed: string[] = [];
    const store = createGameAssetStoreCore(manifest, {
      resolve: async (source) => String(source),
      decode: async (uri) => {
        decodes += 1;
        return handle({ dispose: () => { disposed.push(uri); if (uri === '1') throw failure; } });
      },
    });
    const lease = await store.acquire({ groups: ['boot'] });
    assert.throws(() => lease.dispose(), (error) => error === failure);
    assert.deepEqual(disposed, ['1', '2']);
    lease.dispose();
    assert.deepEqual(disposed, ['1', '2'], 'repeated lease disposal does not retry native disposal');
    const retry = await store.acquire({ groups: ['boot'] });
    assert.equal(decodes, 4, 'fresh acquisitions never reuse a handle whose disposal was attempted');
    assert.throws(() => retry.dispose(), (error) => error === failure);
    store.dispose();
  });

  it('aggregates multiple disposal errors after releasing every resource', async () => {
    const failures = [new Error('first'), new Error('second')];
    const store = createGameAssetStoreCore(manifest, {
      resolve: async (source) => String(source),
      decode: async (uri) => handle({ dispose: () => { throw failures[Number(uri) - 1]; } }),
    });
    const lease = await store.acquire({ groups: ['boot'] });
    assert.throws(() => lease.dispose(), (error) => error instanceof AggregateError && error.errors[0] === failures[0] && error.errors[1] === failures[1]);
    store.dispose();
  });

  it('preserves a progress failure alongside cleanup failures', async () => {
    const primary = new Error('observer failed');
    const cleanup = new Error('dispose failed');
    const disposed: string[] = [];
    const store = createGameAssetStoreCore(manifest, {
      resolve: async (source) => String(source),
      decode: async (uri) => handle({ dispose: () => { disposed.push(uri); if (uri === '1') throw cleanup; } }),
    });
    await assert.rejects(store.acquire({ groups: ['boot'], onProgress: (progress) => { if (progress === 1) throw primary; } }), (error) => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
    assert.deepEqual(disposed, ['1', '2']);
    store.dispose();
  });

  it('preserves sprite validation failures when releasing its native handle also fails', async () => {
    const cleanup = new Error('dispose failed');
    const invalid = defineAssets({ boot: { sheet: spriteSheet(1, { frames: { frame: { x: 0, y: 0, width: 64, height: 64 } }, animations: {} }) } });
    const store = createGameAssetStoreCore(invalid, { resolve: async () => 'first', decode: async () => handle({ dispose: () => { throw cleanup; } }) });
    await assert.rejects(store.acquire({ groups: ['boot'] }), (error) => error instanceof AggregateError && hasCode('ASSET_FRAME_OUT_OF_BOUNDS')(error.errors[0]) && error.errors[1] === cleanup);
    store.dispose();
  });
});
