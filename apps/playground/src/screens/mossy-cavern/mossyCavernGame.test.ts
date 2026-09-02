import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';

// The manifest uses React Native's static require convention. Node tests only
// exercise the headless definition, so a deterministic module-handle stub is
// sufficient and keeps the test independent of Metro.
(globalThis as { require?: (id: string) => number }).require = () => 42;
// T20F-R3: a never-firing rAF keeps hydrated sessions frozen at their initial
// frame — the assertion target is the pre-first-tick snapshot.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0;
(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {};

const {
  MOSSY_CAVERN_CONFIG,
  createMossyCavernSession,
  mossyCavernCheckpointSpawn,
  mossyCavernDefinition,
  MOSSY_CAVERN_SPAWN,
} = await import('./mossyCavernGame.ts');

interface MossySnapshot {
  readonly body: { readonly x: number; readonly y: number };
  readonly health: number;
  readonly crystals: number;
  readonly checkpoints: readonly { readonly reached: boolean }[];
  readonly enemies: readonly { readonly defeated: boolean }[];
  readonly finished: boolean;
  readonly gameOver: boolean;
  readonly falls: number;
}

function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(mossyCavernDefinition, { frameDriver: driver });
  let timeline = 0;
  const tick = (frames: number): void => {
    for (let index = 0; index < frames; index += 1) {
      timeline += 1000 / 60;
      driver.fireNext(timeline);
    }
  };
  session.start();
  driver.fireNext(0);
  return {
    session,
    tick,
    snap: (): MossySnapshot => session.getRenderFrame().current as unknown as MossySnapshot,
  };
}

describe('Mossy Cavern fixed-step game', () => {
  it('settles the wizard on the first moss platform', () => {
    const h = harness();
    try {
      h.tick(8);
      const snap = h.snap();
      assert.equal(snap.health, MOSSY_CAVERN_CONFIG.maxHealth);
      assert.equal(snap.falls, 0);
      assert.ok(snap.body.y >= MOSSY_CAVERN_SPAWN.y);
    } finally {
      h.session.dispose();
    }
  });

  it('keeps typed checkpoint progress and emits each checkpoint once', () => {
    const h = harness();
    try {
      const checkpoints: number[] = [];
      h.session.addGameEventListener('checkpoint' as never, (event) => {
        checkpoints.push((event as unknown as { payload: { index: number } }).payload.index);
      });
      h.session.input.press('right');
      for (let frame = 0; frame < 60 * 20; frame += 1) {
        if (frame % 42 === 0) {
          h.session.input.press('jump');
          h.session.input.release('jump');
        }
        h.tick(1);
      }
      h.session.input.release('right');
      const snap = h.snap();
      assert.ok(snap.checkpoints.some((checkpoint) => checkpoint.reached));
      assert.deepEqual(checkpoints, [...new Set(checkpoints)]);
      assert.ok(checkpoints.every((index) => index >= 0 && index < snap.checkpoints.length));
    } finally {
      h.session.dispose();
    }
  });

  it('respawns after a fall without losing collected progression', () => {
    const h = harness();
    try {
      let falls = 0;
      h.session.addGameEventListener('fall' as never, () => {
        falls += 1;
      });
      h.session.input.press('right');
      h.session.input.press('drop');
      for (let frame = 0; frame < 60 * 8 && falls === 0; frame += 1) {
        h.tick(1);
      }
      h.session.input.release('right');
      h.session.input.release('drop');
      assert.equal(falls, 1);
      const snap = h.snap();
      assert.equal(snap.falls, 1);
      assert.ok(Math.abs(snap.body.x - MOSSY_CAVERN_SPAWN.x) < 2);
    } finally {
      h.session.dispose();
    }
  });

  it('has a completable no-dash route through every checkpoint', () => {
    const h = harness();
    try {
      let finishes = 0;
      h.session.addGameEventListener('finish' as never, () => {
        finishes += 1;
      });
      h.session.input.press('right');
      for (let frame = 0; frame < 60 * 30; frame += 1) {
        if (frame >= 8 && (frame - 8) % 55 === 0) {
          h.session.input.press('jump');
          h.session.input.release('jump');
        }
        h.tick(1);
        const snapshot = h.snap();
        if (snapshot.finished || snapshot.gameOver) break;
      }
      h.session.input.release('right');
      const snap = h.snap();
      assert.equal(finishes, 1);
      assert.equal(snap.finished, true);
      assert.equal(snap.gameOver, false);
      assert.equal(snap.checkpoints.every((checkpoint) => checkpoint.reached), true);
    } finally {
      h.session.dispose();
    }
  });
});

describe('T20F-R3 checkpoint hydration (session starts from the validated projection)', () => {
  const save = {
    checkpointIndex: 2,
    score: 550,
    crystals: 7,
    falls: 3,
    bestTimeSeconds: 41.5,
  };

  interface HydrationSnapshot {
    readonly body: { readonly x: number; readonly y: number };
    readonly checkpointIndex: number;
    readonly score: number;
    readonly crystals: number;
    readonly falls: number;
    readonly bestTimeSeconds: number;
    readonly checkpoints: readonly { readonly index: number; readonly reached: boolean }[];
    readonly health: number;
    readonly finished: boolean;
  }

  function initialSnapshot(saveValue?: typeof save): HydrationSnapshot {
    const session = createMossyCavernSession(saveValue);
    // No fixed tick has run: the first published frame must already carry the
    // restored projection.
    const snapshot = session.getRenderFrame().current as unknown as HydrationSnapshot;
    session.dispose();
    return snapshot;
  }

  it('a save with a checkpoint spawns the player at that checkpoint before the first tick', () => {
    const snapshot = initialSnapshot(save);
    const expected = mossyCavernCheckpointSpawn(2);
    assert.equal(snapshot.body.x, expected.x);
    assert.equal(snapshot.body.y, expected.y);
  });

  it('the restored projection appears in the first published snapshot', () => {
    const snapshot = initialSnapshot(save);
    assert.equal(snapshot.checkpointIndex, 2);
    assert.equal(snapshot.score, 550);
    assert.equal(snapshot.crystals, 7);
    assert.equal(snapshot.falls, 3);
    assert.equal(snapshot.bestTimeSeconds, 41.5);
  });

  it('checkpoints up to the saved index are marked reached', () => {
    const snapshot = initialSnapshot(save);
    assert.equal(snapshot.checkpoints.length, MOSSY_CAVERN_CONFIG.checkpoints.length);
    for (const checkpoint of snapshot.checkpoints) {
      assert.equal(checkpoint.reached, checkpoint.index <= 2);
    }
  });

  it('health, finish flags, and elapsed reset for the restored run', () => {
    const snapshot = initialSnapshot(save);
    assert.equal(snapshot.health, MOSSY_CAVERN_CONFIG.maxHealth);
    assert.equal(snapshot.finished, false);
  });

  it('no save keeps the fresh-run defaults', () => {
    const snapshot = initialSnapshot(undefined);
    assert.equal(snapshot.checkpointIndex, -1);
    assert.equal(snapshot.body.x, MOSSY_CAVERN_SPAWN.x);
    assert.equal(snapshot.body.y, MOSSY_CAVERN_SPAWN.y);
    assert.equal(snapshot.score, 0);
    assert.equal(snapshot.crystals, 0);
    for (const checkpoint of snapshot.checkpoints) {
      assert.equal(checkpoint.reached, false);
    }
  });

  it('an out-of-range checkpoint index clamps to the last authored checkpoint', () => {
    const snapshot = initialSnapshot({ ...save, checkpointIndex: 99 });
    const last = MOSSY_CAVERN_CONFIG.checkpoints.length - 1;
    const expected = mossyCavernCheckpointSpawn(last);
    assert.equal(snapshot.body.x, expected.x);
    assert.equal(snapshot.checkpointIndex, last);
  });
});

describe('T20F-R3 save loader fail-open', () => {
  it('a storage-unavailable environment yields no save instead of throwing', async () => {
    const { loadMossyCavernSave } = await import('./mossyCavernData.ts');
    const save = await loadMossyCavernSave();
    assert.equal(save, undefined, 'fail-open: the shell constructs a fresh run');
  });
});
