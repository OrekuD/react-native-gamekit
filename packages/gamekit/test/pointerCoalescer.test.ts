import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPointerCoalescer,
  createPointerCoalescerState,
  reducePointerCoalescer,
  type CoalescedPointerEvent,
  type PointerCoalescerInput,
} from '../src/react/pointerCoalescer';
import { isBeginAllowed } from '../src/react/pointerContainment';
import { resolveViewport2D } from '../src/index';

const INTERVAL = 16.7;
const collect = (events: readonly CoalescedPointerEvent[]): readonly string[] =>
  events.map((event) => event.kind);

describe('T7: pointer coalescer (pure state machine)', () => {
  it('shares explicit state across separately registered worklet handlers', () => {
    let sharedState = createPointerCoalescerState(INTERVAL);
    const dispatch = (input: PointerCoalescerInput): readonly CoalescedPointerEvent[] => {
      const transition = reducePointerCoalescer(sharedState, input);
      sharedState = transition.state;
      return transition.events;
    };

    // RNGH registers these as separate UI-runtime worklets. They cannot rely
    // on a mutable object captured independently in each handler closure; the
    // state passed through the shared-value seam must carry ownership across
    // down, move, and up.
    const onDown = () => dispatch({ kind: 'down', pointerId: 7, x: 10, y: 20, nowMs: 0 });
    const onMove = () => dispatch({ kind: 'move', pointerId: 7, x: 90, y: 30, nowMs: 20 });
    const onUp = () => dispatch({ kind: 'up', pointerId: 7, x: 100, y: 40, nowMs: 25 });

    assert.deepEqual(collect(onDown()), ['begin']);
    assert.deepEqual(collect(onMove()), ['move']);
    assert.deepEqual(collect(onUp()), ['end']);
    assert.equal(sharedState.active, undefined, 'the terminal handler releases ownership');
  });

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
    const events = [
      ...coalescer.down(1, 100, 200, 0),
      ...coalescer.move(1, 120, 210, 3),
      ...coalescer.up(1, 140, 220, 5),
    ];
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
    coalescer.move(1, 20, 20, 5);
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

describe('camera stamp through deferral (T12-RF3)', () => {
  const stampA = { camera: { center: { x: 0, y: 0 }, zoom: 1, rotationRadians: 0 }, cutId: 1 };
  const stampB = { camera: { center: { x: 80, y: 0 }, zoom: 1, rotationRadians: 0 }, cutId: 1 };

  it('carries the move-time stamp through a deferred flush', () => {
    let state = createPointerCoalescerState(100);
    const down = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 });
    state = down.state;
    // A move inside the coalescing interval defers with ITS OWN stamp.
    const deferred = reducePointerCoalescer(state, {
      kind: 'move',
      pointerId: 1,
      x: 10,
      y: 10,
      nowMs: 10,
      stamp: stampA,
    });
    assert.equal(deferred.events.length, 0, 'the move is deferred');
    state = deferred.state;
    // Presentation advances to B before the flush.
    const flushed = reducePointerCoalescer(state, { kind: 'flush', nowMs: 150 });
    assert.equal(flushed.events.length, 1);
    const move = flushed.events[0] as { kind: 'move'; x: number; y: number; stamp?: unknown };
    assert.equal(move.stamp, stampA, 'the flush carries the ORIGINAL move-time stamp');
  });

  it('pairs the latest of multiple deferred moves with its own stamp', () => {
    let state = createPointerCoalescerState(100);
    state = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 }).state;
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 10, y: 10, nowMs: 10, stamp: stampA,
    }).state;
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 20, y: 20, nowMs: 20, stamp: stampB,
    }).state;
    const flushed = reducePointerCoalescer(state, { kind: 'flush', nowMs: 150 });
    const move = flushed.events[0] as { kind: 'move'; x: number; y: number; stamp?: unknown };
    assert.equal(move.x, 20, 'the latest deferred position');
    assert.equal(move.stamp, stampB, 'the latest move stamp — coordinates and camera from the SAME sample');
  });

  it('lets up subsume a deferred move with the up event position and camera', () => {
    let state = createPointerCoalescerState(100);
    state = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 }).state;
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 10, y: 10, nowMs: 10, stamp: stampA,
    }).state;
    const ended = reducePointerCoalescer(state, { kind: 'up', pointerId: 1, x: 30, y: 30, nowMs: 20 });
    const end = ended.events[0] as { kind: 'end'; x: number; y: number };
    assert.equal(end.kind, 'end');
    assert.equal(end.x, 30, 'the up position subsumes the deferred move');
    assert.ok(!('stamp' in end), 'the end edge carries no fabricated camera stamp');
  });

  it('cancel carries no fabricated camera sample', () => {
    let state = createPointerCoalescerState(100);
    state = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 }).state;
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 10, y: 10, nowMs: 10, stamp: stampA,
    }).state;
    const cancelled = reducePointerCoalescer(state, { kind: 'cancel', nowMs: 20 });
    assert.equal(cancelled.events[0]?.kind, 'cancel');
    assert.ok(!('stamp' in (cancelled.events[0] as object)), 'cancel has no camera stamp');
  });
});

describe('discriminated camera capture through the adapter seam (T12-SF1)', () => {
  const cameraA = { camera: { center: { x: 0, y: 0 }, zoom: 1, rotationRadians: 0 }, cutId: 1 };
  const cameraB = { camera: { center: { x: 80, y: 0 }, zoom: 1, rotationRadians: 0 }, cutId: 2 };

  function capture(value: unknown): { captured: true; value: unknown } {
    return { captured: true, value };
  }

  function forward(batch: readonly { kind: string; x?: number; y?: number; stamp?: unknown }[], presented: unknown): unknown[] {
    // The adapter's packet builder: moves use the module helper semantics.
    const packets: unknown[] = [];
    for (const event of batch) {
      const camera =
        event.kind === 'move' && event.stamp !== undefined
          ? (event.stamp as { captured: true; value: unknown }).value
          : presented;
      packets.push({ kind: event.kind, x: event.x, y: event.y, camera });
    }
    return packets;
  }

  it('keeps a captured undefined camera undefined through deferral (never falls back)', () => {
    let state = createPointerCoalescerState(100);
    state = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 }).state;
    // The surface mounted but the camera is not presented yet: captured
    // undefined is EXPLICIT.
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 10, y: 10, nowMs: 10, stamp: capture(undefined),
    }).state;
    // Camera B presents before the flush.
    const flushed = reducePointerCoalescer(state, { kind: 'flush', nowMs: 150 });
    const packets = forward(flushed.events, cameraB);
    assert.equal((packets[0] as { camera: unknown }).camera, undefined, 'captured undefined stays undefined');
  });

  it('pairs every move kind with its own event-time capture', () => {
    let state = createPointerCoalescerState(100);
    const down = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 });
    state = down.state;
    // Immediate move (outside the interval): stamped at its own event time.
    const immediate = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 5, y: 5, nowMs: 200, stamp: capture(cameraA),
    });
    state = immediate.state;
    // Deferred moves: the latest pair wins.
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 10, y: 10, nowMs: 210, stamp: capture(cameraA),
    }).state;
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 20, y: 20, nowMs: 220, stamp: capture(cameraB),
    }).state;
    const flushed = reducePointerCoalescer(state, { kind: 'flush', nowMs: 300 });
    const packets = forward([...immediate.events, ...flushed.events], cameraB);
    assert.equal((packets[0] as { camera: unknown }).camera, cameraA, 'immediate move uses its own stamp');
    assert.equal((packets[1] as { camera: unknown }).camera, cameraB, 'latest deferred move uses its own stamp');
    assert.equal((packets[1] as { x: number }).x, 20, 'coordinates and camera from the SAME sample');
  });

  it('lets up carry its own event-time camera without a fabricated stamp', () => {
    let state = createPointerCoalescerState(100);
    state = reducePointerCoalescer(state, { kind: 'down', pointerId: 1, x: 0, y: 0, nowMs: 0 }).state;
    state = reducePointerCoalescer(state, {
      kind: 'move', pointerId: 1, x: 10, y: 10, nowMs: 10, stamp: capture(cameraA),
    }).state;
    const ended = reducePointerCoalescer(state, { kind: 'up', pointerId: 1, x: 30, y: 30, nowMs: 20 });
    const packets = forward(ended.events, cameraB);
    assert.equal((packets[0] as { kind: string }).kind, 'end');
    assert.equal((packets[0] as { camera: unknown }).camera, cameraB, 'the up edge samples its own event-time camera');
  });
});
