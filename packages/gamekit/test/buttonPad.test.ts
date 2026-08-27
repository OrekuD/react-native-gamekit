/**
 * Headless tests for the multitouch button-pad controller (T20).
 *
 * The controller maps every active pointer to the button zone it covers and
 * turns touch transitions into press/release diffs for a session input
 * buffer. React never sees pointer bookkeeping; the component only applies
 * the returned diffs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function touches(...list: readonly { id: number; x: number; y: number }[]) {
  return list;
}

describe('button pad controller', () => {
  it('presses when a finger lands on a zone and releases on lift', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('left', { x: 0, y: 0, width: 60, height: 60 });
    pad.setZone('jump', { x: 200, y: 0, width: 80, height: 60 });

    const down = pad.touchesDown(touches({ id: 1, x: 30, y: 30 }));
    assert.deepEqual(down, { pressed: ['left'], released: [] }, 'landing presses left');

    const up = pad.touchesUp(touches({ id: 1, x: 30, y: 30 }));
    assert.deepEqual(up, { pressed: [], released: ['left'] }, 'lifting releases left');
  });

  it('supports simultaneous independent fingers', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('left', { x: 0, y: 0, width: 60, height: 60 });
    pad.setZone('jump', { x: 200, y: 0, width: 80, height: 60 });

    const down = pad.touchesDown(touches({ id: 1, x: 30, y: 30 }, { id: 2, x: 240, y: 30 }));
    assert.deepEqual([...down.pressed].sort(), ['jump', 'left'], 'both actions press together');

    const liftLeft = pad.touchesUp(touches({ id: 1, x: 30, y: 30 }));
    assert.deepEqual(liftLeft.released, ['left'], 'lifting one finger keeps jump held');

    const liftJump = pad.touchesUp(touches({ id: 2, x: 240, y: 30 }));
    assert.deepEqual(liftJump.released, ['jump']);
  });

  it('sliding between zones reassigns the pointer (release + press)', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('left', { x: 0, y: 0, width: 60, height: 60 });
    pad.setZone('right', { x: 70, y: 0, width: 60, height: 60 });

    pad.touchesDown(touches({ id: 7, x: 30, y: 30 }));
    const move = pad.touchesMove(touches({ id: 7, x: 100, y: 30 }));
    assert.deepEqual(move, { pressed: ['right'], released: ['left'] }, 'slide reassigns');
  });

  it('keeps an action held while ANY pointer covers it (refcounted)', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 80, height: 60 });

    pad.touchesDown(touches({ id: 1, x: 40, y: 30 }, { id: 2, x: 41, y: 31 }));
    const firstLift = pad.touchesUp(touches({ id: 1, x: 40, y: 30 }));
    assert.deepEqual(firstLift, { pressed: [], released: [] }, 'second finger still holds');
    const secondLift = pad.touchesUp(touches({ id: 2, x: 41, y: 31 }));
    assert.deepEqual(secondLift.released, ['jump'], 'release fires when the last finger lifts');
  });

  it('hit slop extends a zone without moving its edges', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController({ hitSlop: 12 });
    pad.setZone('a', { x: 0, y: 0, width: 50, height: 50 });
    const down = pad.touchesDown(touches({ id: 1, x: 58, y: 25 }));
    assert.deepEqual(down.pressed, ['a'], 'inside the slop ring counts');
    const outside = pad.touchesDown(touches({ id: 2, x: 70, y: 25 }));
    assert.deepEqual(outside.pressed, [], 'past the slop ring misses');
  });

  it('touches outside every zone are ignored', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('a', { x: 0, y: 0, width: 50, height: 50 });
    const down = pad.touchesDown(touches({ id: 1, x: 500, y: 500 }));
    assert.deepEqual(down, { pressed: [], released: [] });
    const up = pad.touchesUp(touches({ id: 1, x: 500, y: 500 }));
    assert.deepEqual(up, { pressed: [], released: [] });
  });

  it('unregistering a zone releases pointers still covering it', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('left', { x: 0, y: 0, width: 60, height: 60 });
    pad.touchesDown(touches({ id: 1, x: 30, y: 30 }));

    const released = pad.removeZone('left');
    assert.deepEqual(released, ['left'], 'unmount cleanup releases held action');
  });

  it('cancel behaves like lift for the changed touches only', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('a', { x: 0, y: 0, width: 50, height: 50 });
    pad.setZone('b', { x: 100, y: 0, width: 50, height: 50 });
    pad.touchesDown(touches({ id: 1, x: 10, y: 10 }, { id: 2, x: 120, y: 10 }));

    const cancel = pad.touchesCancel(touches({ id: 1, x: 10, y: 10 }));
    assert.deepEqual(cancel.released, ['a']);
    assert.deepEqual(pad.held(), ['b'], 'the untouched pointer stays held');
  });
});
