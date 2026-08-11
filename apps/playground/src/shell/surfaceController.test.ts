import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SurfaceController,
  type SurfaceControllerOptions,
} from './surfaceController.ts';
import type { RunSurfaceAttachment, SurfaceSlot } from './surfaceSlot.ts';

/**
 * Task 8 controller tests (T8.0 RED / T8.4).
 *
 * These drive the real `SurfaceController` class the production shell
 * instantiates — the same allocation, retirement, and disposal code paths —
 * with fake game entries and a recording disposer. There is no lookalike
 * implementation.
 */

type SessionStub = {
  readonly marker: string;
  status: 'ready' | 'disposed';
  pauseCalls: number;
};

function session(marker: string): SessionStub {
  return { marker, status: 'ready', pauseCalls: 0 };
}

const RENDERER = (() => null) as never;
const CONTENT = (() => null) as never;

interface Harness {
  readonly controller: SurfaceController;
  readonly recorded: readonly SessionStub[];
  readonly disposeCalls: readonly SessionStub[];
  readonly sfCreateCount: () => number;
  latest: SurfaceSlot;
}

function makeHarness(): Harness {
  const recorded: SessionStub[] = [];
  const disposeCalls: SessionStub[] = [];
  let sfSessions = 0;
  let harness: Harness | undefined;
  const neutralSession = session('neutral');
  const options: SurfaceControllerOptions = {
    games: {
      'brick-breaker': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => session('bb') as never,
        pointer: true,
      },
      bootstrap: {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => session('bootstrap') as never,
        pointer: false,
      },
      'perf-lab': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => session('lab-base') as never,
        pointer: true,
      },
      'sprite-field': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => {
          sfSessions += 1;
          return session('sf-real') as never;
        },
        pointer: true,
        assetBacked: true,
      },
    },
    neutral: { session: neutralSession as never, renderer: RENDERER },
    createPlaceholder: () => session('sf-placeholder') as never,
    disposeSession: (candidate) => {
      disposeCalls.push(candidate as unknown as SessionStub);
    },
    onSlot: (slot) => {
      recorded.push(slot.session as unknown as SessionStub);
      if (harness !== undefined) {
        harness.latest = slot;
      }
    },
    initialGeneration: 1,
  };
  const controller = new SurfaceController(options);
  return {
    controller,
    recorded,
    disposeCalls,
    sfCreateCount: () => sfSessions,
    latest: controller.current,
  };
}

function attach(run: SessionStub): RunSurfaceAttachment {
  return { session: run as never, pointer: {} as never, view: {} as never };
}

function countDisposed(harness: Harness, target: SessionStub): number {
  return harness.disposeCalls.filter((candidate) => candidate === target).length;
}

describe('surface controller (T8.4 single lifecycle owner)', () => {
  it('open creates a fresh session and publishes a ready slot for non-asset games', () => {
    const harness = makeHarness();
    harness.controller.open('brick-breaker');
    const slot = harness.controller.current;
    assert.equal(slot.status, 'ready');
    assert.equal(slot.gameId, 'brick-breaker');
    assert.equal(slot.pointer, true);
    assert.equal(slot.session, harness.recorded.at(-1), 'the published session is the created one');
  });

  it('reopening the same game binds a new session on the first open of the reopened game', () => {
    const harness = makeHarness();
    harness.controller.open('brick-breaker');
    const first = harness.controller.current;
    harness.controller.bindingCommitted(first.generation);
    harness.controller.close();
    harness.controller.bindingCommitted(harness.controller.current.generation);
    harness.controller.open('brick-breaker');
    const second = harness.controller.current;
    assert.notEqual(second.session, first.session, 'a fresh session is created and bound');
    assert.ok(second.requestId > first.requestId, 'request identity never repeats');
    assert.ok(second.generation > first.generation, 'generation never resets');
  });

  it('the prior session stays alive while bound and disposes exactly once after the commit', () => {
    const harness = makeHarness();
    harness.controller.open('brick-breaker');
    const first = harness.controller.current;
    harness.controller.open('bootstrap');
    assert.equal(countDisposed(harness, first.session as never), 0, 'still bound: not disposed');
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(countDisposed(harness, first.session as never), 1, 'disposed exactly once after commit');
  });

  it('closing publishes the neutral binding, then disposes the game only after acknowledgment', () => {
    const harness = makeHarness();
    harness.controller.open('brick-breaker');
    const game = harness.controller.current;
    harness.controller.close();
    const closed = harness.controller.current;
    assert.equal(closed.status, 'neutral');
    assert.equal(closed.requestId, 0);
    assert.equal(countDisposed(harness, game.session as never), 0, 'neutral published, game still owned');
    harness.controller.bindingCommitted(closed.generation);
    assert.equal(countDisposed(harness, game.session as never), 1);
  });

  it('asset-backed open publishes loading; readiness creates the gameplay session; stale readiness never does', () => {
    const harness = makeHarness();
    harness.controller.open('sprite-field');
    const loading = harness.controller.current;
    assert.equal(loading.status, 'loading');
    assert.equal(loading.pointer, false, 'pointer disabled while loading');
    const createdBefore = harness.sfCreateCount();

    // Supersede the request, then deliver its late readiness.
    harness.controller.open('brick-breaker');
    harness.controller.assetReady(loading.requestId, { descriptor: 'late-lease' });
    assert.equal(harness.controller.current.gameId, 'brick-breaker', 'stale readiness cannot replace the slot');
    assert.equal(harness.sfCreateCount(), createdBefore, 'no gameplay session was created for the stale request');
  });

  it('asset-backed readiness for the current request publishes session + lease + pointer', () => {
    const harness = makeHarness();
    harness.controller.open('sprite-field');
    const loading = harness.controller.current;
    const assets = { descriptor: 'lease' };
    harness.controller.assetReady(loading.requestId, assets);
    const ready = harness.controller.current;
    assert.equal(ready.status, 'ready');
    assert.notEqual(ready.session, loading.session, 'the real session, not the placeholder');
    assert.equal(ready.assets, assets);
    assert.equal(ready.pointer, true);
    assert.equal(harness.sfCreateCount(), 1);
  });

  it('rapid opens retire each superseded session exactly once after commits', () => {
    const harness = makeHarness();
    harness.controller.open('brick-breaker');
    const a = harness.controller.current;
    harness.controller.open('bootstrap');
    const b = harness.controller.current;
    harness.controller.open('brick-breaker');
    const c = harness.controller.current;
    assert.equal(countDisposed(harness, a.session as never), 0);
    assert.equal(countDisposed(harness, b.session as never), 0);
    harness.controller.bindingCommitted(c.generation);
    assert.equal(countDisposed(harness, a.session as never), 1);
    assert.equal(countDisposed(harness, b.session as never), 1);
    assert.equal(countDisposed(harness, c.session as never), 0, 'the active session is never disposed');
  });

  it('run attach/detach retire through the same acknowledgment path', () => {
    const harness = makeHarness();
    harness.controller.open('perf-lab');
    const base = harness.controller.current;
    const run1 = session('run1');
    const run2 = session('run2');
    const run1Attachment = attach(run1);
    harness.controller.runEvent({ kind: 'attach', attachment: run1Attachment });
    assert.equal(harness.controller.current.run, run1Attachment);
    harness.controller.runEvent({ kind: 'attach', attachment: attach(run2) });
    assert.equal(countDisposed(harness, run1), 0, 'replaced run held until commit');
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(countDisposed(harness, run1), 1);
    assert.equal(countDisposed(harness, base.session as never), 0, 'the base lab session is not retired by run swaps');
    harness.controller.runEvent({ kind: 'detach', session: run2 as never });
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(countDisposed(harness, run2), 1);
  });

  it('run events after close are ignored and cannot reattach a disposed run', () => {
    const harness = makeHarness();
    harness.controller.open('perf-lab');
    const run = session('run');
    harness.controller.runEvent({ kind: 'attach', attachment: attach(run) });
    harness.controller.close();
    const closed = harness.controller.current;
    assert.equal(closed.run, undefined);
    harness.controller.runEvent({ kind: 'attach', attachment: attach(run) });
    assert.equal(harness.controller.current.run, undefined, 'stale attach after close is ignored');
    harness.controller.bindingCommitted(closed.generation);
    assert.equal(countDisposed(harness, run), 1);
  });

  it('unmount disposes active, pending, neutral-owned, and retiring sessions exactly once', () => {
    const harness = makeHarness();
    harness.controller.open('sprite-field'); // pending loading placeholder
    const placeholder = harness.controller.current.session;
    harness.controller.open('brick-breaker'); // active
    const active = harness.controller.current.session;
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(countDisposed(harness, placeholder as never), 1, 'pending placeholder disposed at commit');
    harness.controller.open('bootstrap'); // retires bb without commit
    const retiring = harness.controller.current.retiring[0]?.session;
    harness.controller.dispose();
    assert.equal(countDisposed(harness, active as never), 1);
    assert.equal(countDisposed(harness, retiring as never), 1);
    assert.equal(countDisposed(harness, harness.controller.current.session as never), 1);
    assert.equal(countDisposed(harness, (harness.controller as never as { options: SurfaceControllerOptions }).options.neutral.session as never), 1);
    // Everything exactly once.
    for (const candidate of harness.disposeCalls) {
      assert.equal(countDisposed(harness, candidate), 1, `${candidate.marker} disposed once`);
    }
  });

  it('requestId and generation never reset or collide within one controller lifetime', () => {
    const harness = makeHarness();
    const requests = new Set<number>();
    const generations = new Set<number>();
    for (let cycle = 0; cycle < 25; cycle += 1) {
      harness.controller.open('brick-breaker');
      requests.add(harness.controller.current.requestId);
      generations.add(harness.controller.current.generation);
      harness.controller.close();
    }
    assert.equal(requests.size, 25, 'every open is a unique request');
    assert.equal(generations.size, 25, 'every published binding has a unique generation');
  });

  it('the controller pauses a running session before it is retired', () => {
    let paused: SessionStub | undefined;
    const options: SurfaceControllerOptions = {
      games: {
        'brick-breaker': {
          renderer: RENDERER,
          content: CONTENT,
          createSession: () =>
            ({
              marker: 'pausable',
              status: 'running',
              pauseCalls: 0,
              pause() {
                paused = this as never;
              },
            }) as never,
          pointer: true,
        },
      },
      neutral: { session: session('neutral') as never, renderer: RENDERER },
      createPlaceholder: () => session('placeholder') as never,
      disposeSession: () => undefined,
      onSlot: () => undefined,
      initialGeneration: 1,
    };
    const controller = new SurfaceController(options);
    controller.open('brick-breaker');
    controller.close();
    assert.equal(paused?.marker, 'pausable', 'the retired game is paused at the close boundary');
  });
});
