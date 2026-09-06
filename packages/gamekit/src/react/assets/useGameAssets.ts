/**
 * `useGameAssets` — the React loading adapter (T7.5).
 *
 * The hook creates and owns one asset store and lease for the requested
 * groups; the caller must not dispose the returned ready value manually.
 *
 * Contract:
 * - `{ status: 'loading'; progress }` — progress in [0, 1], monotonic;
 * - `{ status: 'error'; error; retry }` — structured error + stable retry;
 * - `{ status: 'ready'; assets }` — the complete lease, typed to the
 *   manifest.
 *
 * Lifecycle:
 * - The requested group list is normalized (sorted) so a recreated
 *   equivalent array does not reload.
 * - Every render executes all hooks unconditionally; when the rendered
 *   request differs from the state's request, the hook exposes a fresh
 *   loading view synchronously instead of a stale ready lease (GS-ASSET-03).
 * - Request identity combines manifest identity, factory identity,
 *   normalized groups, and retry attempt, so a new manifest with identical
 *   group names can never expose the previous manifest's lease.
 * - Retry starts a new attempt; late completion from an older attempt can
 *   never replace the new state.
 * - Unmount invalidates the attempt, releases the lease, and disposes the
 *   store — hook-owned resources are released exactly once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GameAssetError } from '../../assets/errors';
import type { AssetGroupMap, GameAssetLease, LoadedAssets } from '../../assets/types';
import type { AcquireOptions } from './createGameAssetStore';

/** The store surface the hook needs, kept generic over the manifest. */
export interface HookStore<TManifest extends AssetGroupMap> {
  readonly acquire: (options: AcquireOptions) => Promise<GameAssetLease<TManifest>>;
  readonly dispose: () => void;
}

/**
 * Default store factory using the Expo/Skia pipelines. The wiring module is
 * required lazily so the hook's import graph stays headless (tests inject
 * their own factory and never touch the native side).
 */
function defaultStoreFactory<TManifest extends AssetGroupMap>(
  manifest: TManifest,
): HookStore<TManifest> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createGameAssetStore } = require('./decodeSkiaImage') as {
    createGameAssetStore: <T extends AssetGroupMap>(value: T) => HookStore<T>;
  };
  return createGameAssetStore(manifest);
}

/** The discriminated loading state machine. Every state carries the
 * normalized request key (RF7) so a rendered request that differs from the
 * state's request can never expose a stale lease. */
export type GameAssetsState<TManifest extends AssetGroupMap> =
  | { readonly status: 'loading'; readonly progress: number; readonly retry: () => void; readonly requestKey: string }
  | { readonly status: 'error'; readonly error: GameAssetError; readonly retry: () => void; readonly requestKey: string }
  | { readonly status: 'ready'; readonly assets: LoadedAssets<TManifest>; readonly requestKey: string };

/** Deduplicate and sort groups so equivalent reordered/duplicated arrays
 * map to one key and one acquisition (R6). */
export function dedupeGroups(groups: readonly string[]): readonly string[] {
  return [...new Set(groups)].sort();
}

/** Stable numeric identities for request participants (GS-ASSET-03): object
 * identity, so a new manifest object with identical group names is a new
 * request even when every group string matches. */
const manifestIdentities = new WeakMap<object, number>();
const factoryIdentities = new WeakMap<object, number>();
let nextParticipantId = 1;

function participantId(table: WeakMap<object, number>, value: object): number {
  let id = table.get(value);
  if (id === undefined) {
    id = nextParticipantId;
    nextParticipantId += 1;
    table.set(value, id);
  }
  return id;
}

/** Order-independent group key: equivalent arrays map to one key. */
export function stableGroupsKey(groups: readonly string[]): string {
  return dedupeGroups(groups).join('\u0000');
}

export function useGameAssets<TManifest extends AssetGroupMap>(
  manifest: TManifest,
  options: { readonly groups: readonly (Extract<keyof TManifest, string>)[] },
  storeFactory?: (manifest: TManifest) => HookStore<TManifest>,
): GameAssetsState<TManifest> {
  const groupsKey = stableGroupsKey(options.groups);
  const [attempt, setAttempt] = useState(0);
  // A memoized normalized array: stable across equivalent recreated group
  // arrays, so the effect below never reloads for one (R6).
  const normalizedGroups = useMemo(() => dedupeGroups(options.groups), [groupsKey]);
  // `??` selects a reference, never a new closure, so the default factory
  // keeps a stable identity across renders.
  const factory = storeFactory ?? defaultStoreFactory;
  // GS-ASSET-03/04: the full request identity. Manifest and factory use
  // object identity; groups are normalized; the attempt drives retries.
  const requestKey =
    `${participantId(manifestIdentities, manifest)}:` +
    `${participantId(factoryIdentities, factory)}:${groupsKey}:${attempt}`;
  const [state, setState] = useState<GameAssetsState<TManifest>>({
    status: 'loading',
    progress: 0,
    retry: () => undefined,
    requestKey,
  });
  const storeRef = useRef<HookStore<TManifest> | undefined>(undefined);
  const leaseRef = useRef<GameAssetLease<TManifest> | undefined>(undefined);
  const retry = useCallback(() => {
    // R6: one user action starts exactly one new attempt; the same function
    // identity is exposed in loading and error states.
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    const store = factory(manifest);
    storeRef.current = store;
    // Per-effect invalidation (GS-ASSET-03): cleanup sets `disposed` before
    // any newer effect runs, so stale completions are rejected without a
    // render-time ref mutation standing in for ownership.
    let disposed = false;
    const setIfCurrent = (
      updater: (previous: GameAssetsState<TManifest>) => GameAssetsState<TManifest>,
    ): void => {
      if (!disposed) {
        setState(updater);
      }
    };

    // R6: every attempt owns an AbortController; aborting detaches the
    // caller and rejects late progress/ready/error from older configs.
    const controller = new AbortController();

    setState({
      status: 'loading',
      progress: 0,
      retry: retry,
      requestKey,
    });

    store
      .acquire({
        groups: normalizedGroups,
        signal: controller.signal,
        onProgress: (progress) => {
          setIfCurrent((previous) =>
            previous.status === 'loading' && previous.requestKey === requestKey
              ? { ...previous, progress }
              : previous,
          );
        },
      })
      .then((lease) => {
        if (disposed) {
          // Stale completion (retry/unmount): release immediately.
          lease.dispose();
          return;
        }
        leaseRef.current?.dispose();
        leaseRef.current = lease;
        setState({ status: 'ready', assets: lease.assets, requestKey });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const structured =
          error instanceof GameAssetError
            ? error
            : new GameAssetError('ASSET_DECODE_FAILED', [], error instanceof Error ? error.message : String(error));
        setState({ status: 'error', error: structured, retry, requestKey });
      });

    return () => {
      disposed = true;
      // R6: abort before releasing so no late completion can touch state or
      // resources, then release the lease and store exactly once.
      controller.abort();
      leaseRef.current?.dispose();
      leaseRef.current = undefined;
      storeRef.current = undefined;
      store.dispose();
    };
    // The effect re-runs only when the request identity (or its stable
    // derivatives) changes; equivalent recreated group arrays do not reload.
  }, [requestKey, manifest, factory, normalizedGroups, groupsKey, retry]);

  // GS-ASSET-03: every hook above runs unconditionally. When the rendered
  // request differs from the state's request, expose a fresh loading view
  // synchronously — never a stale ready lease, error, or progress.
  if (state.requestKey !== requestKey) {
    return { status: 'loading', progress: 0, retry, requestKey };
  }

  return state;
}
