/**
 * T10.6: GameView-level pause/lifecycle composition at the headless seams.
 *
 * GameView itself needs native Skia, so its exact wiring is exercised here
 * through the same primitives it composes — a core status subscription
 * driving the presentation gate, `bindGameSession` for borrowed
 * start/pause, and `bindAppLifecycle` against a fake AppState source. The
 * GameView component file is typechecked by the package build.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';

import { defineGame, defineScene, type CommitFrame, type GameSession, type GameSessionStatus } from '../src/index';
import { bindAppLifecycle, type AppLifecycleSource } from '../src/react/bindAppLifecycle';
import { bindGameSession } from '../src/react/bindGameSession';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {},
  scenes: {
    play: defineScene({
      actions: [],
      create: () => ({ ticks: 0 }),
      update: ({ state }) => ({ ticks: state.ticks + 1 }),
      snapshot: ({ state }) => state,
    }),
  },
  initialScene: 'play',
});

type Definition = typeof game;
type Session = GameSession<Definition['scenes'], Definition['input']>;

/** Fake AppState source with an externally controlled current state. */
type FakeAppState = AppLifecycleSource & { setState(next: string): void };

function fakeAppState(initial: string | null): FakeAppState {
  let state = initial;
  const listeners = new Set<(next: string) => void>();
  return {
    get currentState() {
      return state;
    },
    setState(next: string) {
      state = next;
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
    addEventListener(_event: 'change', listener: (next: string) => void) {
      listeners.add(listener);
      return {
        remove() {
          listeners.delete(listener);
        },
      };
    },
  } as FakeAppState;
}

function createSession(): Session {
  return createGameSessionWithDriver(game, { frameDriver: new ManualFrameDriver() });
}

interface PresenterProps {
  readonly session: Session | undefined;
  readonly appState: AppLifecycleSource & { setState(next: string): void };
  readonly onStatus: (status: GameSessionStatus) => void;
  readonly onFrame: (frame: CommitFrame<Definition['scenes']>) => void;
}

/**
 * The GameView wiring, headless: core status drives the presentation gate,
 * the binding borrows the session, and the app lifecycle owns only its own
 * pause. `running` mirrors GameView's UI-thread shared value.
 */
function Presenter({ session, appState, onStatus, onFrame }: PresenterProps): null {
  useEffect(() => {
    if (session === undefined) {
      return;
    }
    const report = (status: GameSessionStatus): void => {
      onStatus(status);
    };
    const statusSubscription = session.addStatusListener(report);
    const cleanupBinding = bindGameSession(session, (frame) => onFrame(frame));
    const cleanupLifecycle = bindAppLifecycle(appState, {
      getStatus: () => session.status,
      pause: () => {
        if (session.status !== 'disposed') {
          session.pause();
        }
      },
      resume: () => {
        if (session.status !== 'disposed') {
          session.start();
        }
      },
      addStatusListener: (listener) => session.addStatusListener(listener),
    });
    return () => {
      cleanupLifecycle();
      cleanupBinding();
      statusSubscription.remove();
    };
    // appState is a stable per-test instance; the callbacks are stable, so
    // the session is the only meaningful dependency.
  }, [session]);
  return null;
}

function mountPresenter(
  session: Session | undefined,
  appState: FakeAppState,
  onStatus: (status: GameSessionStatus) => void,
  onFrame: (frame: CommitFrame<Definition['scenes']>) => void,
): void {
  act(() => {
    create(
      <Presenter session={session} appState={appState} onStatus={onStatus} onFrame={onFrame} />,
    );
  });
}

describe('GameView pause/lifecycle composition', () => {
  it('freezes presentation on a direct session.pause() and resumes on start()', () => {
    const session = createSession();
    const statuses: GameSessionStatus[] = [];
    const frames: CommitFrame<Definition['scenes']>[] = [];
    mountPresenter(session, fakeAppState('active'), (status) => statuses.push(status), (frame) =>
      frames.push(frame),
    );

    assert.equal(session.status, 'running', 'the binding starts the session');
    const runningFrames = frames.length;

    act(() => session.pause());
    assert.equal(session.status, 'paused');
    assert.deepEqual(statuses.slice(-1), ['paused'], 'the presentation gate follows core status');
    assert.equal(frames.length, runningFrames, 'no frames are presented while paused');

    act(() => session.start());
    assert.deepEqual(statuses.slice(-1), ['running']);
    assert.equal(session.status, 'running');

    act(() => session.dispose());
  });

  it('backgrounding pauses and foregrounding resumes only the lifecycle-owned pause', () => {
    const session = createSession();
    const appState = fakeAppState('active');
    const statuses: GameSessionStatus[] = [];
    mountPresenter(session, appState, (status) => statuses.push(status), () => {});

    act(() => appState.setState('background'));
    assert.equal(session.status, 'paused', 'backgrounding pauses the running session');

    act(() => appState.setState('active'));
    assert.equal(session.status, 'running', 'foreground resumes the lifecycle-owned pause');
    assert.deepEqual(statuses, ['running', 'paused', 'running']);

    act(() => session.dispose());
  });

  it('never lets foregrounding override a user pause', () => {
    const session = createSession();
    const appState = fakeAppState('active');
    mountPresenter(session, appState, () => {}, () => {});

    act(() => session.pause());
    act(() => appState.setState('background'));
    act(() => appState.setState('active'));

    assert.equal(session.status, 'paused', 'the user pause is not claimed or resumed');
    act(() => session.dispose());
  });

  it('returns an externally started session to paused while the app is inactive', () => {
    const session = createSession();
    const appState = fakeAppState('active');
    mountPresenter(session, appState, () => {}, () => {});

    act(() => appState.setState('background'));
    assert.equal(session.status, 'paused');

    // External code starts the session while the host is still inactive.
    act(() => session.start());
    assert.equal(
      session.status,
      'paused',
      'the binder deterministically re-pauses an external start while inactive',
    );

    act(() => appState.setState('active'));
    assert.equal(session.status, 'running', 'the binder-owned pause resumes on foreground');
    act(() => session.dispose());
  });

  it('binds a replacement session while the old one is paused, atomically', () => {
    const first = createSession();
    const second = createSession();
    const appState = fakeAppState('active');
    const statuses: Array<GameSessionStatus | undefined> = [];
    let current: Session | undefined = first;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Presenter
          session={current}
          appState={appState}
          onStatus={(status) => statuses.push(status)}
          onFrame={() => {}}
        />,
      );
    });

    act(() => first.pause());
    assert.equal(first.status, 'paused');

    act(() => {
      current = second;
      renderer.update(
        <Presenter
          session={current}
          appState={appState}
          onStatus={(status) => statuses.push(status)}
          onFrame={() => {}}
        />,
      );
    });

    assert.equal(first.status, 'paused', 'the old session is left paused, not disposed by the view');
    assert.equal(second.status, 'running', 'the replacement binds and starts');

    act(() => first.dispose());
    act(() => second.dispose());
  });

  it('unbind pauses a borrowed session and never disposes it', () => {
    const session = createSession();
    const appState = fakeAppState('active');
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Presenter session={session} appState={appState} onStatus={() => {}} onFrame={() => {}} />,
      );
    });
    assert.equal(session.status, 'running');

    act(() => renderer.unmount());
    assert.equal(session.status, 'paused', 'unbind pauses through the binding');
    assert.notEqual(session.status, 'disposed', 'the view never terminally disposes');
    act(() => session.dispose());
  });
});
