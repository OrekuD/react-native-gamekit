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

import { createButtonPadController } from '../src/core/input/buttonPad.ts';
import { createInputBuffer } from '../src/core/input/createInputBuffer.ts';

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

describe('GS-INPUT-02 pointer/action ownership', () => {
  it('two fingers in one zone yield one press and one final release', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 80, height: 60 });

    const down = pad.touchesDown(touches({ id: 1, x: 40, y: 30 }, { id: 2, x: 41, y: 31 }));
    assert.deepEqual(down.pressed, ['jump'], 'second owner does not re-press');

    const firstLift = pad.touchesUp(touches({ id: 1, x: 40, y: 30 }));
    assert.deepEqual(firstLift, { pressed: [], released: [] }, 'first lift keeps the hold');
    assert.deepEqual(pad.held(), ['jump']);

    const secondLift = pad.touchesUp(touches({ id: 2, x: 41, y: 31 }));
    assert.deepEqual(secondLift.released, ['jump'], 'last lift releases exactly once');
    assert.deepEqual(pad.held(), []);
  });

  it('zone removal under two fingers fully releases with one release', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 80, height: 60 });
    pad.touchesDown(touches({ id: 1, x: 40, y: 30 }, { id: 2, x: 41, y: 31 }));

    const released = pad.removeZone('jump');
    assert.deepEqual(released, ['jump'], 'one release for the whole action count');
    assert.deepEqual(pad.held(), [], 'no phantom hold remains');

    const lifts = pad.touchesUp(touches({ id: 1, x: 40, y: 30 }, { id: 2, x: 41, y: 31 }));
    assert.deepEqual(lifts, { pressed: [], released: [] }, 'lifts after removal emit nothing');
  });

  it('sliding across empty space reacquires the entered zone', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('left', { x: 0, y: 0, width: 60, height: 60 });
    pad.setZone('right', { x: 70, y: 0, width: 60, height: 60 });

    pad.touchesDown(touches({ id: 7, x: 30, y: 30 }));
    const gap = pad.touchesMove(touches({ id: 7, x: 65, y: 30 }));
    assert.deepEqual(gap, { pressed: [], released: ['left'] }, 'leaving releases');
    const enter = pad.touchesMove(touches({ id: 7, x: 100, y: 30 }));
    assert.deepEqual(enter, { pressed: ['right'], released: [] }, 'entering presses');
  });

  it('beginning in empty space and sliding into a zone presses (documented move-acquire policy)', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('right', { x: 70, y: 0, width: 60, height: 60 });

    const down = pad.touchesDown(touches({ id: 9, x: 10, y: 30 }));
    assert.deepEqual(down, { pressed: [], released: [] }, 'empty down maps nothing');
    const slide = pad.touchesMove(touches({ id: 9, x: 100, y: 30 }));
    assert.deepEqual(slide, { pressed: ['right'], released: [] });
  });

  it('caller mutation of a registered rect cannot alter hit areas', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    const rect = { x: 0, y: 0, width: 60, height: 60 };
    pad.setZone('left', rect);
    rect.x = 500;
    rect.width = 1;

    const down = pad.touchesDown(touches({ id: 1, x: 30, y: 30 }));
    assert.deepEqual(down.pressed, ['left'], 'the registered copy is used, not the mutated object');
  });

  it('zone removal on an empty action emits nothing', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('left', { x: 0, y: 0, width: 60, height: 60 });
    assert.deepEqual(pad.removeZone('left'), [], 'no spurious release');
    assert.deepEqual(pad.removeZone('missing'), [], 'unknown zones are safe');
  });
});

describe('GS-INPUT-04 pad invalidation', () => {
  it('invalidateOwnership snapshots stale pointers; moves wait for a fresh down', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 80, height: 60 });
    assert.deepEqual(pad.touchesDown(touches({ id: 1, x: 40, y: 30 })).pressed, ['jump']);

    pad.invalidateOwnership();
    assert.deepEqual(pad.held(), [], 'ownership cleared');
    assert.deepEqual(
      pad.touchesMove(touches({ id: 1, x: 40, y: 30 })),
      { pressed: [], released: [] },
      'a lingering move cannot reacquire without a fresh down',
    );
    assert.deepEqual(
      pad.touchesUp(touches({ id: 1, x: 40, y: 30 })),
      { pressed: [], released: [] },
      'a lingering lift emits nothing',
    );

    assert.deepEqual(
      pad.touchesDown(touches({ id: 1, x: 40, y: 30 })).pressed,
      ['jump'],
      'a fresh down rehabilitates the pointer',
    );
    assert.deepEqual(pad.touchesUp(touches({ id: 1, x: 40, y: 30 })).released, ['jump']);
  });

  it('a second pointer is unaffected by the first pointer staleness', async () => {
    const { createButtonPadController } = await import('../src/core/input/buttonPad.ts');

    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 80, height: 60 });
    pad.touchesDown(touches({ id: 1, x: 40, y: 30 }));
    pad.invalidateOwnership();
    assert.deepEqual(
      pad.touchesDown(touches({ id: 2, x: 41, y: 31 })).pressed,
      ['jump'],
      'an unrelated fresh down works immediately',
    );
  });
});

describe('button pad physical ownership', () => {
  for (const location of ['empty down', 'gap after down', 'removed zone'] as const) {
    it(`requires a fresh down after invalidation while in ${location}`, () => {
      const pad = createButtonPadController();
      pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
      pad.touchesDown([{ id: 1, x: location === 'empty down' ? 100 : 10, y: 10 }]);
      if (location === 'gap after down') pad.touchesMove([{ id: 1, x: 100, y: 10 }]);
      if (location === 'removed zone') pad.removeZone('jump');
      pad.invalidateOwnership();
      pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });

      assert.deepEqual(pad.touchesMove([{ id: 1, x: 10, y: 10 }]), { pressed: [], released: [] });
      assert.deepEqual(pad.held(), []);
      assert.deepEqual(pad.touchesDown([{ id: 1, x: 10, y: 10 }]).pressed, ['jump']);
    });
  }

  it('ignores moves without a down and after up, cancel, or releaseAll', () => {
    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
    const touch = [{ id: 1, x: 10, y: 10 }];
    assert.deepEqual(pad.touchesMove(touch), { pressed: [], released: [] });
    for (const end of [() => pad.touchesUp(touch), () => pad.touchesCancel(touch), () => pad.releaseAll()]) {
      pad.touchesDown(touch);
      end();
      assert.deepEqual(pad.touchesMove(touch), { pressed: [], released: [] });
      assert.deepEqual(pad.held(), []);
    }
  });

  it('retains physical ownership when a zone is removed and reacquires on a later move', () => {
    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
    pad.setZone('fire', { x: 100, y: 0, width: 50, height: 50 });
    pad.touchesDown([{ id: 1, x: 10, y: 10 }]);
    assert.deepEqual(pad.removeZone('jump'), ['jump']);
    assert.deepEqual(pad.touchesMove([{ id: 1, x: 110, y: 10 }]), { pressed: ['fire'], released: [] });
  });
});

describe('button pad aggregate event edges', () => {
  it('does not release or retrigger either action when two fingers swap zones in one native move', () => {
    const pad = createButtonPadController();
    const buffer = createInputBuffer({ left: { type: 'button' }, right: { type: 'button' } }, () => {});
    pad.setZone('left', { x: 0, y: 0, width: 50, height: 50 });
    pad.setZone('right', { x: 100, y: 0, width: 50, height: 50 });
    for (const action of pad.touchesDown([{ id: 1, x: 10, y: 10 }, { id: 2, x: 110, y: 10 }]).pressed) {
      buffer.controller.press(action as 'left' | 'right');
    }
    buffer.sample();
    const diff = pad.touchesMove([{ id: 1, x: 110, y: 10 }, { id: 2, x: 10, y: 10 }]);
    for (const action of diff.released) buffer.controller.release(action as 'left' | 'right');
    for (const action of diff.pressed) buffer.controller.press(action as 'left' | 'right');
    assert.deepEqual(diff, { pressed: [], released: [] });
    const frame = buffer.sample();
    for (const action of ['left', 'right'] as const) {
      assert.deepEqual(frame.button(action), { held: true, pressed: false, released: false, cancelled: false });
    }
  });

  it('keeps one action held when its old finger leaves and another enters in the same batch', () => {
    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
    pad.touchesDown([{ id: 1, x: 10, y: 10 }, { id: 2, x: 100, y: 10 }]);
    assert.deepEqual(pad.touchesMove([{ id: 1, x: 100, y: 10 }, { id: 2, x: 10, y: 10 }]), {
      pressed: [], released: [],
    });
    assert.deepEqual(pad.touchesUp([{ id: 2, x: 10, y: 10 }]).released, ['jump']);
  });

  it('keeps overlap resolution in registration order when an existing zone is updated', () => {
    const pad = createButtonPadController();
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    pad.setZone('first', rect);
    pad.setZone('second', rect);
    pad.setZone('first', { ...rect, width: 60 });
    assert.deepEqual(pad.touchesDown([{ id: 1, x: 10, y: 10 }]).pressed, ['first']);
  });
});

describe('button pad validation', () => {
  it('updates hit slop while preserving zones and rejects invalid replacement values atomically', () => {
    const pad = createButtonPadController();
    pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
    pad.setHitSlop(10);
    assert.deepEqual(pad.touchesDown([{ id: 1, x: 55, y: 10 }]).pressed, ['jump']);
    pad.releaseAll();
    for (const value of [-1, Number.NaN, Infinity]) assert.throws(() => pad.setHitSlop(value), /hitSlop/);
    assert.deepEqual(pad.touchesDown([{ id: 2, x: 55, y: 10 }]).pressed, ['jump']);
    pad.releaseAll();
    pad.setHitSlop(0);
    assert.deepEqual(pad.touchesDown([{ id: 3, x: 55, y: 10 }]).pressed, []);
  });

  it('rejects negative or non-finite hit slop', () => {
    for (const hitSlop of [-1, Number.NaN, Infinity, -Infinity]) {
      assert.throws(() => createButtonPadController({ hitSlop }), /hitSlop/);
    }
  });

  it('rejects invalid zone bounds without replacing the valid zone', () => {
    const pad = createButtonPadController();
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    pad.setZone('jump', rect);
    for (const invalid of [
      { x: Number.NaN }, { y: Infinity }, { width: -1 }, { height: -1 },
      { width: Infinity }, { height: Number.NaN }, { x: Number.MAX_VALUE, width: Number.MAX_VALUE },
    ]) {
      assert.throws(() => pad.setZone('jump', { ...rect, ...invalid }), /rect/);
    }
    assert.deepEqual(pad.touchesDown([{ id: 1, x: 10, y: 10 }]).pressed, ['jump']);
  });

  it('validates a complete down or move batch before changing any ownership', () => {
    for (const method of ['touchesDown', 'touchesMove'] as const) {
      const pad = createButtonPadController();
      pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
      pad.touchesDown([{ id: 1, x: 100, y: 10 }]);
      assert.throws(() => pad[method]([{ id: 1, x: 10, y: 10 }, { id: 2, x: Number.NaN, y: 10 }]), /finite/);
      assert.deepEqual(pad.held(), [], `${method} did not partially apply its first touch`);
      assert.throws(() => pad[method]([{ id: Infinity, x: 10, y: 10 }]), /finite/);
    }
  });

  it('validates terminal ids atomically but does not require terminal coordinates', () => {
    for (const method of ['touchesUp', 'touchesCancel'] as const) {
      const pad = createButtonPadController();
      pad.setZone('jump', { x: 0, y: 0, width: 50, height: 50 });
      pad.touchesDown([{ id: 1, x: 10, y: 10 }]);
      assert.throws(() => pad[method]([{ id: 1, x: 10, y: 10 }, { id: Number.NaN, x: 10, y: 10 }]), /finite/);
      assert.deepEqual(pad.held(), ['jump']);
      assert.deepEqual(pad[method]([{ id: 1, x: Number.NaN, y: Number.NaN }]).released, ['jump']);
    }
  });
});
