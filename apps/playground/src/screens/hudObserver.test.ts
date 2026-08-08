import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BrickBreakerRenderFrame } from '../games/brickBreakerGame.ts';
import { hudEqual, selectHud, type HudState } from './brickBreakerHud.ts';
import { createHudObserver } from './hudObserver.ts';

function makePlayFrame(score: number, prompt = 'Drag to move the paddle'): BrickBreakerRenderFrame {
  return {
    scene: 'play',
    previous: { paddle: { x: 160 }, ball: { x: 160, y: 90 }, bricks: [], score, prompt },
    current: { paddle: { x: 160 }, ball: { x: 160, y: 90 }, bricks: [], score, prompt },
    tick: 1,
    elapsedSeconds: 0.016,
    revision: score + 1,
    hardCut: false,
    stepMs: 10,
  } as never;
}

describe('T9: HUD observer at commit frequency', () => {
  it('unchanged commits run the selector but request zero state updates', () => {
    const frame = makePlayFrame(7);
    let selectorCalls = 0;
    const observer = createHudObserver<BrickBreakerRenderFrame, HudState>(
      (input) => {
        selectorCalls += 1;
        return selectHud(input);
      },
      hudEqual,
      selectHud(makePlayFrame(7)),
    );
    for (let index = 0; index < 10; index += 1) {
      const changed = observer.observe(frame);
      assert.equal(changed, false, 'an equal commit must not request a state update');
    }
    assert.equal(selectorCalls, 10, 'the selector still runs per commit to detect changes');
    assert.equal(observer.value.score, 7, 'the value stays on the last accepted selection');
  });

  it('a changed commit requests exactly one state update', () => {
    const observer = createHudObserver<BrickBreakerRenderFrame, HudState>(
      selectHud,
      hudEqual,
      selectHud(makePlayFrame(0)),
    );
    assert.equal(observer.observe(makePlayFrame(0)), false);
    assert.equal(observer.observe(makePlayFrame(7)), true, 'score change requests an update');
    assert.equal(observer.value.score, 7);
    assert.equal(observer.observe(makePlayFrame(7)), false, 'same score again stays quiet');
    assert.equal(observer.observe(makePlayFrame(8)), true, 'the next score change updates again');
    assert.equal(observer.value.score, 8);
  });

  it('prompt and scene changes are treated as HUD value changes', () => {
    const observer = createHudObserver<BrickBreakerRenderFrame, HudState>(
      selectHud,
      hudEqual,
      selectHud(makePlayFrame(0, 'Drag to move the paddle')),
    );
    assert.equal(observer.observe(makePlayFrame(0, 'Drag to move the paddle')), false);
    assert.equal(observer.observe(makePlayFrame(0, 'You win! Tap to play again')), true);
  });
});
