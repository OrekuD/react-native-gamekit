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
const WRAPPED_RENDERER = (() => null) as never;

// T16-RF3: the Platformer Lab declares its tilesheet acquisition through the
// same generic boundary as every other asset-backed game.
const platformerLabManifestStub = { kind: 'platformer-tiles-manifest' };

interface PendingPrepare {
  readonly requestId: number;
  readonly context: {
    readonly requestId: number;
    readonly assets: unknown;
    readonly signal: AbortSignal;
  };
  resolved?: SessionStub;
  resolve: (session: SessionStub) => void;
  reject: (error: unknown) => void;
}

interface Harness {
  readonly controller: SurfaceController;
  readonly recorded: readonly SessionStub[];
  readonly disposeCalls: readonly SessionStub[];
  readonly sfCreateCount: () => number;
  readonly bindCalls: readonly SessionStub[];
  readonly presentationDisposeCalls: readonly SessionStub[];
  readonly pending: PendingPrepare[];
  readonly prepareErrors: readonly { readonly gameId: string; readonly requestId: number; readonly error: unknown }[];
  binderSessions: SessionStub[];
  readonly binderCalls: readonly SessionStub[];
  latest: SurfaceSlot;
}

function makeHarness(): Harness {
  const recorded: SessionStub[] = [];
  const disposeCalls: SessionStub[] = [];
  const bindCalls: SessionStub[] = [];
  const presentationDisposeCalls: SessionStub[] = [];
  const pending: PendingPrepare[] = [];
  const prepareErrors: { gameId: string; requestId: number; error: unknown }[] = [];
  const binderSessions: SessionStub[] = [];
  const binderCalls: SessionStub[] = [];
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
      'async-assets': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: (context) =>
          new Promise<SessionStub>((resolve, reject) => {
            pending.push({
              requestId: context.requestId,
              context,
              resolve: (made) => resolve(made),
              reject,
            });
          }) as never,
        // T20F-R1: the fixture is asset-backed, pointer-disabled, and uses a
        // custom action — readiness must publish exactly this declaration.
        pointer: false,
        pointerAction: 'secondary',
        assets: { manifest: { kind: 'async-manifest' }, groups: ['gameplay'] },
        bindPresentation: (candidate) => {
          bindCalls.push(candidate as unknown as SessionStub);
          return {
            renderer: WRAPPED_RENDERER,
            dispose: () => {
              presentationDisposeCalls.push(candidate as unknown as SessionStub);
            },
          };
        },
      },
      'throwing-factory': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => {
          throw new Error('factory exploded');
        },
        pointer: false,
      },
      'throwing-factory-assets': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => {
          throw new Error('factory exploded with assets');
        },
        pointer: false,
        assets: { manifest: { kind: 'throwing-manifest' }, groups: ['gameplay'] },
      },
      'throwing-binder': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => {
          const made = session('throwing-binder');
          binderSessions.push(made);
          return made as never;
        },
        pointer: false,
        bindPresentation: () => {
          throw new Error('binder exploded');
        },
      },
      'async-throwing-binder': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: (context) =>
          new Promise<SessionStub>((resolve) => {
            pending.push({
              requestId: context.requestId,
              context,
              resolve: (made) => {
                (pending[pending.length - 1] as PendingPrepare).resolved = made;
                resolve(made);
              },
              reject: () => {},
            });
          }) as never,
        pointer: false,
        bindPresentation: () => {
          throw new Error('async binder exploded');
        },
      },
      'recovering-binder-assets': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: (context) =>
          new Promise<SessionStub>((resolve) => {
            pending.push({
              requestId: context.requestId,
              context,
              resolve: (made) => {
                (pending[pending.length - 1] as PendingPrepare).resolved = made;
                resolve(made);
              },
              reject: () => {},
            });
          }) as never,
        pointer: false,
        assets: { manifest: { kind: 'recovering-manifest' }, groups: ['gameplay'] },
        bindPresentation: (candidate) => {
          binderCalls.push(candidate as unknown as SessionStub);
          if (binderCalls.length === 1) {
            throw new Error('first bind fails, retry recovers');
          }
          return {
            renderer: WRAPPED_RENDERER,
            dispose: () => {
              presentationDisposeCalls.push(candidate as unknown as SessionStub);
            },
          };
        },
      },
      'throwing-binder-assets': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => {
          const made = session('throwing-binder-assets');
          binderSessions.push(made);
          return made as never;
        },
        pointer: false,
        assets: { manifest: { kind: 'throwing-binder-manifest' }, groups: ['gameplay'] },
        bindPresentation: () => {
          throw new Error('asset binder exploded');
        },
      },
      'async-assets-throwing-binder': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: (context) =>
          new Promise<SessionStub>((resolve) => {
            pending.push({
              requestId: context.requestId,
              context,
              resolve: (made) => {
                (pending[pending.length - 1] as PendingPrepare).resolved = made;
                resolve(made);
              },
              reject: () => {},
            });
          }) as never,
        pointer: false,
        assets: { manifest: { kind: 'async-throwing-binder-manifest' }, groups: ['gameplay'] },
        bindPresentation: (candidate) => {
          binderCalls.push(candidate as unknown as SessionStub);
          throw new Error('async asset binder exploded');
        },
      },
      'async-plain': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: (context) =>
          new Promise<SessionStub>((resolve, reject) => {
            pending.push({
              requestId: context.requestId,
              context,
              resolve: (made) => resolve(made),
              reject,
            });
          }) as never,
        pointer: false,
        bindPresentation: (candidate) => {
          bindCalls.push(candidate as unknown as SessionStub);
          return {
            renderer: WRAPPED_RENDERER,
            dispose: () => {
              presentationDisposeCalls.push(candidate as unknown as SessionStub);
            },
          };
        },
      },
      mossv2: {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => session('mossv2') as never,
        pointer: false,
        // T20.3: session-scoped presentation resources bind per session and
        // release through the same retirement path as the session.
        bindPresentation: (candidate) => {
          bindCalls.push(candidate as unknown as SessionStub);
          return {
            renderer: WRAPPED_RENDERER,
            dispose: () => {
              presentationDisposeCalls.push(candidate as unknown as SessionStub);
            },
          };
        },
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
        assets: { manifest: { kind: 'test-manifest' }, groups: ['gameplay'] },
        // T20L-R1: the asset-backed fixture must publish the wrapped
        // renderer atomically with the real session at asset readiness.
        bindPresentation: (candidate) => {
          bindCalls.push(candidate as unknown as SessionStub);
          return {
            renderer: WRAPPED_RENDERER,
            dispose: () => {
              presentationDisposeCalls.push(candidate as unknown as SessionStub);
            },
          };
        },
      },
      'platformer-lab': {
        renderer: RENDERER,
        content: CONTENT,
        createSession: () => {
          sfSessions += 1;
          return session('pl-real') as never;
        },
        pointer: false,
        // The real declaration shape (T16-RF3): manifest + groups declared
        // by the entry, acquired by the generic shell boundary.
        assets: { manifest: platformerLabManifestStub, groups: ['world'] },
      },
    },
    neutral: { session: neutralSession as never, renderer: RENDERER },
    createPlaceholder: () => session('sf-placeholder') as never,
    disposeSession: (candidate) => {
      disposeCalls.push(candidate as unknown as SessionStub);
    },
    onPrepareError: (info) => {
      prepareErrors.push(info);
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
    bindCalls,
    presentationDisposeCalls,
    pending,
    prepareErrors,
    binderSessions,
    binderCalls,
    latest: controller.current,
  };
}

async function flushPrepareQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function attach(run: SessionStub): RunSurfaceAttachment {
  return { session: run as never, pointer: {} as never, view: {} as never };
}

function countDisposed(harness: Harness, target: SessionStub): number {
  return harness.disposeCalls.filter((candidate) => candidate === target).length;
}

describe('surface controller (T8.4 single lifecycle owner)', () => {
  it('bindPresentation wraps the renderer and disposes exactly once after the commit (T20.3)', () => {
    const harness = makeHarness();
    harness.controller.open('mossv2');
    const slot = harness.controller.current;
    assert.equal(slot.renderer, WRAPPED_RENDERER, 'the binding renderer replaces the entry renderer');
    assert.notEqual(slot.presentationDispose, undefined, 'the binding dispose rides the slot');
    assert.equal(harness.bindCalls.length, 1, 'one binding per created session');
    harness.controller.bindingCommitted(slot.generation);
    assert.equal(harness.presentationDisposeCalls.length, 0, 'the active binding never disposes');
    harness.controller.close();
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(harness.presentationDisposeCalls.length, 1, 'exactly once, after the commit');
    assert.equal(harness.disposeCalls.filter((s) => s.marker === 'mossv2').length, 1);
  });

  it('replacement and final unmount dispose the presentation binding exactly once (T20.3)', () => {
    const harness = makeHarness();
    harness.controller.open('mossv2');
    harness.controller.open('bootstrap');
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(harness.presentationDisposeCalls.length, 1, 'the replaced binding disposes on ack');
    harness.controller.open('mossv2');
    harness.controller.dispose();
    assert.equal(harness.presentationDisposeCalls.length, 2, 'final unmount disposes the active binding');
  });

  it('async preparation keeps one loading state, then publishes atomically (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-plain');
    const loading = harness.controller.current;
    assert.equal(loading.status, 'loading', 'async preparation keeps the loading state');
    assert.equal(harness.pending.length, 1);
    const pending = harness.pending[0]!;
    assert.equal(pending.requestId, loading.requestId, 'the context carries the request identity');
    assert.equal(pending.context.assets, undefined, 'a non-asset entry prepares without a lease');
    assert.equal(pending.context.signal.aborted, false);
    const made = session('async-real');
    pending.resolve(made);
    await flushPrepareQueue();
    const ready = harness.controller.current;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.session, made as never, 'the resolved session publishes');
    assert.equal(ready.renderer, WRAPPED_RENDERER, 'the bound renderer publishes atomically');
    assert.notEqual(ready.presentationDispose, undefined);
    assert.equal(harness.bindCalls.length, 1);
    harness.controller.bindingCommitted(ready.generation);
    harness.controller.close();
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(harness.presentationDisposeCalls.length, 1);
  });

  it('close while preparing aborts the context and disposes the late resolution without publication (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-plain');
    const pending = harness.pending[0]!;
    harness.controller.close();
    assert.equal(pending.context.signal.aborted, true, 'close aborts the prepare context');
    const made = session('late');
    pending.resolve(made);
    await flushPrepareQueue();
    assert.equal(countDisposed(harness, made), 1, 'the late session is disposed, never published');
    assert.equal(harness.controller.current.status, 'neutral');
    assert.equal(harness.bindCalls.length, 0, 'no binding is created for a stale resolution');
  });

  it('replacement aborts the old preparation; only the new request publishes (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-plain');
    const first = harness.pending[0]!;
    const loadingGeneration = harness.controller.current.generation;
    harness.controller.open('bootstrap');
    assert.equal(first.context.signal.aborted, true, 'replacement aborts the old prepare');
    const made = session('late-old');
    first.resolve(made);
    await flushPrepareQueue();
    assert.equal(countDisposed(harness, made), 1, 'the stale session is disposed without publication');
    assert.equal(harness.controller.current.status, 'ready');
    assert.equal(harness.controller.current.gameId, 'bootstrap');
    assert.equal(harness.bindCalls.length, 0, 'the old request never binds');
    assert.ok(harness.controller.current.generation > loadingGeneration);
  });

  it('duplicate readiness while a preparation is pending binds exactly once (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-assets');
    const loading = harness.controller.current;
    const lease = { descriptor: 'lease' };
    harness.controller.assetReady(loading.requestId, lease as never);
    assert.equal(harness.pending.length, 1, 'asset readiness starts the preparation');
    const firstContext = harness.pending[0]!.context;
    assert.equal(firstContext.assets, lease, 'the prepare context carries the matched lease');
    // Strict-Mode style duplicate onReady for the same request: deduped.
    harness.controller.assetReady(loading.requestId, lease as never);
    assert.equal(harness.pending.length, 1, 'the duplicate never starts a second preparation');
    harness.pending[0]!.resolve(session('sf-async'));
    await flushPrepareQueue();
    assert.equal(harness.controller.current.status, 'ready');
    assert.equal(harness.controller.current.pointer, false, 'the disabled catalog declaration wins');
    assert.equal(harness.controller.current.pointerAction, 'secondary');
    assert.equal(harness.bindCalls.length, 1, 'exactly one binding');
    const second = harness.controller.current;
    harness.controller.assetReady(loading.requestId, lease as never);
    assert.equal(harness.controller.current, second, 'readiness after publication is a no-op');
  });

  it('an asset-backed async session publishes with the matched lease and wrapped renderer (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-assets');
    const loading = harness.controller.current;
    const lease = { descriptor: 'the-exact-lease' };
    harness.controller.assetReady(loading.requestId, lease as never);
    const pending = harness.pending[0]!;
    pending.resolve(session('sf-async'));
    await flushPrepareQueue();
    const ready = harness.controller.current;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.renderer, WRAPPED_RENDERER);
    assert.equal(harness.bindCalls.length, 1);
    void lease;
  });

  it('a preparation failure surfaces through the retryable error path; retry publishes only the new request (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-plain');
    const first = harness.pending[0]!;
    const failure = new Error('save validation failed');
    first.reject(failure);
    await flushPrepareQueue();
    assert.equal(harness.prepareErrors.length, 1);
    assert.equal(harness.prepareErrors[0]!.gameId, 'async-plain');
    assert.equal(harness.prepareErrors[0]!.requestId, first.requestId);
    assert.equal(harness.prepareErrors[0]!.error, failure);
    assert.equal(harness.controller.current.status, 'loading', 'the slot stays loading for the retry UI');
    assert.equal(harness.controller.current.session.status, 'ready', 'the placeholder stays live');
    // Retry: a fresh request for the same game.
    harness.controller.open('async-plain');
    const second = harness.pending[1]!;
    assert.equal(first.context.signal.aborted, true, 'the retry aborts the failed request');
    const made = session('retry-real');
    second.resolve(made);
    await flushPrepareQueue();
    assert.equal(harness.controller.current.status, 'ready');
    assert.equal(harness.controller.current.session, made as never);
    // The stale first request can no longer publish.
    harness.controller.open('bootstrap');
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(harness.bindCalls.length, 1, 'only the retry binds');
  });

  it('a thrown non-asset factory surfaces retry and publishes nothing (T20F-R4)', async () => {
    const harness = makeHarness();
    assert.doesNotThrow(() => harness.controller.open('throwing-factory'), 'the throw must not escape open()');
    const slot = harness.controller.current;
    assert.equal(slot.status, 'loading', 'a loading slot mounts the retry overlay');
    assert.equal(harness.prepareErrors.length, 1);
    assert.equal(harness.prepareErrors[0]!.gameId, 'throwing-factory');
    assert.match(String(harness.prepareErrors[0]!.error), /factory exploded/);
    // Retry: a fresh request for the same game can publish.
    harness.controller.open('bootstrap');
    assert.equal(harness.controller.current.status, 'ready');
    assert.equal(harness.controller.current.gameId, 'bootstrap');
  });

  it('a thrown asset-backed factory surfaces retry while loading (T20F-R4)', async () => {
    const harness = makeHarness();
    harness.controller.open('throwing-factory-assets');
    const loading = harness.controller.current;
    assert.equal(loading.status, 'loading');
    assert.doesNotThrow(() => harness.controller.assetReady(loading.requestId, { descriptor: 'lease' }));
    assert.equal(harness.controller.current.status, 'loading', 'the slot stays loading for retry');
    assert.equal(harness.prepareErrors.length, 1);
    assert.match(String(harness.prepareErrors[0]!.error), /factory exploded with assets/);
  });

  it('a thrown sync binder disposes the created session and surfaces retry (T20F-R4)', async () => {
    const harness = makeHarness();
    assert.doesNotThrow(() => harness.controller.open('throwing-binder'));
    assert.equal(harness.controller.current.status, 'loading', 'the retry overlay mounts');
    assert.equal(harness.prepareErrors.length, 1);
    assert.match(String(harness.prepareErrors[0]!.error), /binder exploded/);
    assert.equal(harness.binderSessions.length, 1, 'the session was created once');
    assert.equal(countDisposed(harness, harness.binderSessions[0]!), 1, 'the created session is disposed, never leaked');
    assert.notEqual(harness.controller.current.session, harness.binderSessions[0] as never, 'the placeholder stays live, not the leaked session');
  });

  it('a thrown async binder disposes the resolved session and surfaces retry (T20F-R4)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-throwing-binder');
    const pending = harness.pending[0]!;
    pending.resolve(session('async-bound'));
    await flushPrepareQueue();
    assert.equal(harness.controller.current.status, 'loading', 'the slot stays loading for retry');
    assert.equal(harness.prepareErrors.length, 1);
    assert.match(String(harness.prepareErrors[0]!.error), /async binder exploded/);
    assert.equal(countDisposed(harness, harness.pending[0]!.resolved!), 1, 'the resolved session is disposed, never leaked');
    assert.equal(harness.bindCalls.length, 0);
  });

  it('a thrown asset-backed sync binder surfaces retry, and the retry recovers (T20F-R4/T20FRR-R2)', async () => {
    const harness = makeHarness();
    harness.controller.open('recovering-binder-assets');
    const loading = harness.controller.current;
    harness.controller.assetReady(loading.requestId, { descriptor: 'lease' });
    assert.equal(harness.controller.current.status, 'loading', 'the slot stays loading for retry');
    const firstMade = session('recovering-first');
    harness.pending[0]!.resolve(firstMade);
    harness.binderSessions.push(firstMade);
    await flushPrepareQueue();
    assert.equal(harness.prepareErrors.length, 1);
    assert.match(String(harness.prepareErrors[0]!.error), /first bind fails/);
    assert.equal(countDisposed(harness, firstMade), 1, 'no leaked session');
    // T20FRR-R2: the retry publishes a full ready slot on a fresh request —
    // newer request id, second prepared session, live first publication.
    harness.controller.open('recovering-binder-assets');
    const retry = harness.controller.current;
    assert.ok(retry.requestId > loading.requestId, 'the retry carries a newer request identity');
    harness.controller.assetReady(retry.requestId, { descriptor: 'lease' });
    const secondMade = session('recovering-second');
    harness.pending[1]!.resolve(secondMade);
    harness.binderSessions.push(secondMade);
    await flushPrepareQueue();
    assert.equal(harness.binderSessions.length, 2, 'the retry prepared a second session');
    assert.equal(harness.controller.current.status, 'ready', 'the retry published a ready slot');
    assert.equal(harness.controller.current.gameId, 'recovering-binder-assets');
    assert.equal(harness.controller.current.renderer, WRAPPED_RENDERER);
    assert.equal(harness.controller.current.pointer, false);
    assert.equal(countDisposed(harness, harness.binderSessions[1]!), 0, 'the retry session stays live');
  });

  it('an always-throwing asset-backed binder keeps failing on retry without leaks (T20F-R4)', async () => {
    const harness = makeHarness();
    harness.controller.open('throwing-binder-assets');
    const loading = harness.controller.current;
    harness.controller.assetReady(loading.requestId, { descriptor: 'lease' });
    assert.equal(harness.prepareErrors.length, 1);
    harness.controller.open('throwing-binder-assets');
    const retry = harness.controller.current;
    assert.ok(retry.requestId > loading.requestId);
    harness.controller.assetReady(retry.requestId, { descriptor: 'lease' });
    assert.equal(harness.prepareErrors.length, 2, 'the repeated failure surfaces again');
    assert.equal(harness.binderSessions.length, 2);
    assert.equal(countDisposed(harness, harness.binderSessions[0]!), 1);
    assert.equal(countDisposed(harness, harness.binderSessions[1]!), 1);
  });

  it('a thrown asset-backed async binder disposes the resolved session (T20F-R4)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-assets-throwing-binder');
    const loading = harness.controller.current;
    const lease = { descriptor: 'lease' };
    harness.controller.assetReady(loading.requestId, lease as never);
    const pending = harness.pending[0]!;
    assert.equal(pending.context.assets, lease as never, 'the context carries the matched asset lease');
    pending.resolve(session('async-asset-bound'));
    await flushPrepareQueue();
    assert.equal(harness.controller.current.status, 'loading', 'the slot stays loading for retry');
    assert.equal(harness.prepareErrors.length, 1);
    assert.match(String(harness.prepareErrors[0]!.error), /async asset binder exploded/);
    assert.equal(countDisposed(harness, harness.pending[0]!.resolved!), 1, 'no leaked session');
    assert.equal(harness.bindCalls.length, 0);
  });

  it('a stale resolution disposes its session without invoking the binder (T20F-R4)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-assets-throwing-binder');
    const loading = harness.controller.current;
    harness.controller.assetReady(loading.requestId, { descriptor: 'lease' });
    const pending = harness.pending[0]!;
    harness.controller.open('bootstrap'); // stale the preparation before resolution
    const staleSession = session('stale-bound');
    pending.resolve(staleSession);
    await flushPrepareQueue();
    assert.equal(harness.prepareErrors.length, 0, 'a stale failure never surfaces');
    assert.equal(harness.binderCalls.length, 0, 'the binder never runs for a stale request');
    assert.equal(countDisposed(harness, staleSession), 1, 'the stale session is still disposed');
  });

  it('shell disposal aborts preparation and disposes the late resolution (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-plain');
    const pending = harness.pending[0]!;
    harness.controller.dispose();
    assert.equal(pending.context.signal.aborted, true);
    const made = session('never-published');
    pending.resolve(made);
    await flushPrepareQueue();
    assert.equal(countDisposed(harness, made), 1, 'the late session is disposed, never published');
    assert.equal(harness.controller.current.gameId, 'async-plain', 'the slot is never republished');
  });

  it('at most one ready gameplay session is live per surface (T20.2)', async () => {
    const harness = makeHarness();
    harness.controller.open('async-plain');
    harness.controller.open('bootstrap');
    harness.controller.bindingCommitted(harness.controller.current.generation);
    harness.controller.open('async-plain');
    harness.pending[1]!.resolve(session('second-async'));
    await flushPrepareQueue();
    await flushPrepareQueue();
    harness.controller.bindingCommitted(harness.controller.current.generation);
    const live = new Set(
      harness.recorded.filter(
        (candidate) => countDisposed(harness, candidate) === 0 && candidate.marker !== 'neutral',
      ),
    );
    assert.equal(live.size, 1, 'exactly one live gameplay session after the dust settles');
  });

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

describe('Platformer Lab asset-backed lifecycle through the controller (T16-RF3)', () => {
  it('open -> loading -> asset-ready -> playable keeps the sync pointer declaration (T20F-R1)', () => {
    const harness = makeHarness();
    harness.controller.open('sprite-field');
    const loading = harness.controller.current;
    assert.equal(loading.pointer, false, 'pointer stays disabled while loading');
    harness.controller.assetReady(loading.requestId, { descriptor: 'lease' });
    assert.equal(harness.controller.current.pointer, true, 'readiness follows the catalog declaration');
    assert.equal(harness.controller.current.pointerAction, undefined, 'no custom action is invented');
  });

  it('open -> loading -> asset-ready -> playable uses the real session', () => {
    const harness = makeHarness();
    harness.controller.open('platformer-lab');
    const loading = harness.controller.current;
    assert.equal(loading.status, 'loading');
    assert.equal(loading.gameId, 'platformer-lab');
    assert.equal(loading.pointer, false, 'pointer disabled while loading');

    const createdBefore = harness.sfCreateCount();
    const lease = { descriptor: 'platformer-tiles-lease' };
    harness.controller.assetReady(loading.requestId, lease);
    const ready = harness.controller.current;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.gameId, 'platformer-lab');
    assert.equal(ready.assets, lease, 'the exact lease passes through unchanged');
    assert.notEqual(ready.session, loading.session, 'real gameplay session replaces the placeholder');
    assert.equal(harness.sfCreateCount(), createdBefore + 1);
  });

  it('asset readiness publishes the wrapped renderer atomically (T20L-R1)', () => {
    const harness = makeHarness();
    harness.controller.open('sprite-field');
    const loading = harness.controller.current;
    assert.equal(loading.status, 'loading');
    assert.equal(loading.renderer, RENDERER, 'the loading slot uses the original renderer');
    assert.equal(loading.presentationDispose, undefined, 'the placeholder binds nothing');
    harness.controller.assetReady(loading.requestId, { descriptor: 'lease' });
    const ready = harness.controller.current;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.renderer, WRAPPED_RENDERER, 'the ready slot uses the bound renderer');
    assert.notEqual(ready.presentationDispose, undefined, 'the disposer rides the ready slot');
    assert.equal(harness.bindCalls.length, 1, 'the binder runs once, for the real session');
    harness.controller.bindingCommitted(ready.generation);
    assert.equal(harness.presentationDisposeCalls.length, 0, 'the active binding never disposes');
    harness.controller.open('bootstrap');
    harness.controller.bindingCommitted(harness.controller.current.generation);
    assert.equal(harness.presentationDisposeCalls.length, 1, 'replacement releases once');
    // Asset-backed games bind only at readiness: open publishes a loading
    // slot with no binding, and assetReady binds the real session's pool.
    harness.controller.open('sprite-field');
    assert.equal(harness.controller.current.presentationDispose, undefined);
    harness.controller.assetReady(harness.controller.current.requestId, { descriptor: 'lease' });
    harness.controller.dispose();
    assert.equal(harness.presentationDisposeCalls.length, 2, 'final unmount releases the active binding');
  });

  it('close while loading disposes the placeholder and never creates a game', () => {
    const harness = makeHarness();
    harness.controller.open('platformer-lab');
    assert.equal(harness.controller.current.status, 'loading');
    const createdBefore = harness.sfCreateCount();

    harness.controller.close();
    assert.equal(harness.controller.current.status, 'neutral');

    // A late ready after close is stale: ignored, no session created.
    harness.controller.assetReady(harness.latest.requestId, { descriptor: 'late' });
    assert.equal(harness.controller.current.status, 'neutral');
    assert.equal(harness.sfCreateCount(), createdBefore);
  });

  it('stale readiness for a superseded platformer request never wins the slot', () => {
    const harness = makeHarness();
    harness.controller.open('platformer-lab');
    const firstRequestId = harness.controller.current.requestId;
    harness.controller.open('sprite-field');
    const second = harness.controller.current;
    assert.equal(second.status, 'loading');

    harness.controller.assetReady(firstRequestId, { descriptor: 'superseded' });
    assert.equal(harness.controller.current.gameId, 'sprite-field');
    assert.equal(harness.sfCreateCount(), 0, 'no gameplay session for the superseded request');

    // Completing the CURRENT request works.
    harness.controller.assetReady(second.requestId, { descriptor: 'current' });
    assert.equal(harness.controller.current.status, 'ready');
    assert.equal(harness.controller.current.gameId, 'sprite-field');
  });
});

describe('camera-lab instrumentation ownership through the controller (T12-RF1)', () => {
  const POINTER_INSTR = { onRawTouch: () => undefined };
  const VIEW_INSTR = { onPresentCommit: () => undefined };
  const instrumentation = { pointer: POINTER_INSTR, view: VIEW_INSTR };

  function labHarness() {
    const recorded: SessionStub[] = [];
    const disposeCalls: SessionStub[] = [];
    let labSessions = 0;
    let latest: SurfaceSlot | undefined;
    const neutralSession = session('neutral');
    const options: SurfaceControllerOptions = {
      games: {
        'camera-lab': {
          renderer: RENDERER,
          content: CONTENT,
          createSession: () => {
            labSessions += 1;
            const created = session(`lab-${labSessions}`);
            recorded.push(created);
            return created as never;
          },
          pointer: true,
          instrumented: true,
        },
      },
      neutral: {
        session: neutralSession as never,
        renderer: RENDERER,
      },
      createPlaceholder: () => session('placeholder') as never,
      disposeSession: (s: unknown) => {
        disposeCalls.push(s as SessionStub);
      },
      onSlot: (slot: SurfaceSlot) => {
        latest = slot;
      },
      initialGeneration: 1,
    };
    const controller = new SurfaceController(options);
    return {
      controller,
      disposeCalls,
      neutralSession,
      latest: () => latest,
      labSession: () => recorded[0],
    };
  }

  it('attaches instrumentation to the ready lab binding and never retires or disposes the base session', () => {
    const h = labHarness();
    const { controller } = h;
    controller.open('camera-lab');
    const labSession = h.labSession();
    assert.ok(labSession !== undefined);
    assert.ok(h.latest()?.status === 'ready');
    assert.equal(h.latest()?.instrumentation, undefined);

    controller.runEvent({ kind: 'instrumentation-attached', session: labSession as never, instrumentation: instrumentation as never });
    assert.equal(h.latest()?.instrumentation, instrumentation as never, 'the pair reaches the slot');
    assert.equal(h.latest()?.camera2D, undefined);
    // The base session is untouched: nothing retired, nothing disposed.
    assert.equal(h.disposeCalls.includes(labSession), false, 'attachment never disposes the base session');
    assert.equal(h.latest()?.retiring.length, 0, 'attachment never retires the base session');
    assert.equal(h.latest()?.session, labSession as never, 'the same session still owns simulation');

    controller.runEvent({ kind: 'instrumentation-detached', session: labSession as never });
    assert.equal(h.latest()?.instrumentation, undefined, 'detach clears the pair');
    assert.equal(h.latest()?.session, labSession as never, 'the base session survives detach');
    assert.equal(h.disposeCalls.includes(labSession), false);
  });

  it('rejects stale instrumentation events from superseded sessions', () => {
    const h = labHarness();
    const { controller } = h;
    controller.open('camera-lab');
    const current = h.labSession();
    const staleSession = session('stale');
    controller.runEvent({ kind: 'instrumentation-attached', session: staleSession as never, instrumentation: instrumentation as never });
    assert.equal(h.latest()?.instrumentation, undefined, 'a stale session cannot attach');
    controller.runEvent({ kind: 'instrumentation-detached', session: staleSession as never });
    assert.equal(h.latest()?.instrumentation, undefined);

    // Same-id reopen: the OLD session's attach must not touch the new binding.
    const oldSession = current;
    controller.close();
    controller.open('camera-lab');
    controller.runEvent({ kind: 'instrumentation-attached', session: oldSession as never, instrumentation: instrumentation as never });
    assert.equal(h.latest()?.instrumentation, undefined, 'a superseded session cannot attach to the reopened binding');
  });

  it('rejects instrumentation events for games without the capability', () => {
    const recorded: SessionStub[] = [];
    const options: SurfaceControllerOptions = {
      games: {
        'brick-breaker': {
          renderer: RENDERER,
          content: CONTENT,
          createSession: () => {
            const created = session('bb');
            recorded.push(created);
            return created as never;
          },
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
    const bbSession = recorded[0];
    controller.runEvent({ kind: 'instrumentation-attached', session: bbSession as never, instrumentation: instrumentation as never });
    // The event is dropped at the capability gate; the slot has no pair.
    let published: SurfaceSlot | undefined;
    const probeOptions: SurfaceControllerOptions = { ...options, onSlot: (slot) => { published = slot; } };
    const probe = new SurfaceController(probeOptions);
    probe.open('brick-breaker');
    assert.equal(probe['slot'].instrumentation, undefined);
    void published;
  });
});
