import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { samplerMirrorFromBatch } from '../src/react/gestureLifecycle';
import { createPointerCoalescer, type CoalescedPointerEvent } from '../src/react/pointerCoalescer';

const INTERVAL = 16.7;

function collect(events: readonly CoalescedPointerEvent[]): readonly string[] {
  return events.map((event) => event.kind);
}

describe('frame-driven trailing flush (F2)', () => {
  it('forwards a deferred final move via flush when no later native move arrives', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    const forwarded: CoalescedPointerEvent[] = [];
    forwarded.push(...coalescer.down(1, 0, 0, 0));
    // The only native move lands inside the interval: deferred.
    forwarded.push(...coalescer.move(1, 120, 90, 3));
    assert.deepEqual(collect(forwarded), ['begin'], 'the move is deferred');
    // The frame clock reaches the interval with no further native input.
    forwarded.push(...coalescer.flush(20));
    assert.deepEqual(collect(forwarded), ['begin', 'move'], 'flush forwards the trailing move');
    const flushed = forwarded[1];
    if (flushed?.kind !== 'move') {
      throw new Error(`expected a move, got ${flushed?.kind}`);
    }
    assert.equal(flushed.x, 120, 'the trailing move carries the latest dirty position');
  });

  it('flush before the interval forwards nothing and keeps the pending move', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    coalescer.down(1, 0, 0, 0);
    coalescer.move(1, 50, 50, 5);
    assert.deepEqual(collect(coalescer.flush(10)), [], 'not yet due');
    assert.deepEqual(collect(coalescer.flush(20)), ['move'], 'still pending, forwards once due');
    assert.deepEqual(collect(coalescer.flush(30)), [], 'pending move consumed');
  });

  it('flush with no active pointer or no pending move emits nothing', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    assert.deepEqual(collect(coalescer.flush(100)), [], 'no pointer');
    coalescer.down(1, 0, 0, 0);
    assert.deepEqual(collect(coalescer.flush(100)), [], 'no pending move');
    coalescer.up(1, 0, 0, 100);
    assert.deepEqual(collect(coalescer.flush(200)), [], 'pointer released');
  });

  it('up subsumes a deferred move without a duplicate', () => {
    const coalescer = createPointerCoalescer(INTERVAL);
    const events = [
      ...coalescer.down(1, 0, 0, 0),
      ...coalescer.move(1, 120, 90, 3),
      ...coalescer.up(1, 140, 100, 4),
    ];
    assert.deepEqual(collect(events), ['begin', 'end'], 'terminal edge carries the newest point');
    assert.equal(events[1]?.kind === 'end' ? events[1].x : -1, 140);
  });
});

describe('sampler mirror (F2 lifecycle)', () => {
  it('activates on a forwarded begin and deactivates only on a terminal edge', () => {
    const begin = samplerMirrorFromBatch([{ kind: 'begin', pointerId: 1, x: 0, y: 0 }]);
    assert.equal(begin, true);
    const end = samplerMirrorFromBatch([{ kind: 'end', pointerId: 1, x: 0, y: 0 }]);
    assert.equal(end, false);
    const cancel = samplerMirrorFromBatch([{ kind: 'cancel' }]);
    assert.equal(cancel, false);
  });

  it('leaves the sampler untouched for empty batches and flushed moves', () => {
    assert.equal(samplerMirrorFromBatch([]), undefined, 'secondary touches must not toggle the sampler');
    assert.equal(
      samplerMirrorFromBatch([{ kind: 'move', pointerId: 1, x: 0, y: 0 }]),
      undefined,
      'a flushed move keeps the pointer owned',
    );
  });
});
