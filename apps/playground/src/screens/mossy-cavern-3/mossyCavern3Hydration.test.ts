import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MossyCavern3SaveData } from './mossyCavern3Save.ts';
import { createDefaultMossyCavern3Save } from './mossyCavern3Save.ts';

/**
 * T20F-R3 — Mossy Cavern 3 hydrates its run state from the validated save
 * projection before the first fixed tick: the player respawns at the saved
 * lantern, the saved crystals are already collected, and the death counter
 * carries over.
 */

// The manifest uses Metro's static require convention and the session uses a
// platform frame driver; node tests stub both to keep hydration deterministic
// and frozen at the pre-first-tick frame.
(globalThis as { require?: (id: string) => number }).require = () => 42;
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0;
(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {};


const { MOSSY_CAVERN_3_LEVEL } = await import('./mossyCavern3Level.ts');
const { createMossyCavern3Session } = await import('./mossyCavern3Game.ts');

interface HydrationSnapshot {
  readonly activeCheckpointId: string | null;
  readonly collectedCrystalIds: readonly string[];
  readonly deaths: number;
  readonly phase: 'playing' | 'won';
  readonly player: { readonly x: number; readonly y: number };
}

function checkpointRespawnBody(id: string): { readonly x: number; readonly y: number } {
  const checkpoint = MOSSY_CAVERN_3_LEVEL.checkpoints.find((candidate) => candidate.id === id);
  assert.ok(checkpoint !== undefined, 'the fixture uses an authored checkpoint id');
  return checkpoint.respawnBody;
}

function initialSnapshot(save: MossyCavern3SaveData): HydrationSnapshot {
  const session = createMossyCavern3Session(save);
  const snapshot = session.getRenderFrame().current as unknown as HydrationSnapshot;
  session.dispose();
  return snapshot;
}

describe('T20F-R3 Mossy Cavern 3 save hydration', () => {
  it('the player respawns at the saved lantern before the first tick', () => {
    const save: MossyCavern3SaveData = {
      ...createDefaultMossyCavern3Save(),
      activeCheckpointId: MOSSY_CAVERN_3_LEVEL.checkpoints[1]!.id,
    };
    const snapshot = initialSnapshot(save);
    assert.equal(snapshot.activeCheckpointId, save.activeCheckpointId);
    const expected = checkpointRespawnBody(save.activeCheckpointId!);
    assert.equal(snapshot.player.x, expected.x);
    assert.equal(snapshot.player.y, expected.y);
  });

  it('saved crystals are already collected in the first published snapshot', () => {
    const crystalIds = MOSSY_CAVERN_3_LEVEL.crystals.slice(0, 2).map((crystal) => crystal.id);
    const save: MossyCavern3SaveData = {
      ...createDefaultMossyCavern3Save(),
      collectedCrystalIds: crystalIds,
      deaths: 4,
    };
    const snapshot = initialSnapshot(save);
    assert.deepEqual([...snapshot.collectedCrystalIds].sort(), [...crystalIds].sort());
    assert.equal(snapshot.deaths, 4);
    assert.equal(snapshot.phase, 'playing', 'a restored run is never pre-won');
  });

  it('an unknown checkpoint id normalizes to null and falls back to the authored spawn (T20G-R4)', () => {
    const save: MossyCavern3SaveData = {
      ...createDefaultMossyCavern3Save(),
      activeCheckpointId: 'not-a-checkpoint',
    };
    const snapshot = initialSnapshot(save);
    assert.equal(
      snapshot.activeCheckpointId,
      null,
      'an impossible checkpoint id must not survive into simulation state',
    );
    const spawn = MOSSY_CAVERN_3_LEVEL.spawnBody;
    assert.equal(snapshot.player.x, spawn.x);
    assert.equal(snapshot.player.y, spawn.y);
  });

  it('session construction clones caller-owned crystal arrays (T20G-R6)', () => {
    const crystalIds = [MOSSY_CAVERN_3_LEVEL.crystals[0]!.id];
    const save: MossyCavern3SaveData = {
      ...createDefaultMossyCavern3Save(),
      collectedCrystalIds: crystalIds,
    };
    const session = createMossyCavern3Session(save);
    const snapshot = session.getRenderFrame().current as unknown as HydrationSnapshot;
    // Construction must not freeze the caller's array as a side effect of
    // deep-freezing the first published snapshot.
    assert.equal(Object.isFrozen(crystalIds), false, 'the caller array stays mutable');
    // And the session must not observe later mutation of the caller array.
    crystalIds.push('mutated-later');
    assert.deepEqual(
      [...snapshot.collectedCrystalIds],
      [MOSSY_CAVERN_3_LEVEL.crystals[0]!.id],
      'the session owns a clone, not the caller array',
    );
    assert.notEqual(snapshot.collectedCrystalIds, crystalIds);
    session.dispose();
  });

  it('no save keeps the fresh-run defaults', () => {
    const snapshot = initialSnapshot(createDefaultMossyCavern3Save());
    assert.equal(snapshot.activeCheckpointId, null);
    assert.equal(snapshot.collectedCrystalIds.length, 0);
    assert.equal(snapshot.deaths, 0);
    const spawn = MOSSY_CAVERN_3_LEVEL.spawnBody;
    assert.equal(snapshot.player.x, spawn.x);
    assert.equal(snapshot.player.y, spawn.y);
  });
});

describe('T20F-R3 save loader fail-open', () => {
  it('a storage-unavailable environment yields no save instead of throwing', async () => {
    const { loadMossyCavern3Save } = await import('./mossyCavern3Save.ts');
    const save = await loadMossyCavern3Save();
    assert.equal(save, undefined, 'fail-open: the shell constructs a fresh run');
  });
});
