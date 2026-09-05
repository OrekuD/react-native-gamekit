/**
 * GS-SCENE-01 — disposal ownership is per scene instance.
 *
 * A throwing outgoing disposer must run exactly once: later session
 * disposal, retries, and scene transitions never invoke it again, and the
 * prepared target is still cleaned up once. A faulted scene is explicitly
 * non-resumable: `start()` refuses to update it until a transition or
 * restart replaces it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

interface DisposalCounts {
  a: number;
  b: number;
}

function disposalGame(counts: DisposalCounts, throwOn: 'a' | 'b' | 'both' | 'none') {
  const makeScene = (name: 'a' | 'b') =>
    defineScene({
      actions: [],
      create: () => ({ count: 0 }),
      update: ({ state }: { state: { readonly count: number } }) => ({
        count: state.count + 1,
      }),
      snapshot: ({ state }: { state: { readonly count: number } }) => ({
        count: state.count,
      }),
      dispose: () => {
        counts[name] += 1;
        if (throwOn === name || throwOn === 'both') {
          throw new Error(`${name} dispose exploded`);
        }
      },
    });
  return defineGame({
    viewport,
    input: {},
    scenes: { a: makeScene('a'), b: makeScene('b') },
    initialScene: 'a',
  });
}

function harness(counts: DisposalCounts, throwOn: 'a' | 'b' | 'both' | 'none') {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(disposalGame(counts, throwOn), {
    frameDriver: driver,
    fixedStepMs: 10,
  });
  return { session, driver };
}

describe('GS-SCENE-01 disposal ownership', () => {
  it('a failed outgoing disposal disposes the prepared target once and keeps the old scene', () => {
    const counts: DisposalCounts = { a: 0, b: 0 };
    const { session } = harness(counts, 'a');
    assert.throws(() => session.setScene('b'), /a dispose exploded/);
    assert.equal(counts.a, 1, 'the outgoing disposer ran exactly once');
    assert.equal(counts.b, 1, 'the prepared target is still cleaned up once');
    assert.equal(session.scene, 'a', 'the old scene remains active');
    assert.equal(session.getRenderFrame().tick, 0, 'session time is unchanged');
    session.dispose();
  });

  it('later session disposal never re-runs the failed outgoing disposer', () => {
    const counts: DisposalCounts = { a: 0, b: 0 };
    const { session } = harness(counts, 'a');
    assert.throws(() => session.setScene('b'), /a dispose exploded/);
    session.dispose();
    assert.equal(counts.a, 1, 'no second disposal attempt on session disposal');
    assert.equal(counts.b, 1, 'the prepared target stays disposed once');
    session.dispose();
  });

  it('retrying the transition never re-runs the failed outgoing disposer', () => {
    const counts: DisposalCounts = { a: 0, b: 0 };
    const { session } = harness(counts, 'a');
    assert.throws(() => session.setScene('b'), /a dispose exploded/);
    session.setScene('b');
    assert.equal(counts.a, 1, 'the failed disposer is not retried');
    assert.equal(session.scene, 'b', 'the replacement still installs');
    session.dispose();
    assert.equal(counts.a, 1);
  });

  it('start() refuses a faulted scene until a transition or restart replaces it', () => {
    const counts: DisposalCounts = { a: 0, b: 0 };
    const { session, driver } = harness(counts, 'a');
    assert.throws(() => session.setScene('b'), /a dispose exploded/);
    assert.throws(() => session.start(), /non-resumable/, 'updates on the damaged scene are refused');
    session.restartScene();
    session.start();
    driver.fireNext(0);
    driver.fireNext(16);
    assert.equal(session.getRenderFrame().tick, 1, 'the replaced scene updates normally');
    // The restart installed a NEW scene instance; its first disposal runs
    // (and this fixture throws on every 'a' disposal) — the failed
    // instance's disposer still ran exactly once.
    assert.throws(() => session.dispose(), /a dispose exploded/);
    assert.equal(counts.a, 2, 'one attempt per instance, never a retry');
  });

  it('outgoing and target disposal failures compose losslessly', () => {
    const counts: DisposalCounts = { a: 0, b: 0 };
    const { session } = harness(counts, 'both');
    const thrown: unknown = (() => {
      try {
        session.setScene('b');
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.ok(thrown instanceof AggregateError, 'both failures are reported');
    const messages = thrown.errors.map((entry) => String((entry as Error).message ?? entry));
    assert.deepEqual(messages, ['a dispose exploded', 'b dispose exploded'], 'stable order');
    assert.equal(counts.a, 1);
    assert.equal(counts.b, 1);
    session.dispose();
  });

  it('successful transitions still dispose the outgoing final state exactly once', () => {
    const counts: DisposalCounts = { a: 0, b: 0 };
    const { session } = harness(counts, 'none');
    session.setScene('b');
    assert.equal(counts.a, 1);
    assert.equal(counts.b, 0);
    session.dispose();
    assert.equal(counts.a, 1);
    assert.equal(counts.b, 1);
    session.dispose();
  });
});
