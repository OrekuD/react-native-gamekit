import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MossyCavern2Profile } from './mossyCavern2Save.ts';

/**
 * T20F-R3 — Mossy Cavern 2 hydrates its run state from the validated profile
 * projection before the first fixed tick.
 *
 * The profile stores aggregate meta-progress. The lossless part of that
 * projection for run state is the checkpoint index, which seeds the respawn
 * point; the aggregate relic count intentionally does not resurrect entities
 * (the same lossy semantics as the checkpoint respawn itself).
 */

// The manifest uses Metro's static require convention and the session uses a
// platform frame driver; node tests stub both to keep hydration deterministic
// and frozen at the pre-first-tick frame.
(globalThis as { require?: (id: string) => number }).require = () => 42;
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0;
(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {};


const { createMossyCavern2Session, mossyCavern2CheckpointSpawn } = await import(
  './mossyCavern2Game.ts'
);

interface HydrationSnapshot {
  readonly checkpointIndex: number;
  readonly player: { readonly body: { readonly x: number; readonly y: number } };
  readonly status: 'exploring' | 'complete';
}

function initialSnapshot(profile?: MossyCavern2Profile): HydrationSnapshot {
  const session = createMossyCavern2Session(profile);
  const snapshot = session.getRenderFrame().current as unknown as HydrationSnapshot;
  session.dispose();
  return snapshot;
}

describe('T20F-R3 Mossy Cavern 2 profile hydration', () => {
  it('a profile with a reached checkpoint spawns the player there before the first tick', () => {
    const profile: MossyCavern2Profile = {
      muted: false,
      hapticsMuted: false,
      relicsRecovered: 2,
      checkpointsReached: 2,
      completedRuns: 1,
      bestTimeMs: 51_000,
    };
    const snapshot = initialSnapshot(profile);
    assert.equal(snapshot.checkpointIndex, 2);
    const expected = mossyCavern2CheckpointSpawn(2);
    assert.equal(snapshot.player.body.x, expected.x);
    assert.equal(snapshot.player.body.y, expected.y);
  });

  it('an out-of-range checkpoint index clamps instead of crashing', () => {
    const profile: MossyCavern2Profile = {
      muted: false,
      hapticsMuted: false,
      relicsRecovered: 3,
      checkpointsReached: 99,
      completedRuns: 0,
      bestTimeMs: null,
    };
    const snapshot = initialSnapshot(profile);
    const expected = mossyCavern2CheckpointSpawn(99);
    assert.equal(snapshot.player.body.x, expected.x, 'the helper clamps to the last authored checkpoint');
    assert.equal(snapshot.status, 'exploring', 'a restored run is never pre-completed');
  });

  it('no profile keeps the fresh-run defaults', () => {
    const snapshot = initialSnapshot(undefined);
    assert.equal(snapshot.checkpointIndex, 0);
    const expected = mossyCavern2CheckpointSpawn(0);
    assert.equal(snapshot.player.body.x, expected.x);
  });
});

describe('T20F-R3 profile loader fail-open', () => {
  it('a storage-unavailable environment yields no profile instead of throwing', async () => {
    const { loadMossyCavern2Profile } = await import('./mossyCavern2Save.ts');
    const profile = await loadMossyCavern2Profile();
    assert.equal(profile, undefined, 'fail-open: the shell constructs a fresh run');
  });
});
