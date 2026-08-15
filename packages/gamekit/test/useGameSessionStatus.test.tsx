/**
 * RED (T10.5): useGameSessionStatus — a thin useSyncExternalStore adapter
 * over the core status subscription.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// React 19's test renderer needs the act-environment flag for updates
// scheduled from outside act() to flush deterministically.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useState } from 'react';
import { defineGame, defineScene, type GameSession, type GameSessionStatus } from '../src/index';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { useGameSessionStatus } from '../src/react/useGameSessionStatus';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';
import { statusCountDiagnostics } from './helpers/statusCountDiagnostics';

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

type Session = GameSession<typeof game['scenes'], typeof game['input']>;

function createSession(
  diagnostics?: ReturnType<typeof statusCountDiagnostics>['diagnostics'],
): Session {
  return createGameSessionWithDriver(game, {
    frameDriver: new ManualFrameDriver(),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}



interface ProbeProps {
  readonly session: Session | undefined;
  readonly onStatus: (status: GameSessionStatus | undefined) => void;
}

function Probe({ session, onStatus }: ProbeProps): null {
  const status = useGameSessionStatus(session);
  onStatus(status);
  return null;
}

function TogglingParent({
  session,
  onStatus,
}: {
  readonly session: Session;
  readonly onStatus: (status: GameSessionStatus | undefined) => void;
}) {
  const [tick, setTick] = useState(0);
  void tick;
  return (
    <>
      <Probe session={session} onStatus={onStatus} />
      <button onClick={() => setTick((n) => n + 1)}>toggle</button>
    </>
  );
}

describe('useGameSessionStatus', () => {
  it('returns undefined for an absent session and the current status otherwise', () => {
    const statuses: Array<GameSessionStatus | undefined> = [];
    const session = createSession();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Probe session={undefined} onStatus={(status) => statuses.push(status)} />);
    });
    assert.deepEqual([...statuses], [undefined], 'no session means undefined');

    act(() => {
      renderer.update(<Probe session={session} onStatus={(status) => statuses.push(status)} />);
    });
    assert.equal(statuses.at(-1), 'idle', 'the current status is observed on the next render');

    act(() => session.start());
    assert.equal(statuses.at(-1), 'running');
    act(() => session.pause());
    assert.equal(statuses.at(-1), 'paused');
    act(() => session.start());
    act(() => session.dispose());
    assert.equal(statuses.at(-1), 'disposed');
  });

  it('reflects a session that is already running at mount and external transitions', async () => {
    const statuses: Array<GameSessionStatus | undefined> = [];
    const runningSession = createSession();
    runningSession.start();
    // A session already running when the component mounts is observed on the
    // very first render: the snapshot is read at render time, so no stale
    // 'idle' frame is ever reported.
    act(() => {
      create(<Probe session={runningSession} onStatus={(status) => statuses.push(status)} />);
    });
    assert.deepEqual([...statuses], ['running'], 'the current status is the first render value');

    // A transition started entirely outside React is observed after the next
    // act flush (the subscription re-reads the snapshot).
    const session = createSession();
    act(() => {
      create(<Probe session={session} onStatus={(status) => statuses.push(status)} />);
    });
    assert.equal(statuses.at(-1), 'idle');
    session.start();
    await act(async () => {});
    assert.equal(statuses.at(-1), 'running', 'an external transition is observed after the flush');

    act(() => runningSession.dispose());
    act(() => session.dispose());
  });

  it('detaches from an old session before reporting a replacement status', () => {
    const statuses: Array<GameSessionStatus | undefined> = [];
    const first = createSession();
    const second = createSession();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Probe session={first} onStatus={(status) => statuses.push(status)} />);
    });
    act(() => first.start());
    assert.equal(statuses.at(-1), 'running');

    act(() => {
      renderer.update(<Probe session={second} onStatus={(status) => statuses.push(status)} />);
    });
    assert.equal(statuses.at(-1), 'idle', 'the replacement session reports its own status');

    // A late transition on the OLD session must not be reported.
    act(() => first.pause());
    act(() => first.dispose());
    assert.equal(statuses.at(-1), 'idle', 'no late old-session notification leaks through');

    act(() => second.start());
    assert.equal(statuses.at(-1), 'running');
    act(() => second.dispose());
  });

  it('returns undefined again when the session argument becomes absent', () => {
    const statuses: Array<GameSessionStatus | undefined> = [];
    const session = createSession();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Probe session={session} onStatus={(status) => statuses.push(status)} />);
    });
    act(() => session.start());
    assert.equal(statuses.at(-1), 'running');
    void renderer;

    act(() => {
      renderer.update(<Probe session={undefined} onStatus={(status) => statuses.push(status)} />);
    });
    assert.equal(statuses.at(-1), undefined, 'absent session reverts to undefined');

    act(() => session.pause());
    act(() => session.dispose());
  });

  it('does not rerender on idempotent commands', () => {
    const statuses: Array<GameSessionStatus | undefined> = [];
    const session = createSession();
    act(() => {
      create(<Probe session={session} onStatus={(status) => statuses.push(status)} />);
    });
    const renders = statuses.length;

    act(() => session.start());
    act(() => session.start());
    act(() => session.pause());
    act(() => session.pause());

    // idle -> running -> paused: exactly three new statuses, no noise.
    assert.deepEqual(statuses.slice(renders), ['running', 'paused']);
    act(() => session.dispose());
  });

  it('does not churn the subscription on unrelated re-renders', () => {
    const { diagnostics, counts } = statusCountDiagnostics();
    const session = createSession(diagnostics);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<TogglingParent session={session} onStatus={() => {}} />);
    });
    assert.deepEqual([...counts], [1], 'one subscription after mount');

    // Unrelated parent re-renders with the SAME session must not detach and
    // recreate the subscription.
    for (let index = 0; index < 3; index += 1) {
      act(() => {
        renderer.update(<TogglingParent session={session} onStatus={() => {}} />);
      });
    }
    assert.deepEqual([...counts], [1], 'no unsubscribe/resubscribe churn');

    act(() => session.dispose());
  });

  it('detaches the old session exactly once and attaches the replacement once', () => {
    const { diagnostics, counts } = statusCountDiagnostics();
    const first = createSession(diagnostics);
    const second = createSession(diagnostics);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<TogglingParent session={first} onStatus={() => {}} />);
    });
    assert.deepEqual([...counts], [1]);

    act(() => {
      renderer.update(<TogglingParent session={second} onStatus={() => {}} />);
    });
    assert.deepEqual([...counts], [1, 0, 1], 'exactly one old detach and one new attach');

    act(() => first.dispose());
    act(() => second.dispose());
  });

  it('adds only the Strict Mode rehearsal churn, never per-render churn', () => {
    const { diagnostics, counts } = statusCountDiagnostics();
    const session = createSession(diagnostics);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <StrictMode>
          <TogglingParent session={session} onStatus={() => {}} />
        </StrictMode>,
      );
    });
    // Mount rehearsal: subscribe -> cleanup -> subscribe.
    assert.deepEqual([...counts], [1, 0, 1]);

    act(() => {
      renderer.update(
        <StrictMode>
          <TogglingParent session={session} onStatus={() => {}} />
        </StrictMode>,
      );
    });
    assert.deepEqual([...counts], [1, 0, 1], 'ordinary re-renders add no churn');

    act(() => session.dispose());
  });

  it('subscribes and cleans up safely under Strict Mode', () => {
    const statuses: Array<GameSessionStatus | undefined> = [];
    const session = createSession();
    act(() => {
      create(
        <StrictMode>
          <Probe session={session} onStatus={(status) => statuses.push(status)} />
        </StrictMode>,
      );
    });
    assert.equal(statuses.at(-1), 'idle');

    act(() => session.start());
    assert.equal(statuses.at(-1), 'running');
    act(() => session.dispose());
  });
});
