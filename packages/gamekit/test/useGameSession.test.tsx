/**
 * RED (T9.1): behavioral contract for `useOwnedGameSession` — the internal
 * injectable-creator seam behind the public `useGameSession` hook.
 *
 * Every test drives the hook through react-test-renderer with a
 * `ManualFrameDriver` (node has no requestAnimationFrame, so the public
 * default driver cannot run here). The seam must be stable across renders.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { defineGame, defineScene, type GameSession } from '../src/index';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { useOwnedGameSession } from '../src/react/useGameSession';
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
      update: ({ state }) => state,
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
});

type Definition = typeof definition;
type Session = GameSession<Definition['scenes'], Definition['input']>;

const otherDefinition: Definition = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {
    steer: { type: 'pointer', description: 'Move the paddle' },
  },
  scenes: {
    play: defineScene({
      actions: ['steer'],
      create: () => ({ x: 100 }),
      update: ({ state }) => state,
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
});

interface ProbeProps {
  readonly definition: Definition;
  readonly create: (definition: Definition) => Session;
  readonly onSession: (session: Session | undefined) => void;
}

/** Renders only the hook; reports every published value during render. */
function Probe({ definition, create, onSession }: ProbeProps): null {
  const session = useOwnedGameSession(definition, create);
  onSession(session);
  return null;
}

class ErrorBoundary extends Component<
  { readonly onError: (error: Error) => void; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function harness(): {
  readonly create: (definition: Definition) => Session;
  readonly created: Session[];
  readonly drivers: ManualFrameDriver[];
} {
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

function mountProbe(
  createSession: (definition: Definition) => Session,
  onSession: (session: Session | undefined) => void,
  options: { readonly strict?: boolean } = {},
): ReactTestRenderer {
  const probe = <Probe definition={definition} create={createSession} onSession={onSession} />;
  const node = options.strict ? <StrictMode>{probe}</StrictMode> : probe;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(node);
  });
  return renderer;
}

function updateProbe(
  renderer: ReactTestRenderer,
  next: Definition,
  createSession: (definition: Definition) => Session,
  onSession: (session: Session | undefined) => void,
): void {
  act(() => {
    renderer.update(<Probe definition={next} create={createSession} onSession={onSession} />);
  });
}

describe('useOwnedGameSession (hook seam)', () => {
  it('publishes undefined on the initial render, then one idle live session', () => {
    const { create, created } = harness();
    const published: Array<Session | undefined> = [];
    const renderer = mountProbe(create, (session) => published.push(session));

    assert.equal(published[0]!, undefined, 'initial render exposes no session');
    const live = published.filter((session): session is Session => session !== undefined);
    assert.equal(live.length, 1, 'exactly one live session is published');
    assert.equal(created.length, 1);
    assert.equal(live[0]!.status, 'idle', 'the hook never starts the session');

    act(() => renderer.unmount());
    assert.equal(created[0]!.status, 'disposed', 'unmount disposes exactly once');
  });

  it('preserves strict session identity across same-definition re-renders', () => {
    const { create, created } = harness();
    const published: Array<Session | undefined> = [];
    const renderer = mountProbe(create, (session) => published.push(session));

    updateProbe(renderer, definition, create, (session) => published.push(session));
    updateProbe(renderer, definition, create, (session) => published.push(session));

    assert.equal(created.length, 1, 'no second session for the same definition');
    const live = published.filter((session): session is Session => session !== undefined);
    assert.equal(new Set(live).size, 1, 'the same session object is returned every time');
    assert.equal(live.at(-1)!, created[0]!);

    act(() => renderer.unmount());
    assert.equal(created[0]!.status, 'disposed');
  });

  it('unpublishes the old session before disposal during definition replacement', () => {
    const { create, created } = harness();
    const published: Array<Session | undefined> = [];
    const renderer = mountProbe(create, (session) => published.push(session));
    const first = created[0]!;

    updateProbe(renderer, otherDefinition, create, (session) => published.push(session));

    const tail = published.slice(-3);
    assert.equal(tail[0], first, 'the old session was still published before the swap');
    assert.equal(tail[1], undefined, 'the replacement render unpublishes before any effect');
    assert.notEqual(tail[2], first, 'a fresh session is published');
    assert.equal(created.length, 2);
    assert.equal(first.status, 'disposed', 'the replaced session is disposed exactly once');
    assert.equal(created[1]!.status, 'idle');

    act(() => renderer.unmount());
    assert.equal(created[1]!.status, 'disposed');
  });

  it('creates a fresh session when returning to a previous definition', () => {
    const { create, created } = harness();
    const renderer = mountProbe(create, () => {});
    const first = created[0]!;

    updateProbe(renderer, otherDefinition, create, () => {});
    const second = created[1]!;
    updateProbe(renderer, definition, create, () => {});

    assert.equal(created.length, 3, 'returning to a definition creates a new session');
    assert.notEqual(created[2]!, first, 'disposed sessions are never revived');
    assert.equal(first.status, 'disposed');
    assert.equal(second.status, 'disposed');
    assert.equal(created[2]!.status, 'idle');

    act(() => renderer.unmount());
    assert.equal(created[2]!.status, 'disposed');
  });

  it('never publishes a disposed session under Strict Mode rehearsal', () => {
    const { create, created } = harness();
    const published: Array<{ session: Session | undefined; status: string | undefined }> = [];
    const renderer = mountProbe(
      create,
      (session) => published.push({ session, status: session?.status }),
      { strict: true },
    );

    // Strict Mode: create A, publish A, cleanup (dispose A), create B, publish B.
    assert.equal(created.length, 2, 'the rehearsal creates exactly two sessions');
    for (const entry of published) {
      if (entry.session !== undefined) {
        assert.equal(entry.status, 'idle', 'a session is never published while disposed');
      }
    }
    const live = published
      .map((entry) => entry.session)
      .filter((session): session is Session => session !== undefined);
    assert.equal(live.at(-1)!, created[1]!, 'the committed owner is the second rehearsal session');
    assert.equal(created[0]!.status, 'disposed', 'the rehearsal session is disposed exactly once');
    assert.equal(created[1]!.status, 'idle', 'the committed session stays live');

    act(() => renderer.unmount());
    assert.equal(created[1]!.status, 'disposed');
  });

  it('propagates session-creation errors to the error boundary untouched', () => {
    const errors: Error[] = [];
    const { drivers } = harness();
    const throwingCreate = (): Session => {
      throw new Error('boom');
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary onError={(error) => errors.push(error)}>
          <Probe definition={definition} create={throwingCreate as never} onSession={() => {}} />
        </ErrorBoundary>,
      );
    });

    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.message, 'boom', 'the original error is preserved');
    assert.equal(drivers.length, 0, 'no session was half-created');

    act(() => renderer.unmount());
  });

  it('introduces no timers, frame callbacks, or commit listeners by itself', () => {
    const { create, drivers } = harness();
    const renderer = mountProbe(create, () => {});

    for (const driver of drivers) {
      assert.equal(driver.pendingCount, 0, 'an idle hook-owned session requests no frames');
    }
    assert.equal(createdSessionStatus(renderer, create), 'idle');

    act(() => renderer.unmount());
  });
});

function createdSessionStatus(
  renderer: ReactTestRenderer,
  createSession: (definition: Definition) => Session,
): string {
  let status = '';
  act(() => {
    renderer.update(
      <Probe definition={definition} create={createSession} onSession={(session) => {
        if (session !== undefined) {
          status = session.status;
        }
      }} />,
    );
  });
  return status;
}
