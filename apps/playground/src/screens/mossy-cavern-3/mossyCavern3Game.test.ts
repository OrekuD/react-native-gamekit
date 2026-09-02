import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';

import {
  mossyCavern3Definition,
  type MossyCavern3Session,
} from './mossyCavern3Game.ts';

const STEP_MS = 1000 / 60;

function createHarness(): {
  readonly driver: ManualFrameDriver;
  readonly session: MossyCavern3Session;
} {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(mossyCavern3Definition, {
    fixedStepMs: STEP_MS,
    frameDriver: driver,
  });
  session.start();
  driver.fireNext(0);
  return { driver, session };
}

function advance(driver: ManualFrameDriver, frames: number, fromFrame = 0): void {
  for (let index = 1; index <= frames; index += 1) {
    driver.fireNext((fromFrame + index) * STEP_MS);
  }
}

test('definition exposes a wide game world and semantic button actions', () => {
  assert.deepEqual(mossyCavern3Definition.viewport.logicalSize, { width: 1280, height: 720 });
  assert.deepEqual(Object.keys(mossyCavern3Definition.input), [
    'left',
    'right',
    'jump',
    'dash',
    'down',
    'restart',
  ]);
});

test('button edges drive fixed-step movement and committed events once', () => {
  const { driver, session } = createHarness();
  const eventNames: string[] = [];
  session.addGameEventListener('dashed', (event) => {
    eventNames.push(event.name);
  });
  const before = session.getRenderFrame();
  assert.equal(before.scene, 'play');
  const startX = before.current.player.x;

  session.input.press('right');
  session.input.press('dash');
  advance(driver, 1);
  session.input.release('dash');
  advance(driver, 5, 1);

  const after = session.getRenderFrame();
  assert.equal(after.scene, 'play');
  assert.ok(after.current.player.x > startX);
  assert.deepEqual(eventNames, ['dashed']);
  session.dispose();
});

test('pause advances neither ticks nor event delivery', () => {
  const { driver, session } = createHarness();
  advance(driver, 2);
  const tick = session.getRenderFrame().tick;

  session.pause();

  assert.equal(session.getRenderFrame().tick, tick);
  assert.equal(driver.pendingCount, 0);
  session.dispose();
});

test('snapshot carries presentation state but not tilemap geometry', () => {
  const { session } = createHarness();
  const frame = session.getRenderFrame();
  assert.equal(frame.scene, 'play');
  assert.equal('map' in frame.current, false);
  assert.equal('collisionLayers' in frame.current, false);
  assert.equal(typeof frame.current.camera.center.x, 'number');
  assert.equal(typeof frame.current.effectSequence, 'number');
  session.dispose();
});
