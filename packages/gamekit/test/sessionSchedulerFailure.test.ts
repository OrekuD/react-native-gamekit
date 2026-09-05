/**
 * GS-SESSION-02 — scheduler failure leaves an honest status.
 *
 * A driver that accepts the first request and rejects the second must leave
 * no phantom running loop: the session publishes paused, the generation is
 * invalidated, and the scheduling error is preserved (never masked by a
 * throwing status listener). Recovery is explicit: `start()` works again
 * once the driver recovers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import type { FrameDriver } from '../src/core/frameDriver.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

/** A driver whose requestFrame starts failing on demand. */
class FlakyDriver implements FrameDriver {
  private requests = 0;
  constructor(
    private readonly inner: ManualFrameDriver,
    public failFromRequest = Number.POSITIVE_INFINITY,
  ) {}
  requestFrame(callback: (timestampMs: number) => void): number {
    this.requests += 1;
    if (this.requests >= this.failFromRequest) {
      throw new Error('scheduler exploded');
    }
    return this.inner.requestFrame(callback);
  }
  cancelFrame(handle: number): void {
    this.inner.cancelFrame(handle);
  }
  fireNext(timestampMs: number): void {
    this.inner.fireNext(timestampMs);
  }
}

function runningSession(flaky: FlakyDriver) {
  const game = defineGame({
    viewport,
    input: {},
    scenes: {
      main: defineScene({
        actions: [],
        create: () => ({ count: 0 }),
        update: ({ state }: { state: { readonly count: number } }) => ({
          count: state.count + 1,
        }),
        snapshot: ({ state }: { state: { readonly count: number } }) => ({
          count: state.count,
        }),
      }),
    },
    initialScene: 'main',
  });
  const session = createGameSessionWithDriver(game, {
    frameDriver: flaky,
    fixedStepMs: 10,
  });
  return session;
}

describe('GS-SESSION-02 scheduler failure', () => {
  it('a rejected successor schedule pauses the session with no phantom loop', () => {
    const inner = new ManualFrameDriver();
    const flaky = new FlakyDriver(inner, 2);
    const session = runningSession(flaky);
    session.start();

    assert.throws(() => flaky.fireNext(0), /scheduler exploded/);
    assert.equal(session.status, 'paused', 'no phantom running loop');
    assert.equal(inner.pendingCount, 0, 'no callback remains scheduled');
    session.dispose();
  });

  it('recovery by explicit start() works once the driver recovers', () => {
    const inner = new ManualFrameDriver();
    const flaky = new FlakyDriver(inner, 2);
    const session = runningSession(flaky);
    session.start();
    assert.throws(() => flaky.fireNext(0), /scheduler exploded/);
    assert.equal(session.status, 'paused');

    flaky.failFromRequest = Number.POSITIVE_INFINITY;
    session.start();
    assert.equal(session.status, 'running');
    flaky.fireNext(16);
    flaky.fireNext(32);
    assert.equal(session.getRenderFrame().tick, 1, 'frames advance again after recovery');
    flaky.fireNext(48);
    assert.equal(session.getRenderFrame().tick, 3, 'catch-up debt keeps accumulating');
    session.dispose();
  });

  it('a throwing status listener cannot mask the scheduling error', () => {
    const inner = new ManualFrameDriver();
    const flaky = new FlakyDriver(inner, 2);
    const session = runningSession(flaky);
    session.start();
    session.addStatusListener(() => {
      throw new Error('status listener exploded');
    });

    const thrown = ((): unknown => {
      try {
        flaky.fireNext(0);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.ok(thrown instanceof AggregateError, 'failures compose losslessly');
    const messages = thrown.errors.map((entry) => String((entry as Error).message ?? entry));
    assert.ok(
      messages.some((message) => message.includes('scheduler exploded')),
      'the scheduling error is preserved',
    );
    assert.equal(session.status, 'paused', 'the honest status still publishes');
    // A throwing status listener also fails dispose(): the first listener
    // failure is rethrown from lifecycle commands by established contract.
    assert.throws(() => session.dispose(), /status listener exploded/);
  });
});
