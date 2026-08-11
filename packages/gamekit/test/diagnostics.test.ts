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

  it('performs zero diagnostics clock reads and zero sink calls without a sink (F4)', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const originalNow = performance.now.bind(performance);
    let clockReads = 0;
    performance.now = (() => {
      clockReads += 1;
      return originalNow();
    }) as typeof performance.now;
    try {
      session.start();
      for (let frame = 0; frame < 20; frame += 1) {
        driver.fireNext(frame * 10);
      }
    } finally {
      performance.now = originalNow;
    }
    assert.equal(clockReads, 0, 'no timing reads on the disabled diagnostics path');
    assert.equal(session.status, 'running');
  });

  it('reports a transition-during-update step as fixed, never as zero-step (F4)', () => {
    const { events, sink } = createRecordingSink();
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(
      defineGame({
        viewport,
        assets: [],
        input: {},
        scenes: {
          a: defineScene({
            actions: [],
            transitions: ['b'],
            create: () => ({})
            ,
            update: ({ transition }) => {
              transition.setScene('b');
              return {};
            },
            snapshot: () => ({}),
          }),
          b: defineScene({
            actions: [],
            create: () => ({ ready: 0 }),
            update: ({ state }) => ({ ready: state.ready + 1 }),
            snapshot: ({ state }) => ({ ready: state.ready }),
          }),
        },
        initialScene: 'a',
      }),
      {
        frameDriver: driver,
        fixedStepMs: 10,
        diagnostics: sink,
      },
    );
    session.start();
    driver.fireNext(0); // baseline frame
    driver.fireNext(10); // one fixed step that transitions mid-update

    assert.ok(events.includes('fixed-step'), 'the transition step ran a fixed step');
    assert.ok(!events.includes('zero-step'), 'a step that transitions early is not zero-step');
  });
});
