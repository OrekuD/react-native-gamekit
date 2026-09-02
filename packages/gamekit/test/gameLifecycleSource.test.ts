/**
 * T20.3 — GameLifecycleSource contract tests (written before the
 * implementation per the repo's test-first invariant).
 *
 * The source is the minimal read-only lifecycle surface presentation layers
 * consume: the current status plus transition subscription. It must never
 * expose control methods (press/start/pause/setScene) or session internals,
 * must tolerate disposed sessions, and must keep two sessions'
 * notifications from crossing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGameLifecycleSource } from '../src/react/lifecycleSource';
import type { GameSessionStatus } from '../src/core/session/types';

type StatusListener = (status: GameSessionStatus) => void;

/** Minimal GameSession stand-in: only status and addStatusListener exist. */
function fakeSession(initial: GameSessionStatus = 'idle') {
  let status = initial;
  const listeners = new Set<StatusListener>();
  return {
    get status(): GameSessionStatus {
      return status;
    },
    addStatusListener(listener: StatusListener): { remove(): void } {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    transition(next: GameSessionStatus): void {
      status = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

describe('T20.3 GameLifecycleSource', () => {
  it('getStatus reflects the current status without subscription', () => {
    const session = fakeSession('idle');
    const source = createGameLifecycleSource(session as never);
    assert.equal(source.getStatus(), 'idle');
    session.transition('running');
    assert.equal(source.getStatus(), 'running');
  });

  it('subscribe observes transitions and detach stops notifications', () => {
    const session = fakeSession('running');
    const source = createGameLifecycleSource(session as never);
    const seen: GameSessionStatus[] = [];
    const detach = source.subscribe((status) => seen.push(status));
    session.transition('paused');
    session.transition('running');
    assert.deepEqual(seen, ['paused', 'running']);
    detach();
    session.transition('paused');
    assert.deepEqual(seen, ['paused', 'running']);
  });

  it('subscribing to a disposed session returns a no-op detach without throwing', () => {
    const session = fakeSession('disposed');
    const source = createGameLifecycleSource(session as never);
    const seen: GameSessionStatus[] = [];
    const detach = source.subscribe((status) => seen.push(status));
    detach();
    detach(); // idempotent
    assert.deepEqual(seen, []);
    assert.equal(source.getStatus(), 'disposed');
  });

  it('transitions on one session never reach another source listener', () => {
    const sessionA = fakeSession('running');
    const sessionB = fakeSession('running');
    const sourceA = createGameLifecycleSource(sessionA as never);
    const sourceB = createGameLifecycleSource(sessionB as never);
    const seenA: GameSessionStatus[] = [];
    const seenB: GameSessionStatus[] = [];
    sourceA.subscribe((status) => seenA.push(status));
    sourceB.subscribe((status) => seenB.push(status));
    sessionA.transition('paused');
    sessionB.transition('disposed');
    assert.deepEqual(seenA, ['paused']);
    assert.deepEqual(seenB, ['disposed']);
  });

  it('the source is a frozen plain value with exactly the two documented members', () => {
    const source = createGameLifecycleSource(fakeSession('running') as never);
    assert.equal(Object.isFrozen(source), true);
    assert.deepEqual(Object.keys(source).sort(), ['getStatus', 'subscribe']);
  });
});
