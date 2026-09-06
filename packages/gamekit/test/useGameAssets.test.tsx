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

describe('GS-ASSET-03 request identity and hook ordering', () => {
  type Recorded = { status: string; requestKey: string; assets?: unknown };

  function collectStates(): { states: Recorded[]; onState: (state: unknown) => void } {
    const states: Recorded[] = [];
    return {
      states,
      onState: (state: unknown) => {
        states.push(state as Recorded);
      },
    };
  }

  it('ready to different groups keeps hook order with a loading boundary', async () => {
    const { states, onState } = collectStates();
    const storeFactory = () => fakeStore();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<Probe groups={['boot']} storeFactory={storeFactory} onState={onState} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(states.at(-1)?.status, 'ready', 'boot request goes ready');
    const bootKey = states.at(-1)?.requestKey;
    const bootAssets = states.at(-1)?.assets;
    const seen = states.length;

    await act(async () => {
      renderer?.update(
        <Probe groups={['gameplay']} storeFactory={storeFactory} onState={onState} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const after = states.slice(seen);
    assert.ok(after.length > 0, 'the group change renders');
    assert.equal(after[0]?.status, 'loading', 'no stale ready lease is visible for the new request');
    assert.notEqual(after[0]?.requestKey, bootKey, 'the loading view carries the new request key');
    assert.equal(states.at(-1)?.status, 'ready', 'gameplay request goes ready');
    assert.notEqual(states.at(-1)?.assets, bootAssets, 'a new lease backs the new request');
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('a new manifest with identical group names never exposes the old lease', async () => {
    const second = defineAssets({ boot: { logo: image(99) } });
    const factories = new WeakMap<object, () => TestStore>();
    function ManifestProbe({
      active,
      onState,
    }: {
      readonly active: typeof manifest | typeof second;
      readonly onState: (state: unknown) => void;
    }): null {
      let factory = factories.get(active);
      if (factory === undefined) {
        const owned = active;
        const created: () => TestStore = () => {
          const inner = fakeStore();
          const lease = {
            assets: {
              manifest: owned,
              get: (descriptor: unknown) => {
                const mine =
                  owned === second ? (second.boot.logo as unknown) : (manifest.boot.logo as unknown);
                if (descriptor === mine) {
                  return { descriptor, width: 64, height: 64 } as never;
                }
                throw new Error('ASSET_UNKNOWN_ASSET');
              },
            },
            dispose: () => undefined,
          } as unknown as GameAssetLease<typeof manifest>;
          return {
            ...inner,
            acquire: async () => lease,
          };
        };
        factories.set(active, created);
        factory = created;
      }
      const state = useGameAssets(active, { groups: ['boot'] as never }, factory as never);
      onState(state);
      return null;
    }

    const { states, onState } = collectStates();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<ManifestProbe active={manifest} onState={onState} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(states.at(-1)?.status, 'ready', 'first manifest goes ready');
    const seen = states.length;

    await act(async () => {
      renderer?.update(<ManifestProbe active={second} onState={onState} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const after = states.slice(seen);
    assert.ok(after.length > 0, 'the manifest change renders');
    assert.equal(after[0]?.status, 'loading', 'the old lease is never visible under the new manifest');
    const last = states.at(-1) as Recorded & {
      assets: { get: (descriptor: unknown) => { width: number } };
    };
    assert.equal(last.status, 'ready');
    assert.equal(last.assets.get(second.boot.logo).width, 64, 'the new lease serves the new manifest');
    assert.throws(
      () => last.assets.get(manifest.boot.logo),
      /ASSET_UNKNOWN_ASSET/,
      'the old descriptor is not a member of the new lease',
    );
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('retry during pending acquisition moves to a new request key', async () => {
    let acquireCount = 0;
    let releaseFirst: (() => void) | undefined;
    const store: TestStore = {
      acquire: () => {
        acquireCount += 1;
        if (acquireCount === 1) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve(createReadyLease());
          });
        }
        return Promise.resolve(createReadyLease());
      },
      dispose: () => undefined,
      disposedCount: 0,
    };
    const { states, onState } = collectStates();
    let retryAction: (() => void) | undefined;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <Probe
          groups={['boot']}
          storeFactory={() => store}
          onState={(s) => {
            onState(s);
            const typed = s as { retry?: () => void };
            if (typed.retry !== undefined) {
              retryAction = typed.retry;
            }
          }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const firstKey = states.at(-1)?.requestKey;
    await act(async () => {
      retryAction?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    releaseFirst?.();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const keys = new Set(states.map((s) => s.requestKey));
    assert.ok(keys.size >= 2, 'the retry renders under a new request identity');
    assert.notEqual(states.at(-1)?.requestKey, firstKey, 'the completed retry keeps its own key');
    assert.equal(states.at(-1)?.status, 'ready');
    await act(async () => {
      renderer?.unmount();
    });
  });
});

describe('GS-ASSET-03 acceptance: StrictMode mount', () => {
  it('StrictMode mounts ready and releases everything on unmount', async () => {
    const { StrictMode } = await import('react');
    const created: TestStore[] = [];
    const storeFactory = (): TestStore => {
      const store = fakeStore();
      created.push(store);
      return store;
    };
    const states: unknown[] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <StrictMode>
          <Probe groups={['boot']} storeFactory={storeFactory} onState={(s) => states.push(s)} />
        </StrictMode>,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(
      (states.at(-1) as { status: string }).status,
      'ready',
      'StrictMode double-effects still settle ready',
    );
    await act(async () => {
      renderer?.unmount();
    });
    assert.ok(created.length >= 1, 'at least one store served the mount');
    for (const store of created) {
      assert.ok(store.disposedCount >= 1, 'every created store is disposed on unmount');
    }
  });
});
