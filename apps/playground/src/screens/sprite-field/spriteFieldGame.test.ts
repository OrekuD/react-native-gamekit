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
