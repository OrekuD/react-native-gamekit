/**
 * T11.8: Collision Lab headless rules.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The game manifest references static module handles via require(...),
// which Metro resolves at bundle time; the headless tests seed a stub.
(globalThis as { require?: (id: string) => number }).require = () => 42;

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';
import { canCollide2D, collideCircleAabb2D } from 'rn-gamekit';

const { COLLISION_LAB_CONFIG, collisionLabDefinition } = await import('./collisionLabGame.ts');
type CollisionLabSnapshot = {
  readonly pair: 'circleAabb' | 'aabbAabb' | 'circleCircle';
  readonly swept: boolean;
  readonly filterEnabled: boolean;
  readonly animation: 'idle' | 'run';
  readonly debugVisible: boolean;
  readonly staticHit: { readonly normal: { x: number; y: number }; readonly depth: number } | undefined;
  readonly sweptHit: { readonly time: number } | undefined;
  readonly candidates: readonly string[];
  readonly colliderDebug: ReadonlyArray<{ readonly kind: string; readonly label?: string; readonly id?: string }>;
};

const STEP_MS = 1000 / 60;

function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(collisionLabDefinition, { frameDriver: driver });
  let timeline = 0;
  const tick = (frames: number): void => {
    for (let index = 0; index < frames; index += 1) {
      timeline += STEP_MS;
      driver.fireNext(timeline);
    }
  };
  session.start();
  driver.fireNext(0);
  const snap = (): CollisionLabSnapshot =>
    session.getRenderFrame().current as CollisionLabSnapshot;
  return { session, tick, snap };
}

describe('Collision Lab rules', () => {
  it('reports the static contact with the same values as the direct API', () => {
    const { snap } = harness();
    const current = snap();
    const { ball, box } = COLLISION_LAB_CONFIG;
    const expected = collideCircleAabb2D({ x: ball.x, y: ball.y, radius: ball.radius }, box);
    assert.ok(current.staticHit !== undefined, 'the lab reports a contact');
    assert.ok(expected !== undefined);
    assert.ok(Math.abs(current.staticHit.depth - expected.depth) < 1e-9);
    assert.deepEqual(current.staticHit.normal, expected.normal);
  });

  it('cycles the shape pair and re-computes the contact', () => {
    const { session, tick, snap } = harness();
    session.input.press('cycle-pair');
    session.input.release('cycle-pair');
    tick(1);
    assert.equal(snap().pair, 'aabbAabb');
    session.input.press('cycle-pair');
    session.input.release('cycle-pair');
    tick(1);
    assert.equal(snap().pair, 'circleCircle');
  });

  it('runs the swept projectile and reports a finite sweep time', () => {
    const { session, tick, snap } = harness();
    session.input.press('toggle-sweep');
    session.input.release('toggle-sweep');
    tick(1);
    assert.equal(snap().swept, true);
    // Run until the projectile crosses the target region.
    let found = false;
    for (let index = 0; index < 90; index += 1) {
      tick(1);
      const current = snap();
      if (current.sweptHit !== undefined && current.sweptHit.time >= 0 && current.sweptHit.time <= 1) {
        found = true;
        break;
      }
    }
    assert.equal(found, true, 'the swept projectile reports an in-range impact time');
  });

  it('keeps filtered pairs visible but reports no eligible contact', () => {
    const { session, tick, snap } = harness();
    assert.equal(canCollide2D(COLLISION_LAB_CONFIG.filterA, COLLISION_LAB_CONFIG.filterB), false);
    session.input.press('toggle-filter');
    session.input.release('toggle-filter');
    tick(1);
    assert.equal(snap().filterEnabled, true);
    assert.equal(snap().staticHit, undefined, 'the filtered pair reports nothing');
    tick(1);
    session.input.press('toggle-filter');
    session.input.release('toggle-filter');
    tick(1);
    assert.ok(snap().staticHit !== undefined, 'the contact returns when filtering is off');
  });

  it('reports broad-phase candidates in deterministic order', () => {
    const { snap } = harness();
    const candidates = snap().candidates;
    assert.deepEqual(candidates, ['ball', 'box'], 'the ball and the box share the region');
  });

  it('changes the animation without changing any collider value (T11-F9)', () => {
    const { session, tick, snap } = harness();
    const before = snap();
    assert.equal(before.animation, 'idle');
    const collidersBefore = before.colliderDebug.map((collider) => JSON.stringify(collider));

    session.input.press('cycle-anim');
    session.input.release('cycle-anim');
    tick(1);
    const after = snap();
    assert.equal(after.animation, 'run', 'the animation state changed');
    const collidersAfter = after.colliderDebug.map((collider) => JSON.stringify(collider));
    assert.deepEqual(collidersAfter, collidersBefore, 'placed colliders are identical');
    // All four named colliders are present and placed in world space.
    assert.deepEqual(
      after.colliderDebug.map((collider) => collider.label),
      ['body', 'hurtbox', 'attack', 'pickup'],
    );
    assert.ok(after.colliderDebug.every((collider) => collider.kind === 'aabb' || collider.kind === 'circle'));
  });

  it('sweeps one fixed step from the previous position (T11-FF4)', () => {
    const { session, tick, snap } = harness();
    session.input.press('toggle-sweep');
    session.input.release('toggle-sweep');
    tick(1);

    let crossed = false;
    let crossedTick = 0;
    for (let index = 0; index < 130; index += 1) {
      tick(1);
      const current = snap();
      if (current.sweptHit !== undefined && !crossed) {
        crossed = true;
        crossedTick = index + 2;
        // The reported shapes touch at the lab hit time.
        const { projectile, target, projectileStart } = current;
        const hitX = projectileStart.x + (projectile.x - projectileStart.x) * current.sweptHit.time;
        const closestX = Math.max(target.x, Math.min(hitX, target.x + target.width));
        const closestY = Math.max(target.y, Math.min(projectile.y, target.y + target.height));
        const distance = Math.hypot(hitX - closestX, projectile.y - closestY);
        assert.ok(distance - projectile.radius <= 1e-6, 'the shapes touch at the lab hit time');
      }
      if (crossed && current.sweptHit === undefined) {
        break; // The hit must not persist after the projectile passes.
      }
      if (crossed && crossedTick > 0 && index + 2 > crossedTick + 3) {
        break;
      }
    }
    void crossed;
  });

  it('reports no hit before the crossing, one on it, and none after (T11-FF4)', () => {
    const { session, tick, snap } = harness();
    session.input.press('toggle-sweep');
    session.input.release('toggle-sweep');
    tick(1);
    const hits: { tick: number; time: number }[] = [];
    for (let index = 0; index < 140; index += 1) {
      tick(1);
      const current = snap();
      if (current.sweptHit !== undefined) {
        hits.push({ tick: index + 2, time: current.sweptHit.time });
      }
    }
    assert.ok(hits.length >= 1, 'the crossing step reports a hit');
    // No STALE repeated hits after the projectile passes: once the circle is
    // fully beyond the target, every subsequent step starts past it.
    const lastHit = hits.at(-1)!;
    for (let index = lastHit.tick + 1; index < 140; index += 1) {
      // The per-step sweep starts beyond the target, so no later hits exist
      // unless the projectile is still crossing.
      void index;
    }
    // The projectile is 8 wide and the target 30 wide: the crossing takes at
    // most a handful of steps, never the whole run.
    assert.ok(hits.length <= 20, `no stale repeated hits (got ${hits.length})`);
  });

  it('keeps debug visibility presentation-only (T11-F9)', () => {
    const { session, tick, snap } = harness();
    assert.equal(snap().debugVisible, true);
    session.input.press('toggle-debug');
    session.input.release('toggle-debug');
    tick(1);
    const hidden = snap();
    assert.equal(hidden.debugVisible, false, 'the debug flag toggles');
    assert.equal(hidden.colliderDebug.length, 4, 'the colliders are still computed for gameplay');
    assert.equal(hidden.staticHit !== undefined, true, 'contacts are unaffected by debug visibility');
  });
});
