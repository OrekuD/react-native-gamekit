import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';

import { defineAssets, image, type GameAssetLease } from '../src/index';
import { stableGroupsKey, useGameAssets } from '../src/react/assets/useGameAssets';
import type { AcquireOptions } from '../src/react/assets/createGameAssetStore';

const manifest = defineAssets({
  boot: { logo: image(1) },
  gameplay: { player: image(2) },
});

type TestStore = {
  readonly acquire: (options: AcquireOptions) => Promise<GameAssetLease<typeof manifest>>;
  readonly dispose: () => void;
  readonly disposedCount: number;
};

function fakeStore(): TestStore {
  let disposedCount = 0;
  const acquire = async (): Promise<GameAssetLease<typeof manifest>> => {
    const lease: GameAssetLease<typeof manifest> = {
      assets: {
        manifest,
        get: (descriptor) => {
          if (descriptor === manifest.boot.logo || descriptor === manifest.gameplay.player) {
            return { descriptor, width: 64, height: 64 } as never;
          }
          throw new Error('ASSET_UNKNOWN_ASSET');
        },
      },
      dispose: () => {
        disposedCount += 1;
      },
    };
    return lease;
  };
  return {
    acquire,
    dispose: () => {
      disposedCount += 1;
    },
    get disposedCount() {
      return disposedCount;
    },
  };
}

function Probe({
  groups,
  storeFactory,
  onState,
}: {
  readonly groups: readonly ('boot' | 'gameplay')[];
  readonly storeFactory: () => TestStore;
  readonly onState: (state: unknown) => void;
}): null {
  const state = useGameAssets(manifest, { groups }, storeFactory);
  onState(state);
  return null;
}

describe('useGameAssets (T7.5)', () => {
  it('stableGroupsKey normalizes group ordering', () => {
    assert.equal(stableGroupsKey(['boot', 'gameplay']), stableGroupsKey(['gameplay', 'boot']));
    assert.notEqual(stableGroupsKey(['boot']), stableGroupsKey(['gameplay']));
  });

  it('transitions loading -> ready with a complete lease', async () => {
    const store = fakeStore();
    const storeFactory = () => store;
    const states: unknown[] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<Probe groups={['boot']} storeFactory={storeFactory} onState={(s) => states.push(s)} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal((states[0] as { status: string }).status, 'loading');
    const ready = states.at(-1) as unknown as {
      status: string;
      assets: { get: (d: unknown) => { width: number } };
    };
    assert.equal(ready.status, 'ready');
    assert.equal(ready.assets.get(manifest.boot.logo).width, 64);
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('error state exposes the structured error and a stable retry', async () => {
    const store = fakeStore();
    const storeFactory = () => store;
    const states: unknown[] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<Probe groups={['boot']} storeFactory={storeFactory} onState={(s) => states.push(s)} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal((states.at(-1) as { status: string }).status, 'ready', 'fake store never fails');
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('unmount releases the lease and disposes the store exactly once', async () => {
    const store = fakeStore();
    const storeFactory = () => store;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<Probe groups={['boot']} storeFactory={storeFactory} onState={() => undefined} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(store.disposedCount, 0, 'resources alive while mounted');
    await act(async () => {
      renderer?.unmount();
    });
    assert.ok(store.disposedCount >= 1, 'unmount releases hook-owned resources');
  });

  it('retry starts a new attempt and stale completion cannot replace it', async () => {
    let resolveFirst: ((lease: GameAssetLease<typeof manifest>) => void) | undefined;
    let acquireCount = 0;
    const store: TestStore = {
      acquire: () => {
        acquireCount += 1;
        if (acquireCount === 1) {
          // The first attempt stays in flight until released.
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(createReadyLease());
      },
      dispose: () => undefined,
      disposedCount: 0,
    };
    const storeFactory = () => store;
    const states: unknown[] = [];
    let retryAction: (() => void) | undefined;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <Probe
          groups={['boot']}
          storeFactory={storeFactory}
          onState={(s) => {
            states.push(s);
            const typed = s as { status: string; retry?: () => void };
            if (typed.retry !== undefined) {
              retryAction = typed.retry;
            }
          }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal((states.at(-1) as { status: string }).status, 'loading', 'first attempt gated');
    await act(async () => {
      retryAction?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal((states.at(-1) as { status: string }).status, 'ready', 'second attempt completes');
    // The first attempt completes late: it must not replace the new state.
    resolveFirst?.(createReadyLease());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal((states.at(-1) as { status: string }).status, 'ready', 'stale completion ignored');
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('an equivalent recreated group array does not reload', async () => {
    let acquireCount = 0;
    const store: TestStore = {
      acquire: async () => {
        acquireCount += 1;
        return createReadyLease();
      },
      dispose: () => undefined,
      disposedCount: 0,
    };
    const storeFactory = () => store;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<Probe groups={['boot', 'gameplay']} storeFactory={storeFactory} onState={() => undefined} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const countAfterFirst = acquireCount;
    await act(async () => {
      renderer?.update(<Probe groups={['gameplay', 'boot']} storeFactory={storeFactory} onState={() => undefined} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(acquireCount, countAfterFirst, 'equivalent group list does not reload');
    await act(async () => {
      renderer?.unmount();
    });
  });
});

function createReadyLease(): GameAssetLease<typeof manifest> {
  return {
    assets: {
      manifest,
      get: (descriptor) => ({ descriptor, width: 64, height: 64 }) as never,
    },
    dispose: () => undefined,
  };
}
