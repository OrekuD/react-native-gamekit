import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { type GameSession } from '../src/core/session/types.ts';
import { defineGame, defineScene, type GameDefinition } from '../src/index.ts';
import type { SceneTransitionController } from '../src/scene/types.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

interface SceneLifecycleLog {
  readonly name: string;
  readonly events: string[];
}

const SCENE_TRANSITIONS = ['play', 'game-over', 'ready', 'level-2'] as const;

type SceneUpdateFn = (frame: {
  readonly state: { readonly count: number };
  readonly transition: SceneTransitionController<(typeof SCENE_TRANSITIONS)[number]>;
  readonly tick: number;
  readonly sceneTick: number;
  readonly elapsedSeconds: number;
  readonly sceneElapsedSeconds: number;
}) => { readonly count: number };

function makeScene(
  name: string,
  log: SceneLifecycleLog,
  options: { readonly update?: SceneUpdateFn } = {},
) {
  return defineScene({
    actions: [],
    transitions: SCENE_TRANSITIONS,
    create: () => {
      log.events.push(`${name}:create`);
      return { count: 0 };
    },
    update: (frame) => {
      const count = frame.state.count + 1;
      if (options.update) {
        return options.update({ ...frame, state: { count } });
      }
      return { count };
    },
    snapshot: ({ state }) => ({ count: state.count }),
    dispose: () => {
      log.events.push(`${name}:dispose`);
    },
  });
}

function makeMultiSceneGame(
  log: SceneLifecycleLog,
  sceneOptions: {
    readonly readyUpdate?: SceneUpdateFn;
    readonly playUpdate?: SceneUpdateFn;
  } = {},
) {
  return defineGame({
    viewport,
    assets: [],
    input: {},
    scenes: {
      ready: makeScene('ready', log, sceneOptions.readyUpdate ? { update: sceneOptions.readyUpdate } : {}),
      play: makeScene('play', log, sceneOptions.playUpdate ? { update: sceneOptions.playUpdate } : {}),
      'game-over': makeScene('game-over', log, sceneOptions.playUpdate ? { update: sceneOptions.playUpdate } : {}),
      'level-2': makeScene('level-2', log),
    },
    initialScene: 'ready',
  });
}

function createTransitionGame(
  log: SceneLifecycleLog,
  options: Parameters<typeof makeMultiSceneGame>[1] = {},
  driver = new ManualFrameDriver(),
) {
  const session = createGameSessionWithDriver(makeMultiSceneGame(log, options), {
    frameDriver: driver,
    fixedStepMs: 10,
  });
  return { session, driver };
}

describe('named scenes and session lifecycle', () => {
  it('creates the initial scene once and exposes the live scene name', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session } = createTransitionGame(log);
    assert.equal(session.scene, 'ready');
    assert.deepEqual(log.events, ['ready:create']);
    assert.equal(session.getRenderFrame().scene, 'ready');
  });

  it('exposes the session viewport config', () => {
    const { session } = createTransitionGame({ name: 'x', events: [] });
    assert.deepEqual(session.viewport, viewport);
  });

  it('setScene to the current scene is an idempotent no-op', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session } = createTransitionGame(log);
    session.setScene('ready');
    session.setScene('ready');
    assert.equal(session.scene, 'ready');
    assert.deepEqual(log.events, ['ready:create']);
  });

  it('commits an external transition synchronously while idle', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session } = createTransitionGame(log);
    session.setScene('play');
    assert.equal(session.scene, 'play');
    const frame = session.getRenderFrame();
    assert.equal(frame.scene, 'play');
    assert.equal(frame.previous, frame.current);
    assert.equal(frame.alpha, 0);
    assert.equal(frame.tick, 0);
    assert.deepEqual(log.events, ['ready:create', 'play:create', 'ready:dispose']);
  });

  it('commits an external transition synchronously while paused', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    session.pause();
    session.setScene('game-over');
    assert.equal(session.scene, 'game-over');
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
  });

  it('defers an external transition while running to the next boundary', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    session.setScene('play');
    assert.equal(session.scene, 'ready', 'not committed before the boundary');
    assert.deepEqual(log.events, ['ready:create'] as string[], 'dispose only after commit');

    driver.fireNext(20);
    assert.equal(session.scene, 'play');
    assert.deepEqual(log.events, ['ready:create', 'play:create', 'ready:dispose']);
    assert.equal(session.getRenderFrame().scene, 'play');
    assert.equal(driver.pendingCount, 1, 'scheduling continues');
  });

  it('commits a pending external transition synchronously on pause', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.start();
    driver.fireNext(0);
    session.setScene('play');
    session.pause();
    assert.equal(session.scene, 'play');
    assert.equal(session.status, 'paused');
  });

  it('transitions from inside a render-frame listener are deferred while running', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.addCommitListener(() => {
      session.setScene('play');
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(session.scene, 'play');
    assert.equal(session.getRenderFrame().scene, 'play');
  });

  it('throws a specific error for an unknown runtime scene name', () => {
    const { session } = createTransitionGame({ name: 'x', events: [] });
    assert.throws(() => session.setScene('bogus' as 'play'), {
      name: 'GameSessionLifecycleError',
      message: /Unknown scene: bogus/,
    });
  });

  it('rejects a conflicting pending external transition', () => {
    const { session, driver } = createTransitionGame({ name: 'x', events: [] });
    session.start();
    driver.fireNext(0);
    session.setScene('play');
    assert.throws(() => session.setScene('game-over'), {
      name: 'GameSessionLifecycleError',
      message: /Conflicting pending scene transition/,
    });
    assert.throws(() => session.restartScene(), {
      name: 'GameSessionLifecycleError',
      message: /Conflicting pending scene transition/,
    });
    session.setScene('play');
    assert.equal(session.scene, 'ready', 'identical pending request is harmless');
  });

  it('restarts the active scene synchronously while idle and resets scene time', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session } = createTransitionGame(log);
    session.restartScene();
    assert.equal(session.scene, 'ready');
    assert.deepEqual(log.events, ['ready:create', 'ready:create', 'ready:dispose']);
    const frame = session.getRenderFrame();
    assert.deepEqual(frame.current, { count: 0 });
    assert.equal(frame.previous, frame.current);
  });

  it('restartScene while running recreates the scene at the next boundary', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    session.restartScene();
    driver.fireNext(20);
    assert.equal(session.scene, 'ready');
    assert.deepEqual(log.events, ['ready:create', 'ready:create', 'ready:dispose']);
  });

  it('throws for conflicting transition requests in one update', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log, {
      readyUpdate: ({ state, transition }) => {
        transition.setScene('play');
        transition.setScene('game-over');
        return state;
      },
    });
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), {
      name: 'GameSessionLifecycleError',
      message: /Conflicting scene transition requests/,
    });
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready');
    assert.deepEqual(log.events, ['ready:create'], 'no scene was created or disposed');
  });

  it('treats repeated identical requests in one update as harmless', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log, {
      readyUpdate: ({ state, transition }) => {
        transition.setScene('play');
        transition.setScene('play');
        return state;
      },
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(session.scene, 'play');
  });

  it('throws when a retained transition controller is used after its update', () => {
    const _log: SceneLifecycleLog = { name: 'x', events: [] };
    let retained: { setScene(name: string): void } | undefined;
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({}),
          update: ({ state, transition }) => {
            retained = transition as unknown as { setScene(name: string): void };
            return state;
          },
          snapshot: () => null,
        }),
        play: defineScene({
          actions: [],
          create: () => ({}),
          update: ({ state }) => state,
          snapshot: () => null,
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.ok(retained, 'controller captured during update');
    assert.throws(() => retained!.setScene('play'), {
      name: 'GameSessionLifecycleError',
      message: /only valid during its owning scene update/,
    });
  });

  it('transitions to an undeclared target from inside update fail clearly', () => {
    const _log: SceneLifecycleLog = { name: 'x', events: [] };
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({}),
          update: ({ state, transition }) => {
            transition.setScene('game-over' as 'play');
            return state;
          },
          snapshot: () => null,
        }),
        play: defineScene({
          actions: [],
          create: () => ({}),
          update: ({ state }) => state,
          snapshot: () => null,
        }),
        'game-over': defineScene({
          actions: [],
          create: () => ({}),
          update: ({ state }) => state,
          snapshot: () => null,
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), {
      name: 'GameSessionLifecycleError',
      message: /declared targets/,
    });
    assert.equal(session.status, 'paused');
  });
});

describe('transition ordering and failure semantics', () => {
  it('commits after the successful update and advances global time once', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const sceneTicks: number[] = [];
    const { session, driver } = createTransitionGame(log, {
      readyUpdate: ({ state, transition, sceneTick }) => {
        sceneTicks.push(sceneTick);
        if (state.count >= 2) {
          transition.setScene('play');
        }
        return state;
      },
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    driver.fireNext(20);
    assert.equal(session.scene, 'play');
    assert.deepEqual(sceneTicks, [1, 2]);
    assert.equal(session.getRenderFrame().tick, 2, 'only the successful update advanced time');
    assert.equal(session.getRenderFrame().scene, 'play');
    assert.deepEqual(log.events, ['ready:create', 'play:create', 'ready:dispose']);
  });

  it('publishes a hard cut with previous === current and alpha 0', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const frames: Array<{ previous: unknown; current: unknown; alpha: number; scene: string; hardCut: boolean }> = [];
    const { session } = createTransitionGame(log);
    session.addCommitListener((frame) => frames.push(frame as never));
    session.setScene('play');
    assert.equal(frames.at(-1)?.scene, 'play');
    const hardCut = frames.at(-1)!;
    assert.equal(hardCut.previous, hardCut.current);
    assert.equal(hardCut.hardCut, true, 'the hard cut is flagged on the envelope');
  });

  it('resets scene-local time and keeps global time monotonic across transitions', () => {
    const _log: SceneLifecycleLog = { name: 'x', events: [] };
    const seen: Array<{ scene: string; sceneTick: number; sceneElapsedSeconds: number; tick: number; elapsedSeconds: number }> = [];
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({ count: 0 }),
          update: ({ state, transition, sceneTick, sceneElapsedSeconds, tick, elapsedSeconds }) => {
            seen.push({ scene: 'ready', sceneTick, sceneElapsedSeconds, tick, elapsedSeconds });
            if (state.count >= 1) {
              transition.setScene('play');
            }
            return { count: state.count + 1 };
          },
          snapshot: ({ state }) => ({ count: state.count }),
        }),
        play: defineScene({
          actions: [],
          create: () => ({ count: 0 }),
          update: ({ state, sceneTick, sceneElapsedSeconds, tick, elapsedSeconds }) => {
            seen.push({ scene: 'play', sceneTick, sceneElapsedSeconds, tick, elapsedSeconds });
            return { count: state.count + 1 };
          },
          snapshot: ({ state }) => ({ count: state.count }),
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    driver.fireNext(20);
    driver.fireNext(30);
    driver.fireNext(40);

    assert.deepEqual(seen, [
      { scene: 'ready', sceneTick: 1, sceneElapsedSeconds: 0.01, tick: 1, elapsedSeconds: 0.01 },
      { scene: 'ready', sceneTick: 2, sceneElapsedSeconds: 0.02, tick: 2, elapsedSeconds: 0.02 },
      { scene: 'play', sceneTick: 1, sceneElapsedSeconds: 0.01, tick: 3, elapsedSeconds: 0.03 },
      { scene: 'play', sceneTick: 2, sceneElapsedSeconds: 0.02, tick: 4, elapsedSeconds: 0.04 },
    ]);
  });

  it('clears pending and held input on a committed transition', () => {
    const _log: SceneLifecycleLog = { name: 'x', events: [] };
    const game = defineGame({
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        ready: defineScene({
          actions: ['boost'],
          transitions: ['play'],
          create: () => ({}),
          update: ({ state, input, transition }) => {
            if (input.button('boost').pressed) {
              transition.setScene('play');
            }
            return state;
          },
          snapshot: () => null,
        }),
        play: defineScene({
          actions: ['boost'],
          create: () => ({ held: false }),
          update: ({ input }) => ({ held: input.button('boost').held }),
          snapshot: ({ state }) => ({ held: state.held }),
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    session.input.press('boost');
    driver.fireNext(10);
    driver.fireNext(20);
    assert.equal(session.scene, 'play');
    const afterTransition = session.getRenderFrame();
    assert.equal(afterTransition.scene, 'play');
    assert.equal(afterTransition.current.held, false, 'input reset after transition');
  });

  it('keeps the old scene and pauses when target preparation fails', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    let failPlayCreate = false;
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({ value: 5 }),
          update: ({ state, transition }) => {
            transition.setScene('play');
            return state;
          },
          snapshot: ({ state }) => ({ value: state.value }),
          dispose: () => log.events.push('ready:dispose'),
        }),
        play: defineScene({
          actions: [],
          create: () => {
            log.events.push('play:create');
            if (failPlayCreate) {
              throw new Error('play create exploded');
            }
            return { value: 0 };
          },
          update: ({ state }) => state,
          snapshot: () => null,
          dispose: () => log.events.push('play:dispose'),
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    failPlayCreate = true;
    assert.throws(() => driver.fireNext(10), /play create exploded/);
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready');
    assert.deepEqual(session.getRenderFrame().current, { value: 5 }, 'pre-update state retained');
    assert.deepEqual(log.events, ['play:create'], 'partial target cleaned up, ready never disposed');
  });

  it('keeps the old scene and pauses when target snapshot fails', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    let failSnapshot = false;
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({ value: 3 }),
          update: ({ state, transition }) => {
            transition.setScene('play');
            return state;
          },
          snapshot: ({ state }) => ({ value: state.value }),
        }),
        play: defineScene({
          actions: [],
          create: () => ({ value: 0 }),
          update: ({ state }) => state,
          snapshot: () => {
            if (failSnapshot) {
              throw new Error('snapshot exploded');
            }
            return null;
          },
          dispose: () => log.events.push('play:dispose'),
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    failSnapshot = true;
    assert.throws(() => driver.fireNext(10), /snapshot exploded/);
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready');
    assert.deepEqual(session.getRenderFrame().current, { value: 3 });
    assert.deepEqual(log.events, ['play:dispose'], 'created target was cleaned up');
  });

  it('pauses and keeps the old scene when a transition-requesting update throws', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log, {
      readyUpdate: () => {
        throw new Error('update exploded');
      },
    });
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), /update exploded/);
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready');
    assert.deepEqual(log.events, ['ready:create']);
  });

  it('pauses without a successor when a transition hard-cut publish fails', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.addCommitListener((frame) => {
      if (frame.scene === 'play') {
        throw new Error('presentation failed');
      }
    });
    session.start();
    driver.fireNext(0);
    session.setScene('play');
    assert.equal(session.scene, 'ready', 'deferred until the boundary');
    assert.throws(() => driver.fireNext(10), /presentation failed/);
    assert.equal(session.scene, 'play', 'transition committed before the publish failure');
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
  });

  it('disposes the active scene exactly once on final disposal', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session } = createTransitionGame(log);
    session.setScene('play');
    session.setScene('level-2');
    session.dispose();
    session.dispose();
    assert.deepEqual(log.events, [
      'ready:create',
      'play:create',
      'ready:dispose',
      'level-2:create',
      'play:dispose',
      'level-2:dispose',
    ]);
  });

  it('disposes every created scene exactly once across many transitions', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    session.start();
    driver.fireNext(0);
    for (const name of ['play', 'ready', 'game-over', 'level-2', 'play'] as const) {
      session.setScene(name);
      driver.fireNext(1_000 + (name.length * 10));
    }
    session.pause();
    session.dispose();

    const created = log.events.filter((event) => event.endsWith(':create')).length;
    const disposed = log.events.filter((event) => event.endsWith(':dispose')).length;
    assert.equal(created, disposed, 'every created scene instance is disposed exactly once');
  });

  it('stale frame callbacks cannot update or resurrect an outgoing scene', () => {
    const readyUpdateCounts: number[] = [];
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({ updates: 0 }),
          update: ({ state }) => {
            readyUpdateCounts.push(state.updates + 1);
            return { updates: state.updates + 1 };
          },
          snapshot: ({ state }) => ({ updates: state.updates }),
        }),
        play: defineScene({
          actions: [],
          create: () => ({ updates: 0 }),
          update: ({ state }) => ({ updates: state.updates + 1 }),
          snapshot: ({ state }) => ({ updates: state.updates }),
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    const staleHandle = driver.fireNext(10); // tick 1 runs in the outgoing scene
    session.setScene('play'); // pending external transition
    driver.fireNext(20); // boundary: commits to play and advances tick 2 in play
    assert.equal(session.scene, 'play');
    assert.deepEqual(readyUpdateCounts, [1], 'outgoing scene ran exactly once');

    // A stale handle captured before the transition must not resurrect or
    // advance the outgoing scene; the session keeps running the current scene.
    driver.fireCancelled(staleHandle, 30);
    assert.equal(session.scene, 'play');
    assert.deepEqual(readyUpdateCounts, [1], 'outgoing scene never ran again');
    assert.equal(session.getRenderFrame().scene, 'play');
  });
});

describe('session scene validation', () => {
  it('rejects undeclared scene actions at session creation', () => {
    const invalid = {
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        play: defineScene({
          actions: ['fire'],
          create: () => ({}),
          update: ({ state }) => state,
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    } as unknown as GameDefinition;
    assert.throws(
      () => createGameSessionWithDriver(invalid, { frameDriver: new ManualFrameDriver() }),
      /uses undeclared input action: fire/,
    );
  });

  it('rejects unknown transition targets at session creation', () => {
    const invalid = {
      viewport,
      assets: [],
      input: {},
      scenes: {
        play: defineScene({
          actions: [],
          transitions: ['missing'],
          create: () => ({}),
          update: ({ state }) => state,
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    } as unknown as GameDefinition;
    assert.throws(
      () => createGameSessionWithDriver(invalid, { frameDriver: new ManualFrameDriver() }),
      /declares an unknown transition target: missing/,
    );
  });
});

describe('feedback: transition publish and lifecycle hardening', () => {
  it('publishes at most once per presentation callback for pending external transitions', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log);
    let publishes = 0;
    session.addCommitListener(() => {
      publishes += 1;
    });
    session.start();
    session.setScene('play');
    driver.fireNext(0);
    assert.equal(publishes, 1, 'baseline with a pending transition publishes once');
    publishes = 0;
    driver.fireNext(10);
    assert.equal(publishes, 1, 'an established-timeline update publishes once');
    publishes = 0;
    session.setScene('ready');
    driver.fireNext(20);
    assert.equal(publishes, 1, 'established timeline with a pending transition publishes once');
    publishes = 0;
    driver.fireNext(30);
    assert.equal(publishes, 1);
  });

  it('rejects external setScene during an update', () => {
    const sessionRef: { current: GameSession<never, never> | undefined } = { current: undefined };
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({}),
          update: ({ state }) => {
            sessionRef.current!.setScene('play' as never);
            return state;
          },
          snapshot: () => null,
        }),
        play: defineScene({
          actions: [],
          create: () => ({}),
          update: ({ state }) => state,
          snapshot: () => null,
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    sessionRef.current = session as unknown as GameSession<never, never>;
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), {
      name: 'GameSessionLifecycleError',
      message: /during a scene update/,
    });
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready');
  });

  it('rejects external restartScene during an update', () => {
    const sessionRef: { current: GameSession<never, never> | undefined } = { current: undefined };
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          create: () => ({}),
          update: ({ state }) => {
            sessionRef.current!.restartScene();
            return state;
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    sessionRef.current = session as unknown as GameSession<never, never>;
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), {
      name: 'GameSessionLifecycleError',
      message: /during a scene update/,
    });
    assert.equal(session.status, 'paused');
  });

  it('still commits an update-scoped transition when no external call interferes', () => {
    const log: SceneLifecycleLog = { name: 'x', events: [] };
    const { session, driver } = createTransitionGame(log, {
      readyUpdate: ({ state, transition }) => {
        transition.setScene('play');
        return state;
      },
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(session.scene, 'play');
  });

  it('disposes a created target even when create() returns undefined and snapshot fails', () => {
    const events: string[] = [];
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({}),
          update: ({ state, transition }) => {
            transition.setScene('play');
            return state;
          },
          snapshot: () => null,
        }),
        play: defineScene({
          actions: [],
          create: () => undefined as unknown as Record<string, never>,
          update: ({ state }) => state,
          snapshot: () => {
            throw new Error('snapshot exploded');
          },
          dispose: (state) => {
            events.push(`dispose:${String(state)}`);
          },
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), /snapshot exploded/);
    assert.deepEqual(events, ['dispose:undefined'], 'the undefined-state target is disposed');
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready');
  });

  it('pauses with honest semantics when the outgoing scene dispose throws', () => {
    let disposeCalls = 0;
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        ready: defineScene({
          actions: [],
          transitions: ['play'],
          create: () => ({ value: 1 }),
          update: ({ state, transition }) => {
            transition.setScene('play');
            return state;
          },
          snapshot: ({ state }) => ({ value: state.value }),
          dispose: () => {
            disposeCalls += 1;
            throw new Error('dispose exploded');
          },
        }),
        play: defineScene({
          actions: [],
          create: () => ({ value: 2 }),
          update: ({ state }) => state,
          snapshot: ({ state }) => ({ value: state.value }),
        }),
      },
      initialScene: 'ready',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    assert.throws(() => driver.fireNext(10), /dispose exploded/);
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'ready', 'the old scene remains active');
    assert.equal(disposeCalls, 1, 'dispose ran exactly once even though it threw');
  });
});
