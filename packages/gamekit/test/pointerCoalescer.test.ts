import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPointerCoalescer, type CoalescedPointerEvent } from '../src/react/pointerCoalescer';
import { isBeginAllowed } from '../src/react/pointerContainment';
import { resolveViewport2D } from '../src/index';

const INTERVAL = 16.7;
const collect = (events: readonly CoalescedPointerEvent[]): readonly string[] =>
  events.map((event) => event.kind);

describe('T7: pointer coalescer (pure state machine)', () => {
  it('forwards only the final move when hundreds arrive inside one interval', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    const forwarded: CoalescedPointerEvent[] = [];
    forwarded.push(...coalescer.down(1, 0, 0, 0));
    for (let index = 1; index <= 499; index += 1) {
      forwarded.push(...coalescer.move(1, index, index, index * 0.01));
    }
    assert.deepEqual(collect(forwarded), ['begin'], 'hundreds of moves inside one interval defer');
    forwarded.push(...coalescer.move(1, 999, 999, 20));
    assert.deepEqual(collect(forwarded), ['begin', 'move'], 'the flush carries one move');
    const flushed = forwarded[1];
    if (flushed?.kind !== 'move') {
      throw new Error(`expected a move, got ${flushed?.kind}`);
    }
    assert.equal(flushed.x, 999, 'the forwarded move carries the latest dirty position');
  });

  it('forwards once per interval across separate intervals', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    coalescer.down(1, 0, 0, 0);
    const moves: CoalescedPointerEvent[] = [];
    moves.push(...coalescer.move(1, 10, 10, 5));
    moves.push(...coalescer.move(1, 20, 20, 12));
    moves.push(...coalescer.move(1, 30, 30, 20));
    moves.push(...coalescer.move(1, 40, 40, 40));
    assert.deepEqual(collect(moves), ['move', 'move']);
    const first = moves[0]!;
    const second = moves[1]!;
    if (first.kind !== 'move' || second.kind !== 'move') {
      throw new Error('expected moves');
    }
    assert.equal(first.x, 30, 'the 20ms event flushes and carries its own position');
    assert.equal(second.x, 40, 'the 40ms event is a separate interval');
  });

  it('a move arriving before the begin is impossible and after it cannot overtake', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    assert.deepEqual(collect(coalescer.move(1, 5, 5, 5)), [], 'moves without a pointer are dropped');
    const events = [...coalescer.down(1, 1, 1, 10), ...coalescer.move(1, 2, 2, 30)];
    assert.deepEqual(collect(events), ['begin', 'move'], 'begin always precedes movement');
  });

  it('down then up between ticks preserves both edges with the final coordinate', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    const events = [...coalescer.down(1, 100, 200, 0), ...coalescer.up(1, 140, 220, 5)];
    assert.deepEqual(collect(events), ['begin', 'end']);
    const end = events[1];
    assert.equal(end?.kind, 'end');
    if (end?.kind === 'end') {
      assert.equal(end.x, 140, 'the release sample carries the final up coordinate');
      assert.equal(end.y, 220);
    }
  });

  it('cancel neutralises exactly once', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    coalescer.down(1, 0, 0, 0);
    assert.deepEqual(collect(coalescer.cancel(1)), ['cancel']);
    assert.deepEqual(collect(coalescer.cancel(2)), [], 'a second cancel is inert');
    assert.deepEqual(collect(coalescer.move(1, 5, 5, 5)), [], 'no movement survives the cancel');
  });

  it('a secondary pointer cannot steal the active pointer', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    const events = [
      ...coalescer.down(1, 0, 0, 0),
      ...coalescer.down(2, 5, 5, 1),
      ...coalescer.move(2, 50, 50, 2),
      ...coalescer.up(2, 50, 50, 3),
      ...coalescer.move(1, 10, 10, 40),
      ...coalescer.up(1, 11, 11, 41),
    ];
    assert.deepEqual(collect(events), ['begin', 'move', 'end']);
  });

  it('end then begin starts a fresh gesture and preserves the old terminal edge', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    const first = [...coalescer.down(1, 0, 0, 0), ...coalescer.up(1, 70, 70, 10)];
    assert.deepEqual(collect(first), ['begin', 'end']);
    const second = [...coalescer.down(1, 0, 0, 20), ...coalescer.up(1, 90, 90, 30)];
    assert.deepEqual(collect(second), ['begin', 'end']);
  });

  it('reset (layout revision/unmount) drops queued movement entirely', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    coalescer.down(1, 0, 0, 0);
    coalescer.move(1, 30, 30, 5); // deferred
    coalescer.reset();
    const after = [
      ...coalescer.up(1, 40, 40, 10),
      ...coalescer.move(1, 50, 50, 20),
      ...coalescer.cancel(30),
    ];
    assert.deepEqual(collect(after), [], 'nothing forwards after reset');
  });

  it('mirrors the letterbox containment check on the UI formula', () => {
    const fit = resolveViewport2D(
      { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
      { width: 440, height: 956 },
    )!;
    assert.equal(isBeginAllowed(fit, 0, 0), false, 'letterbox top-left rejected');
    assert.equal(isBeginAllowed(fit, 220, 900), false, 'letterbox bottom rejected');
    assert.equal(isBeginAllowed(fit, 220, 400), true, 'inside the content accepted');
    assert.equal(isBeginAllowed(fit, 440, 601.75), true, 'content edge accepted');
    assert.equal(isBeginAllowed(undefined, 10, 10), false, 'no layout rejects');

    const fill = resolveViewport2D(
      { logicalSize: { width: 320, height: 180 }, mode: 'fill' },
      { width: 440, height: 956 },
    )!;
    assert.equal(isBeginAllowed(fill, 0, 0), true, 'fill has no letterbox');
  });
});
