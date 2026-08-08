import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hudEqual, selectHud } from './brickBreakerHud.ts';
import { brickBreakerDefinition } from '../games/brickBreakerGame.ts';
import { createGameSessionWithDriver, ManualFrameDriver } from 'react-native-gamekit/testing';

function makePlayFrame(score: number): Parameters<typeof selectHud>[0] {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(brickBreakerDefinition, {
    frameDriver: driver,
    fixedStepMs: 10,
  });
  session.start();
  driver.fireNext(0);
  driver.fireNext(10);
  if (session.scene === 'ready') {
    session.input.begin('primary', 1, { x: 160, y: 90 });
  }
  driver.fireNext(20);
  const frame = session.getRenderFrame();
  if (frame.scene !== 'play') {
    throw new Error(`expected play scene, got ${frame.scene}`);
  }
  // Rebuild a play frame with the requested score to isolate the selector.
  return {
    scene: 'play',
    previous: frame.previous,
    current: { ...frame.current, score },
    tick: frame.tick,
    elapsedSeconds: frame.elapsedSeconds,
    revision: frame.revision,
    hardCut: frame.hardCut,
    stepMs: frame.stepMs,
  };
}

describe('brick breaker HUD selection (feedback)', () => {
  it('treats unchanged HUD values as equal even though selectHud returns fresh objects', () => {
    const first = selectHud(makePlayFrame(7));
    const second = selectHud(makePlayFrame(7));
    assert.notEqual(first, second, 'selectHud returns a fresh object each call');
    assert.equal(
      hudEqual(first, second),
      true,
      'identical scene/score/prompt must not trigger another render',
    );
  });

  it('reports a change when the score changes', () => {
    const before = selectHud(makePlayFrame(7));
    const after = selectHud(makePlayFrame(8));
    assert.equal(hudEqual(before, after), false);
  });

  it('reports a change when the scene or prompt changes', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(brickBreakerDefinition, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);
    const ready = selectHud(session.getRenderFrame());
    assert.equal(ready.scene, 'ready');
    assert.equal(ready.prompt, 'Tap to start');
    assert.equal(hudEqual(ready, selectHud(makePlayFrame(0))), false);
  });
});
