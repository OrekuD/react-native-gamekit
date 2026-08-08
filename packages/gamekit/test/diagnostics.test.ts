import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import type { SessionDiagnostics } from '../src/core/session/diagnostics.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

function createCounterGame() {
  return defineGame({
    viewport,
    assets: [],
    input: {},
    scenes: {
      play: defineScene({
        actions: [],
        create: () => ({ count: 0 }),
        update: ({ state }) => ({ count: state.count + 1 }),
        snapshot: ({ state }) => ({ count: state.count }),
      }),
    },
    initialScene: 'play',
  });
}

function createRecordingSink() {
  const events: string[] = [];
  const sink: SessionDiagnostics = {
    onDisplayCallback: () => events.push('display'),
    onZeroStepCallback: () => events.push('zero-step'),
    onFixedStep: () => events.push('fixed-step'),
    onCatchUpStep: () => events.push('catch-up'),
    onDroppedDebt: (steps) => events.push(`dropped:${steps}`),
    onUpdate: (ms) => events.push(`update:${typeof ms === 'number' && ms >= 0}`),
    onInputSample: (ms) => events.push(`sample:${typeof ms === 'number' && ms >= 0}`),
    onSnapshot: (ms) => events.push(`snapshot:${typeof ms === 'number' && ms >= 0}`),
    onDeepFreeze: (ms) => events.push(`freeze:${typeof ms === 'number' && ms >= 0}`),
    onPublish: (ms) => events.push(`publish:${typeof ms === 'number' && ms >= 0}`),
    onCommitNotification: () => events.push('commit'),
    onListenerCount: (count) => events.push(`listeners:${count}`),
  };
  return { events, sink };
}

describe('session diagnostics sink (T1)', () => {
  it('counts display callbacks, zero-step callbacks, fixed and catch-up steps', () => {
    const { events, sink } = createRecordingSink();
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
      maxCatchUpSteps: 5,
      maxFrameDeltaMs: 200,
      diagnostics: sink,
    });
    session.start();
    // 5 ms presentation on a 10 ms step: every other callback is zero-step.
    for (const t of [0, 5, 10, 15, 20, 25, 30, 100]) {
      driver.fireNext(t);
    }

    const display = events.filter((e) => e === 'display').length;
    const zeroStep = events.filter((e) => e === 'zero-step').length;
    const fixed = events.filter((e) => e === 'fixed-step').length;
    const catchUp = events.filter((e) => e === 'catch-up').length;
    const dropped = events.filter((e) => e.startsWith('dropped:')).map((e) => e);

    assert.equal(display, 8);
    assert.equal(zeroStep, 3, 'the 5/15/25 ms callbacks accumulate less than one step');
    assert.equal(fixed, 3 + 5, 'three single steps plus the capped five-step callback');
    assert.equal(catchUp, 4, 'five capped steps minus the first step of that callback');
    assert.equal(dropped.length, 1);
  });

  it('reports durations and listener counts on publish', () => {
    const { events, sink } = createRecordingSink();
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
      diagnostics: sink,
    });
    session.addCommitListener(() => {});
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);

    assert.ok(events.includes('update:true'));
    assert.ok(events.includes('sample:true'));
    assert.ok(events.includes('snapshot:true'));
    assert.ok(events.includes('freeze:true'));
    assert.ok(events.includes('publish:true'));
    assert.ok(events.includes('listeners:1'));
    assert.ok(events.includes('commit'));
  });

  it('is a no-op when no sink is supplied', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(session.getRenderFrame().tick, 1);
  });
});
