import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { defineAssets, image } from '../src/assets/defineAssets';
import { GameAssetError } from '../src/assets/errors';
import type { GameAssetLease } from '../src/assets/types';
import {
  stableGroupsKey,
  useGameAssets,
  type GameAssetsState,
  type HookStore,
} from '../src/react/assets/useGameAssets';
import type { AcquireOptions } from '../src/react/assets/createGameAssetStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const manifest = defineAssets({
  a: { image: image(1) },
  b: { image: image(2) },
  ['a\u0000b']: { image: image(3) },
});

type State = GameAssetsState<typeof manifest>;
type Factory = () => HookStore<typeof manifest>;

function Probe({
  groups = ['a'],
  factory,
  onState,
}: {
  readonly groups?: readonly (keyof typeof manifest)[];
  readonly factory: Factory;
  readonly onState: (state: State) => void;
}): null {
  onState(useGameAssets(manifest, { groups }, factory));
  return null;
}

function trackedLease() {
  let disposedCount = 0;
  const lease: GameAssetLease<typeof manifest> = {
    assets: {
      manifest,
      get: (descriptor) => ({ descriptor, width: 1, height: 1, image: {} }) as never,
    },
    dispose: () => { disposedCount += 1; },
  };
  return { lease, get disposedCount() { return disposedCount; } };
}

function trackedStore(acquire: HookStore<typeof manifest>['acquire']) {
  let disposedCount = 0;
  return {
    acquire,
    dispose: () => { disposedCount += 1; },
    get disposedCount() { return disposedCount; },
  };
}

function deferredLease() {
  let resolve!: (lease: GameAssetLease<typeof manifest>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<GameAssetLease<typeof manifest>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('asset hook request and attempt ownership', () => {
  it('keeps group keys unambiguous while normalizing order and duplicates', () => {
    assert.notEqual(stableGroupsKey(['a', 'b']), stableGroupsKey(['a\u0000b']));
    assert.notEqual(stableGroupsKey([]), stableGroupsKey(['']));
    assert.equal(stableGroupsKey(['b', 'a', 'a']), stableGroupsKey(['a', 'b']));
  });

  it('acquires the new selection when a valid group contains the old key delimiter', async () => {
    const selected: string[][] = [];
    const leases: ReturnType<typeof trackedLease>[] = [];
    const factory = () => trackedStore(async ({ groups }) => {
      selected.push([...groups]);
      const tracked = trackedLease();
      leases.push(tracked);
      return tracked.lease;
    });
    const states: State[] = [];
    const onState = (state: State) => { states.push(state); };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => { renderer = create(<Probe groups={['a', 'b']} factory={factory} onState={onState} />); });
      const firstState = states.at(-1);
      assert.equal(firstState?.status, 'ready');
      const seen = states.length;
      await act(async () => { renderer?.update(<Probe groups={['a\u0000b']} factory={factory} onState={onState} />); });
      assert.deepEqual(selected, [['a', 'b'], ['a\u0000b']]);
      assert.equal(states[seen]?.status, 'loading', 'a new request hides the old lease immediately');
      assert.notEqual(states.at(-1)?.requestKey, firstState?.requestKey);
      assert.equal(leases[0]?.disposedCount, 1);
      assert.equal(leases[1]?.disposedCount, 0);
    } finally {
      await act(async () => renderer?.unmount());
    }
    assert.equal(leases[1]?.disposedCount, 1);
  });

  it('publishes a factory error and recovers with the same retry callback', async () => {
    const failure = new GameAssetError('ASSET_RESOLVE_FAILED', ['a'], 'factory failed');
    const ready = trackedLease();
    const store = trackedStore(async () => ready.lease);
    let calls = 0;
    const factory = () => {
      calls += 1;
      if (calls === 1) throw failure;
      return store;
    };
    const states: State[] = [];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => { renderer = create(<Probe factory={factory} onState={(state) => states.push(state)} />); });
      const first = states[0];
      const failed = states.at(-1);
      assert.equal(first?.status, 'loading');
      assert.equal(failed?.status, 'error');
      if (first?.status !== 'loading' || failed?.status !== 'error') assert.fail('expected loading and error');
      assert.equal(failed.error, failure);
      assert.equal(first.retry, failed.retry);
      await act(async () => failed.retry());
      assert.equal(states.at(-1)?.status, 'ready');
      assert.equal(calls, 2);
    } finally {
      await act(async () => renderer?.unmount());
    }
    assert.equal(store.disposedCount, 1);
    assert.equal(ready.disposedCount, 1);
  });

  it('owns cleanup even when acquisition throws before returning a promise', async () => {
    const failedStore = trackedStore(() => { throw new Error('acquire failed'); });
    const ready = trackedLease();
    const readyStore = trackedStore(async () => ready.lease);
    let calls = 0;
    const factory = () => ++calls === 1 ? failedStore : readyStore;
    const states: State[] = [];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => { renderer = create(<Probe factory={factory} onState={(state) => states.push(state)} />); });
      const failed = states.at(-1);
      assert.equal(failed?.status, 'error');
      if (failed?.status !== 'error') assert.fail('expected error');
      assert.equal(failed.error.code, 'ASSET_DECODE_FAILED');
      assert.match(failed.error.message, /acquire failed/);
      await act(async () => failed.retry());
      assert.equal(failedStore.disposedCount, 1);
      assert.equal(states.at(-1)?.status, 'ready');
    } finally {
      await act(async () => renderer?.unmount());
    }
    assert.equal(failedStore.disposedCount, 1);
    assert.equal(readyStore.disposedCount, 1);
    assert.equal(ready.disposedCount, 1);
  });

  it('normalizes a rejected non-Error value without coercing it and preserves the cause', async () => {
    const cause: unknown = Object.create(null);
    const store = trackedStore(async () => { throw cause; });
    const factory = () => store;
    const states: State[] = [];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => { renderer = create(<Probe factory={factory} onState={(state) => states.push(state)} />); });
      const failed = states.at(-1);
      assert.equal(failed?.status, 'error');
      if (failed?.status !== 'error') assert.fail('expected error');
      assert.equal(failed.error.code, 'ASSET_DECODE_FAILED');
      assert.equal(failed.error.cause, cause);
    } finally {
      await act(async () => renderer?.unmount());
    }
    assert.equal(store.disposedCount, 1);
  });

  it('the initial loading retry starts a real attempt and releases a stale lease once', async () => {
    const pending = deferredLease();
    const stale = trackedLease();
    const ready = trackedLease();
    const attempts: AcquireOptions[] = [];
    const stores = [
      trackedStore((options) => { attempts.push(options); return pending.promise; }),
      trackedStore(async (options) => { attempts.push(options); return ready.lease; }),
    ];
    let calls = 0;
    const factory = () => stores[calls++]!;
    const states: State[] = [];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => { renderer = create(<Probe factory={factory} onState={(state) => states.push(state)} />); });
      const initial = states[0];
      assert.equal(initial?.status, 'loading');
      if (initial?.status !== 'loading') assert.fail('expected initial loading');
      await act(async () => initial.retry());
      assert.equal(calls, 2, 'the first callback is functional');
      assert.equal(attempts[0]?.signal?.aborted, true);
      assert.equal(stores[0]?.disposedCount, 1);
      const current = states.at(-1);
      assert.equal(current?.status, 'ready');
      await act(async () => {
        attempts[0]?.onProgress?.(0.5);
        pending.resolve(stale.lease);
      });
      assert.equal(stale.disposedCount, 1);
      assert.equal(states.at(-1), current, 'late progress and ready cannot replace the new state');
    } finally {
      await act(async () => renderer?.unmount());
    }
    assert.equal(stores[1]?.disposedCount, 1);
    assert.equal(ready.disposedCount, 1);
  });

  it('ignores rejected acquisition after unmount while aborting and disposing its store once', async () => {
    const pending = deferredLease();
    let signal: AbortSignal | undefined;
    const store = trackedStore((options) => { signal = options.signal; return pending.promise; });
    const factory = () => store;
    const states: State[] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => { renderer = create(<Probe factory={factory} onState={(state) => states.push(state)} />); });
    await act(async () => renderer?.unmount());
    const rendered = states.length;
    await act(async () => pending.reject(new Error('late failure')));
    assert.equal(signal?.aborted, true);
    assert.equal(store.disposedCount, 1);
    assert.equal(states.length, rendered);
  });

  it('StrictMode gives each effect one store and releases every lease exactly once', async () => {
    const leases: ReturnType<typeof trackedLease>[] = [];
    const stores: ReturnType<typeof trackedStore>[] = [];
    const factory = () => {
      const tracked = trackedLease();
      const store = trackedStore(async () => tracked.lease);
      leases.push(tracked);
      stores.push(store);
      return store;
    };
    const states: State[] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StrictMode><Probe factory={factory} onState={(state) => states.push(state)} /></StrictMode>);
    });
    assert.equal(states.at(-1)?.status, 'ready');
    assert.equal(stores.length, 2, 'StrictMode exercises setup, cleanup, and setup');
    assert.deepEqual(stores.map((store) => store.disposedCount), [1, 0]);
    assert.deepEqual(leases.map((lease) => lease.disposedCount), [1, 0]);
    await act(async () => renderer?.unmount());
    assert.deepEqual(stores.map((store) => store.disposedCount), [1, 1]);
    assert.deepEqual(leases.map((lease) => lease.disposedCount), [1, 1]);
  });

  it('still disposes its store when lease disposal throws during unmount', async () => {
    const ready = trackedLease();
    const failure = new Error('lease release failed');
    const lease = {
      assets: ready.lease.assets,
      dispose: () => { ready.lease.dispose(); throw failure; },
    };
    const store = trackedStore(async () => lease);
    const factory = () => store;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => { renderer = create(<Probe factory={factory} onState={() => undefined} />); });
    await assert.rejects(async () => { await act(async () => renderer?.unmount()); }, failure);
    assert.equal(ready.disposedCount, 1);
    assert.equal(store.disposedCount, 1);
  });
});
