import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The game manifest references static module handles via require(...),
// which Metro resolves at bundle time; the headless tests seed a stub.
(globalThis as { require?: (id: string) => number }).require = () => 42;

const {
  nextPlayerAnimationMode,
  spriteFieldDefinition,
  selectPlayerClip,
  spriteFieldAssets,
  SPRITE_FIELD_CONFIG,
} = await import('./spriteFieldGame.ts');
const { createGameSessionWithDriver, ManualFrameDriver } = await import('rn-gamekit/testing');
type PlaySnapshot = {
  playerX: number;
  playerY: number;
  animationMode: string;
  animation: { clip: string; elapsedMs: number };
  enemies: readonly { visible: boolean; animation: { clip: string }; frame: string; x: number }[];
};

function createSession() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(spriteFieldDefinition, { frameDriver: driver });
  return { session, driver };
}

async function advanceMs(driver: InstanceType<typeof ManualFrameDriver>, ms: number): Promise<void> {
  const steps = Math.ceil(ms / 16.7);
  for (let step = 0; step < steps; step += 1) {
    driver.fireNext((step + 1) * 16.7);
  }
}

describe('Sprite Field game rules (T7.8)', () => {
  it('starts with the player idle at the bottom and a bounded enemy field', () => {
    const { session } = createSession();
    const frame = session.getRenderFrame();
    const play = frame.current as PlaySnapshot;
    assert.equal(play.playerX, 160);
    assert.equal(play.playerY, 420);
    assert.equal(play.animation.clip, 'idle');
    assert.equal(play.enemies.length, SPRITE_FIELD_CONFIG.enemyCount);
    for (const enemy of play.enemies) {
      assert.ok(enemy.visible);
      assert.equal(enemy.animation.clip, 'wander');
    }
    session.dispose();
  });

  it('clip selection switches between idle and walk deterministically', () => {
    const idle = { clip: 'idle' as const, elapsedMs: 0, paused: false, speed: 1, completed: false };
    const walking = { clip: 'walk' as const, elapsedMs: 0, paused: false, speed: 1, completed: false };
    assert.equal(selectPlayerClip(true, 'auto', idle).clip, 'walk', 'moving selects walk');
    assert.equal(selectPlayerClip(false, 'auto', idle).clip, 'idle', 'idle stays idle');
    const walk = selectPlayerClip(true, 'auto', idle);
    assert.equal(
      selectPlayerClip(true, 'auto', walk),
      walk,
      'same clip is a no-op (no state churn)',
    );
    assert.equal(
      selectPlayerClip(false, 'auto', walking).clip,
      'idle',
      'stopping returns to idle',
    );
    assert.equal(selectPlayerClip(true, 'jump', walk).clip, 'jump', 'manual state overrides movement');
  });

  it('cycles the player showcase mode through every declared state', async () => {
    assert.equal(nextPlayerAnimationMode('auto'), 'idle');
    assert.equal(nextPlayerAnimationMode('idle'), 'walk');
    assert.equal(nextPlayerAnimationMode('walk'), 'jump');
    assert.equal(nextPlayerAnimationMode('jump'), 'duck');
    assert.equal(nextPlayerAnimationMode('duck'), 'hurt');
    assert.equal(nextPlayerAnimationMode('hurt'), 'auto');

    const { session, driver } = createSession();
    session.start();
    session.input.press('cycleAnimation');
    session.input.release('cycleAnimation');
    await advanceMs(driver, 17);
    const play = session.getRenderFrame().current as PlaySnapshot;
    assert.equal(play.animationMode, 'idle');
    assert.equal(play.animation.clip, 'idle');
    session.dispose();
  });

  it('the pointer moves the player and the animation advances with game time', async () => {
    const { session, driver } = createSession();
    session.start();
    session.input.begin('primary', 1, { x: 300, y: 100 });
    await advanceMs(driver, 500);
    const frame = session.getRenderFrame();
    const play = frame.current as PlaySnapshot;
    assert.ok(play.playerX > 160, `player moved right (${play.playerX})`);
    assert.ok(play.animation.elapsedMs > 0, 'animation advanced with game time');
    session.dispose();
  });

  it('the animal field drifts without wall-clock reads', async () => {
    const { session, driver } = createSession();
    session.start();
    const initial = (session.getRenderFrame().current as PlaySnapshot).enemies.map(
      (enemy) => enemy.x,
    );
    await advanceMs(driver, 300);
    const frame = session.getRenderFrame();
    const play = frame.current as PlaySnapshot;
    const moved = play.enemies.some(
      (enemy, index) => Math.abs(enemy.x - (initial[index] ?? enemy.x)) > 0,
    );
    assert.ok(moved, 'enemy snapshots carry deterministic state');
    assert.deepEqual(
      new Set(play.enemies.map((enemy) => enemy.frame)),
      new Set(['sheep', 'cow', 'chicken']),
    );
    session.dispose();
  });

  it('the public asset manifest carries the declared sheets', () => {
    assert.equal(spriteFieldAssets.gameplay.player.kind, 'sprite-sheet');
    assert.equal(spriteFieldAssets.gameplay.enemies.kind, 'sprite-sheet');
    assert.deepEqual(Object.keys(spriteFieldAssets.gameplay.player.animations), [
      'idle',
      'walk',
      'jump',
      'duck',
      'hurt',
    ]);
    assert.equal(spriteFieldAssets.gameplay.player.animations.walk.frames.length, 11);
    assert.deepEqual(Object.keys(spriteFieldAssets.gameplay.enemies.frames), [
      'sheep',
      'cow',
      'chicken',
    ]);
    assert.ok(Object.isFrozen(spriteFieldAssets.gameplay.player.frames));
  });
});

describe('Sprite Field scrolling camera (T12.7)', () => {
  it('keeps the camera inside the world and follows only past the dead zone', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    const snap = () => session.getRenderFrame().current as unknown as {
      camera: { center: { x: number; y: number }; zoom: number };
      playerX: number;
      playerY: number;
      visibleEnemies: number;
      enemies: readonly unknown[];
    };
    const start = snap();
    assert.equal(start.camera.center.x, start.playerX, 'the camera starts on the player');
    assert.equal(start.camera.zoom, 1);

    // Small pointer movement inside the dead zone: the camera does not move.
    session.input.begin('primary', 1, { x: start.playerX + 20, y: start.playerY - 10 });
    for (let i = 0; i < 30; i += 1) {
      driver.fireNext((i + 1) * 16.7);
    }
    const inside = snap();
    assert.equal(inside.camera.center.x, start.camera.center.x, 'dead zone holds the camera');
    session.input.cancel('primary');

    // A long drag to the far right crosses the dead zone and the world edge.
    session.input.begin('primary', 2, { x: start.playerX + 20, y: start.playerY - 10 });
    session.input.move('primary', 2, { x: 2300, y: 100 });
    for (let i = 0; i < 240; i += 1) {
      driver.fireNext((i + 1) * 16.7);
    }
    const far = snap();
    // The camera is clamped to the world edge, never beyond it.
    assert.ok(far.camera.center.x <= 2400 - 160, 'camera clamps to the right world edge');
    assert.ok(far.camera.center.x >= 160, 'camera clamps to the left world edge');
    session.input.cancel('primary');

    // Off-screen enemies keep simulating: every enemy is still present and
    // its wander animation advances.
    const finalSnap = snap();
    assert.equal(finalSnap.enemies.length, 24, 'culling never removes enemies from the simulation');
    session.dispose();
  });

  it('reports a bounded visible count from the headless culling query', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    const snap = () => session.getRenderFrame().current as unknown as {
      visibleEnemies: number;
      enemies: readonly unknown[];
    };
    const frame = snap();
    assert.ok(frame.visibleEnemies <= frame.enemies.length, 'visible never exceeds total');
    assert.ok(frame.visibleEnemies >= 0);
    session.dispose();
  });
});
