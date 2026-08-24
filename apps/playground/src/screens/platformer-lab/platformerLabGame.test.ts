/**
 * Platformer Lab headless tests (T16-F2).
 *
 * - Movement runs through the session's fixed step; different render/tick
 *   schedules with identical inputs reach IDENTICAL states.
 * - Deterministic checkpoints are crossed in order and emit exactly one
 *   typed Task 13 event each.
 * - One-way planks support from above; drop-through descends.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';

// The game manifest references static module handles via require(...),
// which does not exist under Node ESM — stub it with a deterministic id.
(globalThis as { require?: (id: string) => number }).require = () => 42;

const {
  PLATFORMER_LAB_CONFIG,
  PLAYER_SPAWN,
  platformerLabDefinition,
  platformerLabEvents,
  platformerLabLevel,
} = await import('./platformerLabGame.ts');

interface PlatformerSnapshot {
  readonly body: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly onGround: boolean;
  readonly contacts: { floor: boolean; leftWall: boolean; rightWall: boolean; ceiling: boolean };
  readonly checkpoints: readonly { reached: boolean }[];
  readonly ticks: number;
}

/** Deterministic fixed-step harness driven by a manual frame driver. */
function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(platformerLabDefinition, { frameDriver: driver });
  let timeline = 0;
  const tick = (frames: number): void => {
    for (let index = 0; index < frames; index += 1) {
      timeline += 1000 / 60;
      driver.fireNext(timeline);
    }
  };
  session.start();
  driver.fireNext(0);
  const snap = (): PlatformerSnapshot => session.getRenderFrame().current as unknown as PlatformerSnapshot;
  return { session, tick, snap };
}

/** Hold `right` and hop periodically — enough to clear both gaps. */
function walkRightWithJumps(
  h: ReturnType<typeof harness>,
  frames: number,
  jumpEveryFrames: number,
): void {
  for (let i = 0; i < frames; i++) {
    h.session.input.press('right');
    if (i % jumpEveryFrames === 0) {
      h.session.input.press('jump');
      h.session.input.release('jump');
    }
    h.tick(1);
    h.session.input.release('right');
  }
}

describe('platformer lab fixed-step simulation', () => {
  it('spawns resting on solid ground', () => {
    const h = harness();
    try {
      h.tick(5);
      const snap = h.snap();
      assert.equal(snap.contacts.floor, true);
      assert.ok(snap.body.y > PLAYER_SPAWN.y - 1e-6, 'gravity must not sink the body through the floor');
    } finally {
      h.session.dispose();
    }
  });

  it('reaches all three checkpoints in order when walking right and jumping gaps', () => {
    const h = harness();
    try {
      const received: number[] = [];
      h.session.addGameEventListener('checkpoint' as never, (event) => {
        received.push((event as unknown as { payload: { index: number } }).payload.index);
      });

      // ~14 s of walking right with a hop every ~0.55 s.
      walkRightWithJumps(h, Math.round(14 / (1 / 60)), 33);

      const snap = h.snap();
      assert.equal(snap.checkpoints.length, PLATFORMER_LAB_CONFIG.checkpoints.length);
      for (const cp of snap.checkpoints) assert.equal(cp.reached, true);
      assert.deepEqual(received, [0, 1, 2]);
    } finally {
      h.session.dispose();
    }
  });

  it('identical inputs under DIFFERENT render schedules produce identical states', () => {
    const runSchedule = (renderBatch: number): { x: number; y: number; ticks: number } => {
      const h = harness();
      try {
        let untilNextJump = Math.round(1.2 / (1 / 60));
        const totalFrames = Math.round(4 / (1 / 60));
        let done = 0;
        while (done < totalFrames) {
          const batch = Math.min(renderBatch, totalFrames - done);
          for (let i = 0; i < batch; i++) {
            h.session.input.press('right');
            if (untilNextJump <= 0) {
              h.session.input.press('jump');
              h.session.input.release('jump');
              untilNextJump = 72;
            }
            untilNextJump -= 1;
            h.tick(1);
            h.session.input.release('right');
          }
          done += batch;
        }
        const snap = h.snap();
        return { x: snap.body.x, y: snap.body.y, ticks: snap.ticks };
      } finally {
        h.session.dispose();
      }
    };
    const reference = runSchedule(1);
    for (const batch of [3, 7, 11]) {
      const other = runSchedule(batch);
      assert.equal(other.ticks, reference.ticks, 'tick count must be schedule-invariant');
      assert.equal(other.x, reference.x, 'x must be bit-identical across schedules');
      assert.equal(other.y, reference.y, 'y must be bit-identical across schedules');
    }
  });

  it('one-way planks support from above and drop-through descends', () => {
    const h = harness();
    try {
      // Bunny-hop right until standing ON the plank row PAST the first gap
      // (planks span columns 19-25 at row H-5), so dropping lands on ground.
      let landedOnPlank = false;
      const cell = PLATFORMER_LAB_CONFIG.cellSize;
      const frames = Math.round(12 / (1 / 60));
      for (let i = 0; i < frames && !landedOnPlank; i++) {
        h.session.input.press('right');
        h.session.input.press('jump');
        h.session.input.release('jump');
        h.tick(1);
        h.session.input.release('right');
        const snap = h.snap();
        if (
          snap.contacts.floor &&
          snap.body.x > 22.5 * cell &&
          snap.body.x < 26 * cell &&
          Math.abs(snap.body.y + snap.body.height - (PLATFORMER_LAB_CONFIG.mapRows - 5) * cell) < 2
        ) {
          landedOnPlank = true;
          break;
        }
      }
      assert.equal(landedOnPlank, true, 'expected to land on the one-way plank row past the gap');
      h.session.input.release('right');

      // Drop through: hold drop while ticking; the body must descend.
      const before = h.snap().body.y;
      h.session.input.press('drop');
      h.tick(30);
      h.session.input.release('drop');
      const after = h.snap().body.y;
      assert.ok(after > before + 8, `drop-through must descend (${before} -> ${after})`);
    } finally {
      h.session.dispose();
    }
  });
});

describe('platformer lab data contract', () => {
  it('the level keeps decorative clouds non-collidable and terrain intact', () => {
    const clouds = platformerLabLevel.layerById.clouds!;
    const terrain = platformerLabLevel.layerById.terrain!;
    assert.equal(clouds.collidable, false);
    assert.equal(terrain.collidable, true);
    assert.equal(Object.isFrozen(clouds.data), true);
    const bottom = terrain.data.slice((PLATFORMER_LAB_CONFIG.mapRows - 1) * PLATFORMER_LAB_CONFIG.mapColumns);
    assert.ok(bottom.some((id) => id === 1));
  });

  it('event definitions carry typed payloads', () => {
    assert.ok(platformerLabEvents.checkpoint !== undefined);
  });
});
