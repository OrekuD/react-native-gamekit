import { defineAssets, image } from '../../src/assets/defineAssets';
import { createGameAssetStore, createGameAssetStoreCore, useGameAssets, type GameAssetStore } from '../../src/react';
import type { HookStore } from '../../src/react/assets/useGameAssets';

const numeric = defineAssets({ 1: { icon: image(1) } });
const mixed = defineAssets({ 1: { icon: image(1) }, boot: { logo: image(2) } });
const pipelines = {
  resolve: async () => 'fixture',
  decode: async () => ({ width: () => 1, height: () => 1, dispose: () => undefined }),
};

const native = createGameAssetStore(numeric);
void native.acquire({ groups: ['1'] });
// @ts-expect-error unknown numeric names are rejected
void native.acquire({ groups: ['2'] });
// @ts-expect-error selection uses the stringified runtime key
void native.acquire({ groups: [1] });

const namedNumeric: GameAssetStore<typeof numeric> = native;
void namedNumeric.acquire({ groups: ['1'] });
// @ts-expect-error named stores retain their numeric manifest group constraints
void namedNumeric.acquire({ groups: ['2'] });

const core = createGameAssetStoreCore(mixed, pipelines);
void core.acquire({ groups: ['1', 'boot'] });
// @ts-expect-error unknown string names are rejected
void core.acquire({ groups: ['missing'] });
// @ts-expect-error unknown numeric names are rejected
void core.acquire({ groups: ['2'] });

const namedMixed: GameAssetStore<typeof mixed> = core;
void namedMixed.acquire({ groups: ['1', 'boot'] });
// @ts-expect-error named stores retain their string manifest group constraints
void namedMixed.acquire({ groups: ['missing'] });

// The default remains usable when an adapter has a dynamic group map.
declare const dynamic: GameAssetStore;
void dynamic.acquire({ groups: ['dynamic-group'] });

const hookStore: HookStore<typeof mixed> = core;
void hookStore.acquire({ groups: ['1', 'boot'] });
// @ts-expect-error adapters retain the manifest's exact group names
void hookStore.acquire({ groups: ['2'] });

export function NumericAssetGroupsScreen() {
  useGameAssets(numeric, { groups: ['1'] });
  useGameAssets(mixed, { groups: ['1', 'boot'] }, () => core);
  // @ts-expect-error hooks reject unknown numeric group names
  useGameAssets(numeric, { groups: ['2'] });
  // @ts-expect-error hooks also require stringified runtime names
  useGameAssets(numeric, { groups: [1] });
  return null;
}
