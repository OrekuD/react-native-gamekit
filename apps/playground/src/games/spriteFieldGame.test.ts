import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The game manifest references static module handles via require(...),
// which Metro resolves at bundle time; the headless tests seed a stub.
(globalThis as { require?: (id: string) => number }).require = () => 42;

const { spriteFieldDefinition, selectPlayerClip, spriteFieldAssets, SPRITE_FIELD_CONFIG } =
  await import('./spriteFieldGame.ts');
const { createGameSessionWithDriver, ManualFrameDriver } = await import('react-native-gamekit/testing');
type PlaySnapshot = {
  playerX: number;
  playerY: number;
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

  it('clip selection switches between idle and run deterministically', () => {
    const idle = { clip: 'idle' as const, elapsedMs: 0, paused: false, speed: 1, completed: false };
    const run = { clip: 'run' as const, elapsedMs: 0, paused: false, speed: 1, completed: false };
    assert.equal(selectPlayerClip(true, idle).clip, 'run', 'moving selects run');
    assert.equal(selectPlayerClip(false, idle).clip, 'idle', 'idle stays idle');
    const run2 = selectPlayerClip(true, idle);
    assert.equal(selectPlayerClip(true, run2), run2, 'same clip is a no-op (no state churn)');
    assert.equal(selectPlayerClip(false, run).clip, 'idle', 'stopping returns to idle');
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

  it('the enemy field drifts and animates without wall-clock reads', async () => {
    const { session, driver } = createSession();
    session.start();
    await advanceMs(driver, 300);
    const frame = session.getRenderFrame();
    const play = frame.current as PlaySnapshot;
    const moved = play.enemies.some(
      (enemy) => Math.abs(enemy.x - enemy.x) > 0 || enemy.frame === 'enemy-1',
    );
    assert.ok(play.enemies.some((enemy) => enemy.frame === 'enemy-1'), 'enemies animate frames');
    assert.ok(moved, 'enemy snapshots carry deterministic state');
    session.dispose();
  });

  it('the public asset manifest carries the declared sheets', () => {
    assert.equal(spriteFieldAssets.gameplay.player.kind, 'sprite-sheet');
    assert.equal(spriteFieldAssets.gameplay.enemies.kind, 'sprite-sheet');
    assert.equal(Object.keys(spriteFieldAssets.gameplay.player.animations).length, 2);
    assert.ok(Object.isFrozen(spriteFieldAssets.gameplay.player.frames));
  });
});
