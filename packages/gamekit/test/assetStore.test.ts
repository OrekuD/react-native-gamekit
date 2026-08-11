import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineAssets, GameAssetError, image, spriteSheet } from '../src/index';
import {
  createGameAssetStoreCore,
  type NativeImageHandle,
} from '../src/react/assets/createGameAssetStore';

class FakeHandle implements NativeImageHandle {
  disposed = false;
  constructor(
    readonly widthValue: number,
    readonly heightValue: number,
    private readonly onDispose: () => void,
  ) {}
  width(): number {
    return this.widthValue;
  }
  height(): number {
    return this.heightValue;
  }
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.onDispose();
    }
  }
}

/** Controllable pipeline fakes with per-URI decode counts. */
function fakePipelines(overrides?: {
  readonly decodeError?: (uri: string) => Error | undefined;
  readonly resolveError?: (source: number) => Error | undefined;
  /** Gate every decode behind an explicit release (progress/abort tests). */
  readonly gated?: boolean;
}) {
  const decodeCounts = new Map<string, number>();
  const disposedHandles: FakeHandle[] = [];
  const decodeGate: Array<() => void> = [];
  return {
    decodeCounts,
    disposedHandles,
    decodeGate,
    pipelines: {
      resolve: async (source: number) => {
        if (overrides?.resolveError) {
          const error = overrides.resolveError(source);
          if (error !== undefined) {
            throw error;
          }
        }
        return `file:///assets/${source}.png`;
      },
      decode: async (uri: string) => {
        decodeCounts.set(uri, (decodeCounts.get(uri) ?? 0) + 1);
        if (overrides?.decodeError) {
          const error = overrides.decodeError(uri);
          if (error !== undefined) {
            throw error;
          }
        }
        const handle = new FakeHandle(64, 64, () => disposedHandles.push(handle));
        if (!overrides?.gated) {
          return handle;
        }
        return new Promise<FakeHandle>((resolve) => {
          decodeGate.push(() => resolve(handle));
        });
      },
    },
  };
}

const manifest = defineAssets({
  boot: {
    logo: image(1),
    icon: image(2),
  },
  gameplay: {
    player: spriteSheet(3, {
      frames: {
        'idle-0': { x: 0, y: 0, width: 32, height: 32 },
      },
      animations: {
        idle: { frames: ['idle-0'], frameDurationMs: 140, mode: 'loop' },
      },
    }),
    enemy: image(2),
  },
});

/** Release all gated decodes. */
function releaseGate(gate: Array<() => void>): void {
  for (const release of gate.splice(0)) {
    release();
  }
}

describe('asset store ownership (T7.4)', () => {
  it('resolves, decodes, validates, and returns a ready lease', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const lease = await store.acquire({ groups: ['boot'] });
    const logo = lease.assets.get(manifest.boot.logo);
    assert.equal(logo.width, 64);
    assert.equal(logo.height, 64);
    assert.equal(fakes.decodeCounts.get('file:///assets/1.png'), 1);
    lease.dispose();
    store.dispose();
    assert.equal(fakes.disposedHandles.length, 2, 'final lease release disposes every handle');
  });

  it('two concurrent logical assets with the same source decode once', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const lease = await store.acquire({ groups: ['gameplay'] });
    // icon and enemy share source 2; player uses 3.
    assert.equal(fakes.decodeCounts.get('file:///assets/2.png'), 1, 'shared source decoded once');
    assert.equal(fakes.decodeCounts.get('file:///assets/3.png'), 1);
    lease.dispose();
    store.dispose();
  });

  it('two leases share a resource; the final release disposes the handle once', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const first = await store.acquire({ groups: ['boot'] });
    const second = await store.acquire({ groups: ['boot'] });
    assert.equal(fakes.decodeCounts.get('file:///assets/1.png'), 1, 'second lease reuses the cache');
    first.dispose();
    first.dispose();
    assert.equal(fakes.disposedHandles.length, 0, 'first dispose keeps the resources alive');
    second.dispose();
    assert.equal(fakes.disposedHandles.length, 2, 'final release disposes both handles exactly once');
    second.dispose();
    assert.equal(fakes.disposedHandles.length, 2, 'duplicate dispose is harmless');
    store.dispose();
  });

  it('rejects acquisition after store disposal and is idempotent', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    store.dispose();
    store.dispose();
    await assert.rejects(() => store.acquire({ groups: ['boot'] }), /ASSET_STORE_DISPOSED/);
    assert.equal(fakes.decodeCounts.size, 0, 'nothing decoded after disposal');
  });

  it('reports distinct structured errors for decode-null and resolution failure', async () => {
    const fakes = fakePipelines({
      decodeError: (uri) =>
        uri.includes('/1.png')
          ? new GameAssetError('ASSET_DECODE_FAILED', [], 'decode produced no image')
          : undefined,
    });
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    await assert.rejects(
      () => store.acquire({ groups: ['boot'] }),
      (error: unknown) => {
        assert.equal((error as GameAssetError).code, 'ASSET_DECODE_FAILED');
        return true;
      },
    );
    const resolved = fakePipelines({
      resolveError: () => new GameAssetError('ASSET_RESOLVE_FAILED', [], 'module missing'),
    });
    const other = createGameAssetStoreCore(manifest, resolved.pipelines);
    await assert.rejects(() => other.acquire({ groups: ['boot'] }), /ASSET_RESOLVE_FAILED/);
  });

  it('rejects an out-of-bounds sprite frame with a distinct code', async () => {
    const tiny = defineAssets({
      gameplay: {
        player: spriteSheet(9, {
          frames: {
            'idle-0': { x: 0, y: 0, width: 128, height: 128 },
          },
          animations: {
            idle: { frames: ['idle-0'], frameDurationMs: 140, mode: 'loop' },
          },
        }),
      },
    });
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(tiny, fakes.pipelines);
    await assert.rejects(
      () => store.acquire({ groups: ['gameplay'] }),
      (error: unknown) => {
        assert.equal((error as GameAssetError).code, 'ASSET_FRAME_OUT_OF_BOUNDS');
        return true;
      },
    );
    // The failed attempt releases its references and nothing leaks.
    assert.equal(fakes.disposedHandles.length, 1, 'the acquired handle is disposed on failure');
    store.dispose();
  });

  it('failure after N successful acquisitions releases only the attempt references', async () => {
    const fakes = fakePipelines({
      decodeError: (uri) =>
        uri.includes('/2.png') ? new Error('boom') : undefined,
    });
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    await assert.rejects(() => store.acquire({ groups: ['boot'] }), /boom/);
    // logo (source 1) acquired then released; nothing remains cached.
    assert.equal(fakes.disposedHandles.length, 1, 'the attempt-owned handle was disposed');
    const count = [...fakes.decodeCounts.values()].reduce((a, b) => a + b, 0);
    assert.equal(count, 2, 'both decodes were attempted; only the first succeeded');
    store.dispose();
  });

  it('empty group selection resolves immediately with progress 1', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    let progress = -1;
    const lease = await store.acquire({ groups: [], onProgress: (p) => (progress = p) });
    assert.equal(progress, 1);
    assert.equal(fakes.decodeCounts.size, 0, 'no decode for an empty selection');
    lease.dispose();
    store.dispose();
  });

  it('progress is monotonic and reaches exactly one before ready', async () => {
    const fakes = fakePipelines({ gated: true });
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const samples: number[] = [];
    const pending = store.acquire({ groups: ['boot'], onProgress: (p) => samples.push(p) });
    // Nothing resolves until the gate opens.
    let settled = false;
    void pending.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settled, false, 'acquire never resolves before all resources are ready');
    // The boot group has two assets: release every gate.
    while (fakes.decodeGate.length > 0) {
      releaseGate(fakes.decodeGate);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await pending;
    assert.deepEqual(samples, [0.5, 1], 'one update per completed logical asset');
    store.dispose();
  });

  it('abort during load releases the attempt references without late progress', async () => {
    const fakes = fakePipelines({ gated: true });
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const controller = new AbortController();
    const samples: number[] = [];
    const pending = store.acquire({
      groups: ['boot'],
      signal: controller.signal,
      onProgress: (p) => samples.push(p),
    });
    controller.abort();
    await assert.rejects(() => pending, /ASSET_ABORTED/);
    // Late decode completion must not resurrect anything.
    while (fakes.decodeGate.length > 0) {
      releaseGate(fakes.decodeGate);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(samples, [], 'no progress after abort');
    assert.equal(fakes.disposedHandles.length, 0, 'nothing was owned by the aborted attempt');
    store.dispose();
  });

  it('abort before start rejects immediately and decodes nothing', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => store.acquire({ groups: ['boot'], signal: controller.signal }),
      /ASSET_ABORTED/,
    );
    assert.equal(fakes.decodeCounts.size, 0);
    store.dispose();
  });

  it('retry ignores stale completion and cannot double-dispose', async () => {
    const fakes = fakePipelines({ gated: true });
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const first = store.acquire({ groups: ['boot'] });
    // A retry starts while the first attempt is still gated; both share the
    // in-flight decode and each waiter holds its own reference.
    const second = store.acquire({ groups: ['boot'] });
    // Release every gate as it appears (the second asset's decode starts
    // only after the first resolves).
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fakes.decodeGate.length > 0) {
        releaseGate(fakes.decodeGate);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const [leaseA, leaseB] = await Promise.all([first, second]);
    assert.equal(fakes.decodeCounts.get('file:///assets/1.png'), 1, 'shared in-flight load decoded once');
    leaseA.dispose();
    leaseB.dispose();
    assert.equal(fakes.disposedHandles.length, 2, 'both handles disposed exactly once after the final lease');
    store.dispose();
  });

  it('the loaded lookup rejects descriptors from another manifest', async () => {
    const other = defineAssets({ elsewhere: { logo: image(7) } });
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const lease = await store.acquire({ groups: ['boot'] });
    // The runtime identity check: a descriptor from another manifest cannot
    // be looked up (the type layer rejects it at compile time; the runtime
    // guard covers the untyped boundary).
    const lookup = (descriptor: unknown): unknown =>
      (lease.assets as { get: (d: unknown) => unknown }).get(descriptor);
    assert.throws(() => lookup(other.elsewhere.logo), /ASSET_UNKNOWN_ASSET/);
    lease.dispose();
    store.dispose();
  });

  it('the get guard fails clearly after the lease is disposed', async () => {
    const fakes = fakePipelines();
    const store = createGameAssetStoreCore(manifest, fakes.pipelines);
    const lease = await store.acquire({ groups: ['boot'] });
    lease.dispose();
    assert.throws(() => lease.assets.get(manifest.boot.logo), /lease is disposed/);
    store.dispose();
  });
});
