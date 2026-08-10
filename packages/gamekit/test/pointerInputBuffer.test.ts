import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createInputBuffer } from '../src/core/input/createInputBuffer.ts';

const input = {
  boost: { type: 'button' },
  primary: { type: 'pointer' },
} as const;

function createBuffer() {
  return createInputBuffer(input, () => {});
}

describe('pointer input buffer', () => {
  it('begins a pointer with one-tick pressed edge and accumulated moves', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 7, { x: 40, y: 90 });
    buffer.controller.move('primary', 7, { x: 60, y: 95 });
    buffer.controller.move('primary', 7, { x: 90, y: 100 });

    const frame = buffer.sample();
    const pointer = frame.pointer('primary');
    assert.deepEqual(pointer, {
      active: true,
      pressed: true,
      released: false,
      cancelled: false,
      pointerId: 7,
      position: { x: 90, y: 100 },
      delta: { x: 50, y: 10 },
    });

    const neutral = buffer.sample();
    assert.deepEqual(neutral.pointer('primary'), {
      active: true,
      pressed: false,
      released: false,
      cancelled: false,
      pointerId: 7,
      position: { x: 90, y: 100 },
      delta: { x: 0, y: 0 },
    });
  });

  it('releases ownership on end and retains the final position for one frame', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 3, { x: 10, y: 20 });
    buffer.controller.move('primary', 3, { x: 30, y: 25 });
    buffer.controller.end('primary', 3);

    const released = buffer.sample().pointer('primary');
    assert.deepEqual(released, {
      active: false,
      pressed: true,
      released: true,
      cancelled: false,
      pointerId: 3,
      position: { x: 30, y: 25 },
      delta: { x: 20, y: 5 },
    });

    const neutral = buffer.sample().pointer('primary');
    assert.equal(neutral.position, undefined);
    assert.equal(neutral.pointerId, undefined);
    assert.equal(neutral.released, false);
    assert.equal(neutral.active, false);
  });

  it('reports cancellation as its own edge and clears position afterwards', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 5, { x: 1, y: 2 });
    buffer.controller.cancel('primary');

    const cancelled = buffer.sample().pointer('primary');
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.released, false);
    assert.equal(cancelled.active, false);
    assert.deepEqual(cancelled.position, { x: 1, y: 2 });

    const neutral = buffer.sample().pointer('primary');
    assert.equal(neutral.cancelled, false);
    assert.equal(neutral.position, undefined);
  });

  it('handles begin/release and begin/cancel between ticks', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 1, { x: 5, y: 5 });
    buffer.controller.end('primary', 1);

    const between = buffer.sample().pointer('primary');
    assert.equal(between.pressed, true);
    assert.equal(between.released, true);
    assert.equal(between.active, false);

    const buffer2 = createBuffer();
    buffer2.controller.begin('primary', 2, { x: 5, y: 5 });
    buffer2.controller.cancel('primary');
    const cancelled = buffer2.sample().pointer('primary');
    assert.equal(cancelled.pressed, true);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.active, false);
  });

  it('ignores a secondary pointer while the first pointer owns the action', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 11, { x: 0, y: 0 });
    buffer.controller.begin('primary', 12, { x: 100, y: 100 });
    buffer.controller.move('primary', 12, { x: 200, y: 200 });
    buffer.controller.move('primary', 11, { x: 10, y: 0 });

    const pointer = buffer.sample().pointer('primary');
    assert.equal(pointer.pointerId, 11);
    assert.deepEqual(pointer.position, { x: 10, y: 0 });
    assert.deepEqual(pointer.delta, { x: 10, y: 0 });

    // The secondary pointer cannot end the primary's ownership.
    buffer.controller.end('primary', 12);
    assert.equal(buffer.sample().pointer('primary').active, true);
  });

  it('transfers ownership only after the owner releases or cancels', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 21, { x: 0, y: 0 });
    buffer.controller.end('primary', 21);
    buffer.controller.begin('primary', 22, { x: 50, y: 50 });

    // The terminal frame still belongs to the releasing pointer.
    const releasing = buffer.sample().pointer('primary');
    assert.equal(releasing.pointerId, 21);
    assert.equal(releasing.released, true);
    // Ownership transfers on the following frame.
    const pointer = buffer.sample().pointer('primary');
    assert.equal(pointer.pointerId, 22);
    assert.equal(pointer.pressed, true);
    assert.equal(pointer.active, true);
  });

  it('drops moves from unknown pointers', () => {
    const buffer = createBuffer();
    buffer.controller.move('primary', 99, { x: 5, y: 5 });
    const pointer = buffer.sample().pointer('primary');
    assert.equal(pointer.active, false);
    assert.equal(pointer.pressed, false);
  });

  it('keeps events enqueued during a sample invisible until the next sample', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 1, { x: 0, y: 0 });
    const first = buffer.sample();
    buffer.controller.move('primary', 1, { x: 8, y: 0 });
    const second = buffer.sample();
    buffer.controller.end('primary', 1);
    const third = buffer.sample();

    assert.equal(first.pointer('primary').pressed, true);
    assert.deepEqual(second.pointer('primary').delta, { x: 8, y: 0 });
    assert.equal(second.pointer('primary').released, false);
    assert.equal(third.pointer('primary').released, true);
  });

  it('consumes edges only on the first sample of a catch-up sequence', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 1, { x: 0, y: 0 });
    const samples = [buffer.sample(), buffer.sample(), buffer.sample()];
    assert.deepEqual(
      samples.map((frame) => frame.pointer('primary').pressed),
      [true, false, false],
    );
  });

  it('neutralizes all actions on reset', () => {
    const buffer = createBuffer();
    buffer.controller.press('boost');
    buffer.controller.begin('primary', 4, { x: 1, y: 1 });
    buffer.controller.move('primary', 4, { x: 9, y: 9 });
    buffer.reset();

    const frame = buffer.sample();
    assert.deepEqual(frame.button('boost'), {
      held: false,
      pressed: false,
      released: false,
      cancelled: false,
    });
    const pointer = frame.pointer('primary');
    assert.equal(pointer.active, false);
    assert.equal(pointer.pressed, false);
    assert.equal(pointer.position, undefined);
    assert.deepEqual(pointer.delta, { x: 0, y: 0 });
  });

  it('preserves a physically active pointer across an update-scoped scene transition', () => {
    const buffer = createBuffer();
    buffer.controller.press('boost');
    buffer.controller.begin('primary', 4, { x: 20, y: 30 });
    buffer.controller.move('primary', 4, { x: 40, y: 50 });

    // The outgoing scene consumes the press and movement edges before it asks
    // to transition. The new scene should inherit only the physical pointer,
    // never stale edges, deltas, or a held button.
    buffer.sample();
    buffer.resetForTransition(['primary']);

    const inherited = buffer.sample();
    assert.deepEqual(inherited.button('boost'), {
      held: false,
      pressed: false,
      released: false,
      cancelled: false,
    });
    assert.deepEqual(inherited.pointer('primary'), {
      active: true,
      pressed: false,
      released: false,
      cancelled: false,
      pointerId: 4,
      position: { x: 40, y: 50 },
      delta: { x: 0, y: 0 },
    });

    buffer.controller.move('primary', 4, { x: 90, y: 70 });
    assert.deepEqual(buffer.sample().pointer('primary').position, { x: 90, y: 70 });
  });

  it('does not preserve an active pointer when the target scene does not consume it', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 9, { x: 10, y: 20 });
    buffer.sample();
    buffer.resetForTransition([]);

    const pointer = buffer.sample().pointer('primary');
    assert.equal(pointer.active, false);
    assert.equal(pointer.pointerId, undefined);
    assert.equal(pointer.position, undefined);
  });

  it('rejects unknown actions', () => {
    const buffer = createBuffer();
    assert.throws(() => buffer.controller.press('missing' as 'boost'), /Unknown input action: missing/);
    assert.throws(() => buffer.controller.begin('missing' as 'primary', 1, { x: 0, y: 0 }), /Unknown input action: missing/);
    assert.throws(() => buffer.sample().button('missing' as 'boost'), /Unknown input action: missing/);
    assert.throws(() => buffer.sample().pointer('missing' as 'primary'), /Unknown input action: missing/);
  });

  it('rejects a button operation on a pointer action and vice versa', () => {
    const buffer = createBuffer();
    assert.throws(() => buffer.controller.press('primary'), /not a button/);
    assert.throws(() => buffer.controller.release('primary'), /not a button/);
    assert.throws(() => buffer.controller.begin('boost', 1, { x: 0, y: 0 }), /not a pointer/);
    assert.throws(() => buffer.controller.move('boost', 1, { x: 0, y: 0 }), /not a pointer/);
    assert.throws(() => buffer.controller.end('boost', 1), /not a pointer/);
    assert.throws(() => buffer.sample().button('primary'), /not a button/);
    assert.throws(() => buffer.sample().pointer('boost'), /not a pointer/);
  });

  it('freezes sampled pointer state and points', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 1, { x: 1, y: 2 });
    const frame = buffer.sample();
    const pointer = frame.pointer('primary');
    assert.equal(Object.isFrozen(pointer), true);
    assert.equal(Object.isFrozen(pointer.position), true);
    assert.equal(Object.isFrozen(pointer.delta), true);
    assert.equal(Reflect.set(pointer.delta, 'x', 99), false);
  });

  it('samples independently across pointer and button actions', () => {
    const buffer = createBuffer();
    buffer.controller.press('boost');
    buffer.controller.begin('primary', 1, { x: 3, y: 4 });
    const frame = buffer.sample();
    assert.equal(frame.button('boost').held, true);
    assert.equal(frame.pointer('primary').active, true);
  });
});

describe('pointer terminal edge before ownership transfer (feedback)', () => {
  it('preserves the release edge and final position when end is followed by begin before sampling', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 11, { x: 10, y: 20 });
    buffer.controller.move('primary', 11, { x: 30, y: 25 });
    buffer.controller.end('primary', 11);
    // A new touch arrives before the tick boundary.
    buffer.controller.begin('primary', 12, { x: 100, y: 100 });

    const released = buffer.sample().pointer('primary');
    assert.equal(released.released, true, 'release edge survives the early begin');
    assert.equal(released.active, false);
    assert.equal(released.pointerId, 11, 'ownership belongs to the releasing pointer');
    assert.deepEqual(released.position, { x: 30, y: 25 }, 'final position of the releasing pointer');

    // Ownership transfers only after the terminal edge is sampled.
    const transferred = buffer.sample().pointer('primary');
    assert.equal(transferred.released, false);
    assert.equal(transferred.pointerId, 12, 'new pointer becomes the owner after the release frame');
    assert.equal(transferred.pressed, true);
    assert.deepEqual(transferred.position, { x: 100, y: 100 });
  });

  it('preserves the cancel edge when cancel is followed by begin before sampling', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 21, { x: 1, y: 2 });
    buffer.controller.cancel('primary');
    buffer.controller.begin('primary', 22, { x: 50, y: 60 });

    const cancelled = buffer.sample().pointer('primary');
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.pointerId, 21);
    assert.deepEqual(cancelled.position, { x: 1, y: 2 });

    const transferred = buffer.sample().pointer('primary');
    assert.equal(transferred.cancelled, false);
    assert.equal(transferred.pointerId, 22);
  });

  it('ignores moves from the old owner until the terminal edge is sampled', () => {
    const buffer = createBuffer();
    buffer.controller.begin('primary', 31, { x: 0, y: 0 });
    buffer.controller.end('primary', 31);
    buffer.controller.move('primary', 31, { x: 99, y: 99 });
    const released = buffer.sample().pointer('primary');
    assert.deepEqual(released.position, { x: 0, y: 0 }, 'post-end moves are dropped');
  });
});

describe('pointer runtime input validation (feedback)', () => {
  it('rejects non-finite pointer ids', () => {
    const buffer = createBuffer();
    assert.throws(() => buffer.controller.begin('primary', Number.NaN, { x: 0, y: 0 }), /finite/);
    assert.throws(() => buffer.controller.begin('primary', Number.POSITIVE_INFINITY, { x: 0, y: 0 }), /finite/);
    assert.throws(() => buffer.controller.move('primary', Number.NaN, { x: 0, y: 0 }), /finite/);
    assert.throws(() => buffer.controller.end('primary', Number.NaN), /finite/);
  });

  it('rejects non-finite pointer coordinates', () => {
    const buffer = createBuffer();
    assert.throws(() => buffer.controller.begin('primary', 1, { x: Number.NaN, y: 0 }), /finite/);
    assert.throws(() => buffer.controller.begin('primary', 1, { x: 0, y: Number.NaN }), /finite/);
    assert.throws(() => buffer.controller.begin('primary', 1, { x: Number.POSITIVE_INFINITY, y: 0 }), /finite/);
    buffer.controller.begin('primary', 1, { x: 1, y: 2 });
    assert.throws(() => buffer.controller.move('primary', 1, { x: Number.NaN, y: 0 }), /finite/);
  });
});
