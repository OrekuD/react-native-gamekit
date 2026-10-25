import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { defineGameEvents, gameEvent } from '../src/events.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = { logicalSize: { width: 320, height: 180 }, mode: 'fit' } as const;
const driverOptions = (driver = new ManualFrameDriver()) => ({ frameDriver: driver, fixedStepMs: 10 });

function scene(options: {
  readonly create?: () => object;
  readonly snapshot?: () => unknown;
  readonly dispose?: (state: object) => void;
} = {}) {
  return defineScene({
    actions: [],
    create: options.create ?? (() => ({})),
    update: ({ state }) => state,
    snapshot: options.snapshot ?? (() => null),
    ...(options.dispose === undefined ? {} : { dispose: options.dispose }),
  });
}

describe('scene preparation owns every successfully created state', () => {
  for (const initial of [true, false]) {
    it(`cleans up when ${initial ? 'initial' : 'target'} state freezing throws`, () => {
      const freezeError = new Error('state freeze failed');
      const state = new Proxy({}, { preventExtensions() { throw freezeError; } });
      const disposed: object[] = [];
      const target = scene({ create: () => state, dispose: (value) => disposed.push(value) });
      const game = defineGame({
        viewport, input: {}, scenes: { source: scene(), target },
        initialScene: initial ? 'target' : 'source',
      });
      if (initial) {
        assert.throws(() => createGameSessionWithDriver(game, driverOptions()), (error) => error === freezeError);
      } else {
        const session = createGameSessionWithDriver(game, driverOptions());
        assert.throws(() => session.setScene('target'), (error) => error === freezeError);
        assert.equal(session.scene, 'source');
        assert.equal(session.getRenderFrame().revision, 0);
        session.dispose();
      }
      assert.deepEqual(disposed, [state]);
    });

    it(`preserves ${initial ? 'initial' : 'target'} freeze and cleanup failures`, () => {
      const state = new Proxy({}, { preventExtensions() { throw undefined; } });
      let disposalCount = 0;
      const target = scene({
        create: () => state,
        dispose: () => { disposalCount += 1; throw 42; },
      });
      const game = defineGame({
        viewport, input: {}, scenes: { source: scene(), target },
        initialScene: initial ? 'target' : 'source',
      });
      const operation = initial
        ? () => createGameSessionWithDriver(game, driverOptions())
        : () => createGameSessionWithDriver(game, driverOptions()).setScene('target');
      assert.throws(operation, (error) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [undefined, 42]);
        return true;
      });
      assert.equal(disposalCount, 1);
    });
  }

  it('preserves target snapshot and cleanup failures and allows a clean retry', () => {
    let failPreparation = true;
    let disposalCount = 0;
    const target = scene({
      snapshot: () => { if (failPreparation) throw undefined; return null; },
      dispose: () => { disposalCount += 1; if (failPreparation) throw 'target cleanup failed'; },
    });
    const session = createGameSessionWithDriver(defineGame({
      viewport, input: {}, scenes: { source: scene(), target }, initialScene: 'source',
    }), driverOptions());
    assert.throws(() => session.setScene('target'), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [undefined, 'target cleanup failed']);
      return true;
    });
    assert.equal(disposalCount, 1);
    assert.equal(session.scene, 'source');
    assert.equal(session.getRenderFrame().revision, 0);
    failPreparation = false;
    session.setScene('target');
    assert.equal(session.scene, 'target');
    session.dispose();
    assert.equal(disposalCount, 2, 'one disposal per successfully created target');
  });

  it('never disposes a target whose create callback did not return', () => {
    let disposalCount = 0;
    const session = createGameSessionWithDriver(defineGame({
      viewport, input: {}, initialScene: 'source',
      scenes: {
        source: scene(),
        target: scene({ create: () => { throw 'create failed'; }, dispose: () => { disposalCount += 1; } }),
      },
    }), driverOptions());
    assert.throws(() => session.setScene('target'), (error) => error === 'create failed');
    assert.equal(disposalCount, 0);
    session.dispose();
  });
});

type TransitionPhase = 'create' | 'freeze' | 'snapshot' | 'snapshotFreeze' | 'dispose';
type SessionMode = 'idle' | 'paused' | 'running' | 'update' | 'pauseFlush';

function transitionHarness(phase: TransitionPhase, mode: SessionMode, operation: () => void) {
  const driver = new ManualFrameDriver();
  const calls: string[] = [];
  const events = defineGameEvents({ transitioned: gameEvent<null>() });
  const source = defineScene({
    actions: [], transitions: ['target'], emits: ['transitioned'], events,
    create: () => ({}),
    update: ({ state, transition, events: emitter }) => {
      if (mode === 'update') {
        transition.setScene('target');
        emitter.emit('transitioned', null);
      }
      return state;
    },
    snapshot: () => null,
    dispose: () => { calls.push('source:dispose'); if (phase === 'dispose') operation(); },
  });
  const target = scene({
    create: () => {
      calls.push('target:create');
      if (phase === 'create') operation();
      if (phase === 'freeze') {
        return new Proxy({}, { preventExtensions(value) { operation(); return Reflect.preventExtensions(value); } });
      }
      return {};
    },
    snapshot: () => {
      calls.push('target:snapshot');
      if (phase === 'snapshot') operation();
      return phase === 'snapshotFreeze'
        ? new Proxy({}, { preventExtensions(value) { operation(); return Reflect.preventExtensions(value); } })
        : null;
    },
    dispose: () => { calls.push('target:dispose'); },
  });
  const session = createGameSessionWithDriver(defineGame({
    viewport, input: {}, scenes: { source, target }, initialScene: 'source', events,
  }), driverOptions(driver));
  let emitted = 0;
  const commits: string[] = [];
  session.addGameEventListener('transitioned', () => { emitted += 1; });
  session.addCommitListener((frame) => commits.push(frame.scene));
  if (mode !== 'idle') {
    session.start();
    driver.fireNext(0);
    if (mode === 'paused') session.pause();
  }
  const request = () => {
    if (mode !== 'update') session.setScene('target');
    if (mode === 'pauseFlush') session.pause();
    if (mode === 'running' || mode === 'update') driver.fireNext(10);
  };
  return { session, driver, calls, commits, request, emitted: () => emitted };
}

describe('terminal disposal during a scene transition', () => {
  for (const phase of ['create', 'freeze', 'snapshot', 'snapshotFreeze', 'dispose'] as const) {
    for (const mode of ['idle', 'paused', 'running', 'update', 'pauseFlush'] as const) {
      it(`cleans the prepared target without publication when disposed in ${phase} while ${mode}`, () => {
        const harness = transitionHarness(phase, mode, () => harness.session.dispose());
        const before = harness.session.getRenderFrame();
        const commitsBefore = harness.commits.length;
        harness.request();
        assert.equal(harness.session.status, 'disposed');
        assert.equal(harness.session.scene, 'source', 'the target is never installed');
        assert.deepEqual(harness.session.getRenderFrame(), before, 'the terminal frame remains unchanged');
        assert.equal(harness.commits.length, commitsBefore);
        assert.equal(harness.calls.filter((call) => call === 'source:dispose').length, 1);
        assert.equal(harness.calls.filter((call) => call === 'target:dispose').length, 1);
        assert.equal(harness.emitted(), 0, 'an aborted transition does not deliver staged events');
        assert.equal(harness.driver.pendingCount, 0);
        harness.session.dispose();
        assert.equal(harness.calls.filter((call) => call === 'target:dispose').length, 1);
      });
    }
  }

  it('reports failed target cleanup after terminal disposal without retrying it', () => {
    const cleanupError = new Error('target cleanup failed');
    let disposalCount = 0;
    const source = scene();
    const target = scene({
      snapshot: () => { session.dispose(); return null; },
      dispose: () => { disposalCount += 1; throw cleanupError; },
    });
    const session = createGameSessionWithDriver(defineGame({
      viewport, input: {}, scenes: { source, target }, initialScene: 'source',
    }), driverOptions());
    assert.throws(() => session.setScene('target'), (error) => error === cleanupError);
    assert.equal(session.status, 'disposed');
    assert.equal(session.scene, 'source');
    assert.equal(session.getRenderFrame().revision, 0);
    session.dispose();
    assert.equal(disposalCount, 1);
  });
});

describe('external transition reentry during preparation and disposal', () => {
  for (const phase of ['create', 'snapshot', 'dispose'] as const) {
    for (const command of ['setScene', 'restartScene'] as const) {
      it(`rejects ${command} from ${phase} without a nested transition`, () => {
        const errors: unknown[] = [];
        const harness = transitionHarness(phase, 'idle', () => {
          try {
            if (command === 'setScene') harness.session.setScene('source');
            else harness.session.restartScene();
          } catch (error) { errors.push(error); }
        });
        harness.request();
        assert.equal(errors.length, 1);
        assert.ok(errors[0] instanceof Error);
        assert.equal(errors[0].name, 'GameSessionLifecycleError');
        assert.match(errors[0].message, /preparation|transition|disposal/);
        assert.equal(harness.session.scene, 'target');
        assert.deepEqual(harness.calls, ['target:create', 'target:snapshot', 'source:dispose']);
        harness.session.dispose();
        assert.equal(harness.calls.filter((call) => call === 'target:dispose').length, 1);
      });
    }
  }

  it('allows a commit observer to request another transition after installation', () => {
    const session = createGameSessionWithDriver(defineGame({
      viewport, input: {}, scenes: { a: scene(), b: scene(), c: scene() }, initialScene: 'a',
    }), driverOptions());
    session.addCommitListener((frame) => { if (frame.scene === 'b') session.setScene('c'); });
    session.setScene('b');
    assert.equal(session.scene, 'c');
    assert.equal(session.getRenderFrame().scene, 'c');
    session.dispose();
  });
});
