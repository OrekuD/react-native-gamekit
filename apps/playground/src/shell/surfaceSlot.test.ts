import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  neutralSlot,
  reduceSurfaceState,
  effectiveBinding,
  type RunSurfaceAttachment,
  type SurfaceEvent,
  type SurfaceSlot,
} from './surfaceSlot.ts';

/**
 * Task 8 pure state-machine tests (T8.0 RED / T8.3).
 *
 * These tests drive the same `reduceSurfaceState`/`neutralSlot` functions
 * the production shell applies — there is no parallel lookalike model.
 * Sessions are opaque stubs; the module only compares identity, reads
 * `status`, and records generations.
 */

type SessionStub = {
  readonly marker: string;
  readonly status: 'ready' | 'disposed';
};

function session(marker: string): SessionStub {
  return { marker, status: 'ready' };
}

const RENDERER = (() => null) as never;
const CONTENT = (() => null) as never;
const NEUTRAL_SESSION = session('neutral');

function neutral(): SurfaceSlot {
  return neutralSlot(1, NEUTRAL_SESSION as never, RENDERER);
}

function openReady(
  requestId: number,
  generation: number,
  active: SessionStub,
  gameId = 'brick-breaker',
  pointer = true,
): SurfaceEvent {
  return {
    kind: 'open-ready',
    requestId,
    generation,
    gameId,
    session: active as never,
    renderer: RENDERER,
    content: CONTENT,
    pointer,
  };
}

function openLoading(
  requestId: number,
  generation: number,
  placeholder: SessionStub,
): SurfaceEvent {
  return {
    kind: 'open-loading',
    requestId,
    generation,
    gameId: 'sprite-field',
    session: placeholder as never,
    renderer: RENDERER,
    content: CONTENT,
  };
}

function attachment(run: SessionStub): RunSurfaceAttachment {
  return {
    session: run as never,
    pointer: {} as never,
    view: {} as never,
  };
}

function commit(generation: number): SurfaceEvent {
  return { kind: 'binding-committed', generation };
}

describe('surface state machine (T8 canonical transitions)', () => {
  it('same game id with a new request id publishes a new session and generation', () => {
    const first = reduceSurfaceState(neutral(), openReady(1, 2, session('A'))).slot;
    const reopen = reduceSurfaceState(first, openReady(2, 3, session('B'))).slot;
    assert.notEqual(reopen.session, first.session, 'a fresh request never presents the old session');
    assert.equal(reopen.requestId, 2);
    assert.equal(reopen.generation, 3, 'binding generation advances with the request');
    assert.equal(reopen.gameId, 'brick-breaker');
    assert.deepEqual(
      reopen.retiring.map((r) => r.session),
      [first.session],
      'the superseded session retires with the new generation',
    );
  });

  it('different game id publishes a coherent new slot', () => {
    const first = reduceSurfaceState(neutral(), openReady(1, 2, session('A'), 'brick-breaker')).slot;
    const b = session('B');
    const next = reduceSurfaceState(
      first,
      openReady(2, 3, b, 'bootstrap', false),
    ).slot;
    assert.equal(next.gameId, 'bootstrap');
    assert.equal(next.session, b);
    assert.equal(next.pointer, false, 'pointer follows the entry, not the previous slot');
    assert.equal(next.renderer, RENDERER);
    assert.equal(next.content, CONTENT);
  });

  it('close publishes neutral before the old session becomes disposable', () => {
    const open = reduceSurfaceState(neutral(), openReady(1, 2, session('A'))).slot;
    const closed = reduceSurfaceState(open, {
      kind: 'close',
      generation: 3,
      neutralSession: NEUTRAL_SESSION as never,
      neutralRenderer: RENDERER,
    });
    assert.equal(closed.slot.status, 'neutral');
    assert.equal(closed.slot.gameId, null);
    assert.equal(closed.slot.requestId, 0, 'no request is active on Home');
    assert.equal(closed.slot.session, NEUTRAL_SESSION, 'the stable neutral session is bound');
    assert.equal(closed.disposable.length, 0, 'not disposable before acknowledgment');
    assert.equal(closed.slot.retiring.length, 1, 'the game session is retained for the handoff');
    assert.equal(closed.slot.retiring[0]?.retiredByGeneration, 3);
  });

  it('retirement is eligible only after the generation commits; repeated acknowledgment is idempotent', () => {
    const open = reduceSurfaceState(neutral(), openReady(1, 2, session('A'))).slot;
    const closed = reduceSurfaceState(open, {
      kind: 'close',
      generation: 3,
      neutralSession: NEUTRAL_SESSION as never,
      neutralRenderer: RENDERER,
    }).slot;
    const committed = reduceSurfaceState(closed, commit(3));
    assert.deepEqual(committed.disposable, [session('A')]);
    assert.equal(committed.slot.retiring.length, 0);
    const again = reduceSurfaceState(committed.slot, commit(3));
    assert.equal(again.disposable.length, 0, 'repeated acknowledgment is a no-op');
    assert.equal(again.slot, committed.slot, 'no state churn on idempotent acknowledgment');
  });

  it('rapid replacements retain all sessions until safe and drain each once', () => {
    let slot = neutral();
    const opened: SessionStub[] = [];
    for (let index = 0; index < 3; index += 1) {
      const active = session(`s${index}`);
      opened.push(active);
      slot = reduceSurfaceState(slot, openReady(index + 1, index + 2, active)).slot;
    }
    assert.equal(slot.retiring.length, 2, 'superseded sessions are held, not dropped');
    const settled = reduceSurfaceState(slot, commit(4));
    assert.deepEqual(new Set(settled.disposable), new Set([opened[0], opened[1]]));
    assert.equal(settled.slot.retiring.length, 0);
  });

  it('a stale asset-ready cannot replace the current request', () => {
    const loading = reduceSurfaceState(neutral(), openLoading(5, 2, session('placeholder'))).slot;
    const stale = reduceSurfaceState(loading, {
      kind: 'asset-ready',
      requestId: 4,
      generation: 9,
      session: session('stale-real') as never,
      assets: { descriptor: 'stale-lease' },
    });
    assert.equal(stale.slot, loading, 'stale readiness leaves the slot untouched');
    assert.equal(stale.disposable.length, 0);
  });

  it('asset-ready on a ready slot is a no-op', () => {
    const ready = reduceSurfaceState(neutral(), openReady(1, 2, session('A'))).slot;
    const late = reduceSurfaceState(ready, {
      kind: 'asset-ready',
      requestId: 1,
      generation: 5,
      session: session('B') as never,
      assets: { descriptor: 'lease' },
    });
    assert.equal(late.slot, ready);
  });

  it('readiness publishes the real session, the exact lease, and the pointer in one generation', () => {
    const loading = reduceSurfaceState(neutral(), openLoading(5, 2, session('placeholder'))).slot;
    const real = session('real');
    const assets = { descriptor: 'the-exact-lease' };
    const ready = reduceSurfaceState(loading, {
      kind: 'asset-ready',
      requestId: 5,
      generation: 3,
      session: real as never,
      assets,
    }).slot;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.session, real, 'never the placeholder');
    assert.equal(ready.assets, assets);
    assert.equal(ready.pointer, true);
    assert.deepEqual(ready.retiring.map((r) => r.session), [session('placeholder')]);
  });

  it('the neutral slot session is never retired', () => {
    const open = reduceSurfaceState(neutral(), openReady(1, 2, session('A'))).slot;
    const closed = reduceSurfaceState(open, {
      kind: 'close',
      generation: 3,
      neutralSession: NEUTRAL_SESSION as never,
      neutralRenderer: RENDERER,
    }).slot;
    const b = session('B');
    const reopened = reduceSurfaceState(closed, openReady(2, 4, b)).slot;
    assert.ok(
      !reopened.retiring.some(
        (record) => (record.session as unknown as SessionStub) === NEUTRAL_SESSION,
      ),
      'the neutral singleton is never retired',
    );
    assert.deepEqual(
      reopened.retiring.map((record) => record.session),
      [session('A')],
      'only the closed game awaits its commit',
    );
    assert.equal(reopened.session, b);
  });

  it('close is idempotent', () => {
    const base = neutral();
    const closed = reduceSurfaceState(base, {
      kind: 'close',
      generation: 2,
      neutralSession: NEUTRAL_SESSION as never,
      neutralRenderer: RENDERER,
    });
    assert.equal(closed.slot, base, 'closing Home is a no-op');
  });

  it('run attach advances the generation and retires only the replaced run', () => {
    const lab = reduceSurfaceState(neutral(), openReady(1, 2, session('base'), 'perf-lab')).slot;
    const run1Session = session('run1');
    const run2Session = session('run2');
    const run1 = attachment(run1Session);
    const attached1 = reduceSurfaceState(lab, { kind: 'run-attached', generation: 3, attachment: run1 });
    assert.equal(attached1.slot.run, run1);
    const run2 = attachment(run2Session);
    const attached2 = reduceSurfaceState(attached1.slot, { kind: 'run-attached', generation: 4, attachment: run2 });
    assert.deepEqual(
      attached2.slot.retiring.map((r) => r.session),
      [run1Session],
      'only the replaced run retires; the base lab session stays',
    );
    const detached = reduceSurfaceState(attached2.slot, {
      kind: 'run-detached',
      generation: 5,
      session: run2Session as never,
    });
    assert.equal(detached.slot.run, undefined);
    assert.equal(detached.slot.retiring.length, 2);
    const settled = reduceSurfaceState(detached.slot, commit(5));
    assert.deepEqual(new Set(settled.disposable), new Set([run1Session, run2Session]));
    assert.equal(settled.slot.generation, 5);
  });

  it('detaching an unknown or already-retired run is a no-op', () => {
    const lab = reduceSurfaceState(neutral(), openReady(1, 2, session('base'), 'perf-lab')).slot;
    const stale = reduceSurfaceState(lab, {
      kind: 'run-detached',
      generation: 3,
      session: session('unknown') as never,
    });
    assert.equal(stale.slot, lab);
  });

  it('generation never resets within one controller lifetime (monotonic publishes)', () => {
    let slot = neutral();
    const generations: number[] = [slot.generation];
    const open = (requestId: number, generation: number) => {
      slot = reduceSurfaceState(slot, openReady(requestId, generation, session('A'))).slot;
      generations.push(slot.generation);
      slot = reduceSurfaceState(slot, {
        kind: 'close',
        generation: generation + 1,
        neutralSession: NEUTRAL_SESSION as never,
        neutralRenderer: RENDERER,
      }).slot;
      generations.push(slot.generation);
    };
    for (let request = 1; request <= 4; request += 1) {
      open(request, request * 2);
    }
    for (let index = 1; index < generations.length; index += 1) {
      assert.ok(
        generations[index]! > generations[index - 1]!,
        `generation ${generations[index]} must be newer than ${generations[index - 1]}`,
      );
    }
  });

  it('effectiveBinding fails close to the binding site on a disposed ready session', () => {
    const ready = reduceSurfaceState(neutral(), openReady(1, 2, session('A'))).slot;
    const poisoned: SurfaceSlot = {
      ...ready,
      session: { marker: 'poisoned', status: 'disposed' } as never,
    };
    assert.throws(() => effectiveBinding(poisoned), /disposed session bound/);
  });

  it('effectiveBinding binds the run session when attached', () => {
    const lab = reduceSurfaceState(neutral(), openReady(1, 2, session('base'), 'perf-lab')).slot;
    const runSession = session('run');
    const run = attachment(runSession);
    const attached = reduceSurfaceState(lab, { kind: 'run-attached', generation: 3, attachment: run }).slot;
    const bound = effectiveBinding(attached);
    assert.equal(bound.game, runSession);
    assert.equal(bound.pointerGame, runSession);
    assert.equal(bound.pointerEnabled, true);
  });
});
