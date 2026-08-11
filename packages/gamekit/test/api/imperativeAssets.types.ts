/**
 * Compile-time fixture: imperative asset-store ownership (Example 2, advanced).
 *
 * Type-checked by `pnpm typecheck`. Ownership is explicit:
 *
 * - an explicitly created store owns cache/native entries;
 * - `await store.acquire({ groups, signal })` resolves only with a complete
 *   usable lease;
 * - callers dispose the lease and then the store in `finally`;
 * - `AbortSignal` detaches an imperative caller immediately;
 * - the renderer borrows from the lease and never disposes its images.
 */
import { createGameAssetStore, type GameAssetLease } from '../src/index';

import { gameAssets } from '../api/assetsManifest.types';

export async function loadBootAndGameplay(
  abortController: AbortController,
): Promise<GameAssetLease<typeof gameAssets>> {
  const store = createGameAssetStore(gameAssets);
  const lease = await store.acquire({
    groups: ['boot', 'gameplay'],
    signal: abortController.signal,
  });

  try {
    // The lease is fully ready; the renderer borrows from it.
    const playerSheet = lease.assets.get(gameAssets.gameplay.player);
    const logo = lease.assets.get(gameAssets.boot.logo);
    void playerSheet;
    void logo;
    return lease;
  } catch (error) {
    // A failed/abandoned load cleans every partially acquired handle.
    lease.dispose();
    store.dispose();
    throw error;
  }
}

export async function withBorrowedLease(
  abortController: AbortController,
): Promise<void> {
  const store = createGameAssetStore(gameAssets);
  const lease = await store.acquire({
    groups: ['boot', 'gameplay'],
    signal: abortController.signal,
  });

  try {
    const playerSheet = lease.assets.get(gameAssets.gameplay.player);
    void playerSheet;
    // Mount/use resources that borrow from this lease.
  } finally {
    lease.dispose();
    store.dispose();
  }
}

// The store disposes exactly once and later access fails clearly.
export function disposeOnce(abortController: AbortController): void {
  const store = createGameAssetStore(gameAssets);
  void store.acquire({
    groups: ['boot'],
    signal: abortController.signal,
  });
  store.dispose();
}
