/**
 * The generic asset acquirer (T16-RF3, extracted T20G-R1 so the mounted
 * async-preparation integration test can drive the real React readiness
 * path instead of calling the controller directly).
 *
 * It mounts for the whole request lifetime (loading AND ready) of ANY
 * asset-backed catalog entry and unmounts only when the slot leaves the
 * game — so the lease the renderer borrows stays alive until the
 * replacement binding commits (T8.5). It is keyed by the request id: every
 * request owns a fresh acquisition, and a superseded request's lease is
 * released exactly once by unmount. The readiness callback carries the
 * request id; the shell ignores it when the request is no longer current
 * and never creates a gameplay session for a stale request.
 */
import { useEffect } from 'react';
import { useGameAssets } from 'rn-gamekit/react';

import type { SlotAssets } from './surfaceSlot';

export function GameAssetAcquirer({
  manifest,
  groups,
  requestId,
  onReady,
  onStateChange,
}: {
  readonly manifest: unknown;
  readonly groups: readonly string[];
  readonly requestId: number;
  readonly onReady: (requestId: number, assets: SlotAssets) => void;
  readonly onStateChange: (requestId: number, state: unknown) => void;
}) {
  const state = useGameAssets(manifest as never, { groups: groups as never[] });
  useEffect(() => {
    onStateChange(requestId, state);
    if (state.status === 'ready') {
      // The exact lease object passes through the slot unchanged: the
      // renderer calls `assets.get(...)` on it, so it must never be wrapped.
      onReady(requestId, state.assets as unknown as SlotAssets);
    }
  }, [onReady, onStateChange, requestId, state]);
  return null;
}
