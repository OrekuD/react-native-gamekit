import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';

// Metro resolves static image handles in the native bundle. Headless game-rule
// tests only need stable numeric handles so the definition can be imported.
(globalThis as { require?: (id: string) => number }).require = () => 42;

const {
  MOSSY_CAVERN_2_CONFIG,
  mossyCavern2Definition,
} = await import('./mossyCavern2Game.ts');

type MossyCavern2Snapshot = {
  readonly player: {
    readonly body: { readonly x: number; readonly y: number };
    readonly onGround: boolean;
    readonly dashRemaining: number;
  };
  readonly slimes: readonly { readonly id: string; readonly alive: boolean }[];
  readonly relics: readonly { readonly id: string; readonly collected: boolean }[];
  readonly camera: { readonly center: { readonly x: number; readonly y: number } };
  readonly status: 'exploring' | 'complete';
};

function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(mossyCavern2Definition, {
    frameDriver: driver,
  });
  let timeline = 0;
  const tick = (frames = 1): void => {
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
    snap: (): MossyCavern2Snapshot =>
      session.getRenderFrame().current as MossyCavern2Snapshot,
  };
}

describe('Mossy Cavern 2 gameplay', () => {
  it('is a distinct portrait platformer with semantic touch actions', () => {
    assert.deepEqual(mossyCavern2Definition.viewport.logicalSize, {
      width: MOSSY_CAVERN_2_CONFIG.logicalWidth,
      height: MOSSY_CAVERN_2_CONFIG.logicalHeight,
    });
    assert.deepEqual(Object.keys(mossyCavern2Definition.input), [
      'left',
      'right',
      'jump',
      'dash',
    ]);
    assert.equal(mossyCavern2Definition.initialScene, 'expedition');
  });

  it('accepts a jump edge from the headless input buffer', () => {
    const { session, snap, tick } = harness();
    assert.equal(snap().player.onGround, true);
    session.input.press('jump');
    session.input.release('jump');
    tick();
    assert.ok(snap().player.body.y < MOSSY_CAVERN_2_CONFIG.spawn.y);
    session.dispose();
  });

  it('uses a dash to defeat the first slime through collision detection', () => {
    const { session, snap, tick } = harness();
    const names: string[] = [];
    const events = session.addGameEventListener('slime-cleared', (event) => {
      names.push(event.payload.id);
    });

    session.input.press('right');
    session.input.press('dash');
    session.input.release('dash');
    tick(12);

    assert.ok(snap().player.dashRemaining >= 0);
    assert.equal(
      snap().slimes.find((slime) => slime.id === 'root-slime')?.alive,
      false,
    );
    assert.deepEqual(names, ['root-slime']);
    events.remove();
    session.dispose();
  });

  it('collects the opening relic and keeps the follow camera in world bounds', () => {
    const { session, snap, tick } = harness();
    session.input.press('right');
    tick(90);
    session.input.release('right');
    tick();

    assert.equal(
      snap().relics.find((relic) => relic.id === 'dew-relic')?.collected,
      true,
    );
    assert.ok(snap().camera.center.x >= MOSSY_CAVERN_2_CONFIG.logicalWidth / 2);
    assert.ok(snap().camera.center.y >= MOSSY_CAVERN_2_CONFIG.logicalHeight / 2);
    session.dispose();
  });
});
