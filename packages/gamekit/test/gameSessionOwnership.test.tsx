/**
 * RED (T9.3): the hook must compose with the borrowed-presentation contract
 * that `GameView` implements through `bindGameSession` — start on bind, pause
 * on unbind, never terminate a borrowed session, and let the hook own
 * disposal. The presenter here is the platform-neutral stand-in for
 * `GameView`; `GameView` itself needs native Skia and cannot mount in this
 * test runner (its call sites are typechecked by `useGameSession.types.tsx`).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useEffect, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { defineGame, defineScene, GameSessionDisposedError, type CommitFrame, type GameSession } from '../src/index';
import { bindGameSession } from '../src/react/bindGameSession';
import { useOwnedGameSession } from '../src/react/useGameSession';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

const definition = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {
    steer: { type: 'pointer', description: 'Move the paddle' },
  },
  scenes: {
    play: defineScene({
      actions: ['steer'],
      create: () => ({ x: 0 }),
      update: ({ state, input }) => {
        const steer = input.pointer('steer');
        return steer.active && steer.position !== undefined ? { x: steer.position.x } : state;
      },
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
});

type Definition = typeof definition;
type Session = GameSession<Definition['scenes'], Definition['input']>;
type Frame = CommitFrame<Definition['scenes']>;

const otherDefinition: Definition = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {
    steer: { type: 'pointer', description: 'Move the paddle' },
  },
  scenes: {
    play: defineScene({
      actions: ['steer'],
      create: () => ({ x: 100 }),
      update: ({ state, input }) => {
        const steer = input.pointer('steer');
        return steer.active && steer.position !== undefined ? { x: steer.position.x } : state;
      },
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
});

/**
 * Platform-neutral stand-in for `GameView`: binds a session while it is
 * published and unbinds (pause, never dispose) on cleanup.
 */
function Presenter({
  session,
  onFrame,
}: {
  readonly session: Session | undefined;
  readonly onFrame: (frame: Frame) => void;
}): null {
  // Like GameView, the sink lives in a ref so re-renders never re-bind.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (session === undefined) {
      return;
    }
    return bindGameSession(session, (frame) => onFrameRef.current(frame));
  }, [session]);
  return null;
}

interface ScreenProps {
  readonly definition: Definition;
  readonly create: (definition: Definition) => Session;
  readonly onSession: (session: Session | undefined) => void;
  readonly onFrame: (frame: Frame) => void;
}

function Screen({ definition: target, create, onSession, onFrame }: ScreenProps) {
  const session = useOwnedGameSession(target, create);
  onSession(session);
  return <Presenter session={session} onFrame={onFrame} />;
}

interface Harness {
  readonly create: (definition: Definition) => Session;
  readonly created: Session[];
  readonly drivers: ManualFrameDriver[];
}

function harness(): Harness {
  const created: Session[] = [];
  const drivers: ManualFrameDriver[] = [];
  const create = (target: Definition): Session => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(target, { frameDriver: driver });
    created.push(session);
    drivers.push(driver);
    return session;
  };
  return { create, created, drivers };
}

function mountScreen(
  harnessState: Harness,
  onSession: (session: Session | undefined) => void,
  onFrame: (frame: Frame) => void,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Screen definition={definition} create={harnessState.create} onSession={onSession} onFrame={onFrame} />,
    );
  });
  return renderer;
}

function updateScreen(
  renderer: ReactTestRenderer,
  definition: Definition,
  harnessState: Harness,
  onSession: (session: Session | undefined) => void,
  onFrame: (frame: Frame) => void,
): void {
  act(() => {
    renderer.update(
      <Screen definition={definition} create={harnessState.create} onSession={onSession} onFrame={onFrame} />,
    );
  });
}

describe('hook + borrowed presentation (GameView contract)', () => {
  it('starts the session once through binding, never through the hook', () => {
    const state = harness();
    const frames: Frame[] = [];
    const renderer = mountScreen(state, () => {}, (frame) => frames.push(frame));

    const session = state.created[0]!;
    assert.equal(session.status, 'running', 'binding starts the session');
    assert.equal(frames.length, 1, 'the renderer receives the initial frame immediately');

    const driver = state.drivers[0]!;
    driver.fireNext(0);
    driver.fireNext(16.7);
    assert.ok(frames.length >= 2, 'commits flow at simulation frequency');

    act(() => renderer.unmount());
    assert.equal(session.status, 'disposed', 'the owner disposes on unmount');
    assert.equal(driver.pendingCount, 0, 'binding cancels its frame request on cleanup');
  });

  it('same-definition re-renders keep the running session bound', () => {
    const state = harness();
    const frames: Frame[] = [];
    const renderer = mountScreen(state, () => {}, (frame) => frames.push(frame));
    const session = state.created[0]!;

    updateScreen(renderer, definition, state, () => {}, (frame) => frames.push(frame));
    assert.equal(state.created.length, 1);
    assert.equal(session.status, 'running', 're-render does not disturb the binding');
    assert.equal(frames.length, 1, 'no duplicate initial frame after a re-render');

    act(() => renderer.unmount());
  });

  it('replacement retires the old generation before the new one binds', () => {
    const state = harness();
    const renderer = mountScreen(state, () => {}, () => {});
    const first = state.created[0]!;

    updateScreen(renderer, otherDefinition, state, () => {}, () => {});
    const second = state.created[1]!;

    assert.equal(first.status, 'disposed', 'the replaced session is terminally retired');
    assert.equal(second.status, 'running', 'the replacement binds and starts');
    assert.throws(() => first.start(), GameSessionDisposedError, 'a retired session cannot restart');

    act(() => renderer.unmount());
    assert.equal(second.status, 'disposed');
  });

  it('old pointer input cannot dispatch into the replacement session', () => {
    const state = harness();
    const frames: Frame[] = [];
    const renderer = mountScreen(state, () => {}, (frame) => frames.push(frame));
    const first = state.created[0]!;
    first.input.begin('steer', 1, { x: 40, y: 90 });
    state.drivers[0]!.fireNext(0);
    state.drivers[0]!.fireNext(16.7);

    updateScreen(renderer, otherDefinition, state, () => {}, (frame) => frames.push(frame));
    const second = state.created[1]!;

    assert.equal(first.status, 'disposed');
    assert.equal(second.status, 'running');
    second.input.begin('steer', 1, { x: 240, y: 90 });
    state.drivers[1]!.fireNext(0);
    state.drivers[1]!.fireNext(16.7);

    const last = frames.at(-1);
    assert.ok(last !== undefined);
    assert.equal((last.current as { x: number }).x, 240, 'the new generation samples its own pointer');
    // 1 mount envelope + 2 first-generation frames + 1 replacement envelope
    // + 2 second-generation frames.
    assert.equal(frames.length, 6);
    assert.equal(state.drivers[0]!.pendingCount, 0, 'the retired generation holds no pending frame');
    assert.throws(
      () => state.drivers[0]!.fireNext(100),
      /No frame is pending/,
      'nothing can drive the retired generation after retirement',
    );

    act(() => renderer.unmount());
    assert.equal(second.status, 'disposed');
  });

  it('an imperatively created session still binds and is never disposed by the presenter', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(definition, { frameDriver: driver });
    const frames: Frame[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Presenter session={session as Session} onFrame={(frame) => frames.push(frame)} />,
      );
    });

    assert.equal(session.status, 'running');
    assert.equal(frames.length, 1);

    act(() => renderer.unmount());
    assert.equal(session.status, 'paused', 'the presenter pauses but never disposes a borrowed session');
    assert.notEqual(session.status, 'disposed');
    session.dispose();
    assert.equal(session.status, 'disposed');
  });
});
