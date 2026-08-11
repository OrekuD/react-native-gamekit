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
 * - Retry starts a new attempt; late completion from an older attempt can
 *   never replace the new state.
 * - Unmount invalidates the attempt, releases the lease, and disposes the
 *   store — hook-owned resources are released exactly once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

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

/** The discriminated loading state machine. */
export type GameAssetsState<TManifest extends AssetGroupMap> =
  | { readonly status: 'loading'; readonly progress: number; readonly retry: () => void }
  | { readonly status: 'error'; readonly error: GameAssetError; readonly retry: () => void }
  | { readonly status: 'ready'; readonly assets: LoadedAssets<TManifest> };

/** Deduplicate and sort groups so equivalent reordered/duplicated arrays
 * map to one key and one acquisition (R6). */
export function dedupeGroups(groups: readonly string[]): readonly string[] {
  return [...new Set(groups)].sort();
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
  const [state, setState] = useState<GameAssetsState<TManifest>>({
    status: 'loading',
    progress: 0,
    retry: () => undefined,
  });
  const storeRef = useRef<HookStore<TManifest> | undefined>(undefined);
  const leaseRef = useRef<GameAssetLease<TManifest> | undefined>(undefined);
  const retry = useCallback(() => {
    // R6: one user action starts exactly one new attempt; the same function
    // identity is exposed in loading and error states.
    setAttempt((current) => current + 1);
  }, []);

  // Ref mirror of the attempt so stale-effect completions are rejected
  // after a retry re-renders with a higher attempt.
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  useEffect(() => {
    const store = (storeFactory ?? defaultStoreFactory)(manifest);
    storeRef.current = store;
    let disposed = false;
    const attemptAtStart = attempt;
    const isCurrent = (): boolean => attemptRef.current === attemptAtStart;
    const setIfCurrent = (updater: (previous: GameAssetsState<TManifest>) => GameAssetsState<TManifest>): void => {
      if (!disposed && isCurrent()) {
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
    });

    store
      .acquire({
        groups: dedupeGroups(options.groups),
        signal: controller.signal,
        onProgress: (progress) => {
          setIfCurrent((previous) =>
            previous.status === 'loading' ? { ...previous, progress } : previous,
          );
        },
      })
      .then((lease) => {
        if (disposed || !isCurrent()) {
          // Stale completion (retry/unmount): release immediately.
          lease.dispose();
          return;
        }
        leaseRef.current?.dispose();
        leaseRef.current = lease;
        setState({ status: 'ready', assets: lease.assets });
      })
      .catch((error: unknown) => {
        if (disposed || !isCurrent()) {
          return;
        }
        const structured =
          error instanceof GameAssetError
            ? error
            : new GameAssetError('ASSET_DECODE_FAILED', [], error instanceof Error ? error.message : String(error));
        setState({ status: 'error', error: structured, retry });
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
    // The groups key is order-independent, so a recreated equivalent array
    // does not reload; the attempt state drives retries. The store factory
    // is the internal test seam and must be stable across renders.
  }, [attempt, groupsKey, manifest, storeFactory]);

  return state;
}
