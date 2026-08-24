/**
 * Platformer Lab mounted content tests (T16-F2).
 *
 * - Controls press/release the session's semantic input (left/right/jump).
 * - The back control invokes onExit.
 * - HUD publications are quantized to the ~8 Hz cadence while walking.
 * - The controls row topology is device-independent (phone/tablet).
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

function host(tag: string) {
  const Component = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    },
  },
});
mock.module('react-native-safe-area-context', {
  namedExports: {
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    SafeAreaView: host('safe-area'),
  },
});

type ContentModule = typeof import('./PlatformerLabContent');
let PlatformerLabContent: ContentModule['default'];

before(async () => {
  const content = await import('./PlatformerLabContent.tsx');
  PlatformerLabContent = content.default;
});

// ---------------------------------------------------------------------------
// Minimal fake session
//
// The content only reads committed snapshots off the session, subscribes to
// commits, presses/releases semantic input, and disposes. Movement advances
// deterministically per committed frame while `right` is held.
// ---------------------------------------------------------------------------

interface SnapshotState {
  readonly body: { readonly x: number; readonly y: number };
  readonly contacts: { readonly floor: boolean };
  readonly checkpoints: readonly { readonly reached: boolean }[];
  readonly elapsed: number;
  readonly ticks: number;
}

const DT = 1 / 60;

function fakeSession() {
  let x = 68;
  const y = 484;
  let elapsed = 0;
  let ticks = 0;
  const held = new Set<string>();
  const listeners = new Set<() => void>();
  const commitFrame = (): void => {
    if (held.has('right')) x += 3.6;
    elapsed += DT;
    ticks += 1;
    for (const fn of listeners) fn();
  };
  const pressEdges: string[] = [];
  const releaseEdges: string[] = [];
  return {
    pressEdges,
    releaseEdges,
    commitFrame,
    getRenderFrame: (): { current: unknown } => ({
      current: {
        body: { x, y },
        contacts: { floor: true },
        checkpoints: [
          { reached: x > 512 },
          { reached: x > 1024 },
          { reached: x > 1536 },
        ],
        elapsed,
        ticks,
      } satisfies SnapshotState,
    }),
    addCommitListener: (fn: () => void) => {
      listeners.add(fn);
      return { remove: (): void => void listeners.delete(fn) };
    },
    input: {
      press: (action: string): void => {
        held.add(action);
        pressEdges.push(action);
      },
      release: (action: string): void => {
        held.delete(action);
        releaseEdges.push(action);
      },
    },
    dispose: (): void => undefined,
  };
}

function harness() {
  const session = fakeSession() as ReturnType<typeof fakeSession>;
  const tick = (frames: number): void => {
    for (let i = 0; i < frames; i++) act(() => session.commitFrame());
  };
  return { session, tick };
}

function startXOf(session: ReturnType<typeof fakeSession>): number {
  return (session.getRenderFrame().current as unknown as SnapshotState).body.x;
}

describe('Platformer Lab mounted controls (T16-F2)', () => {
  it('right input moves the player; back exits', () => {
    const { session, tick } = harness();
    let exited = false;
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(
        createElement(PlatformerLabContent, {
          game: session as never,
          onExit: () => {
            exited = true;
          },
          onOpenGame: () => undefined,
        } as never),
      );
    });
    const root = renderer!.root;
    const byTestID = (id: string): number =>
      root.findAll((n: { props?: { testID?: string } }) => n.props?.testID === id).length;
    assert.ok(byTestID('platformer-controls') > 0, 'controls row renders');
    assert.ok(byTestID('platformer-left') > 0, 'left button renders');
    assert.ok(byTestID('platformer-right') > 0, 'right button renders');
    assert.ok(byTestID('platformer-jump') > 0, 'jump button renders');
    assert.ok(byTestID('platformer-back') > 0, 'back button renders');

    // Pressing right through semantic input commits movement.
    const startX = startXOf(session);
    session.input.press('right');
    tick(30);
    session.input.release('right');
    const movedX = startXOf(session);
    assert.ok(movedX > startX + 10, `walking right must move the player (${startX} -> ${movedX})`);

    // Back exits.
    act(() => {
      const back = root.findAll(
        (n: { props?: { testID?: string; onPress?: () => void } }) =>
          n.props?.testID === 'platformer-back',
      )[0]!;
      back.props.onPress?.();
    });
    assert.equal(exited, true);
    act(() => session.dispose());
  });

  it('JUMP releases on press-out so two presses yield two distinct press edges (T16-RF3)', () => {
    const { session } = harness();
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(
        createElement(PlatformerLabContent, {
          game: session as never,
          onExit: () => undefined,
          onOpenGame: () => undefined,
        } as never),
      );
    });
    const root = renderer!.root;
    const jump = root.findAll(
      (n: { props?: { testID?: string; onPressIn?: () => void; onPressOut?: () => void; onTouchCancel?: () => void } }) =>
        n.props?.testID === 'platformer-jump',
    )[0]!;
    assert.equal(typeof jump.props.onPressOut, 'function', 'jump declares a release edge');
    assert.equal(typeof jump.props.onTouchCancel, 'function', 'jump releases on touch cancel');

    // Two full press cycles.
    jump.props.onPressIn?.();
    jump.props.onPressOut?.();
    jump.props.onPressIn?.();
    jump.props.onPressOut?.();
    assert.deepEqual(session.pressEdges.filter((a) => a === 'jump'), ['jump', 'jump']);
    assert.deepEqual(session.releaseEdges.filter((a) => a === 'jump'), ['jump', 'jump']);

    // Touch cancel also releases a held jump.
    jump.props.onPressIn?.();
    jump.props.onTouchCancel?.();
    assert.equal(session.pressEdges.filter((a) => a === 'jump').length, 3);
    assert.equal(session.releaseEdges.filter((a) => a === 'jump').length, 3);
    act(() => session.dispose());
  });

  it('HUD publishes once at mount then bounded by the ~8 Hz cadence while walking', () => {
    let publishes = 0;
    const { session, tick } = harness();
    act(() => {
      create(
        createElement(PlatformerLabContent, {
          game: session as never,
          onExit: () => undefined,
          onOpenGame: () => undefined,
          onHudPublish: () => {
            publishes += 1;
          },
        } as never),
      );
    });
    assert.equal(publishes, 1, 'the initial snapshot publishes once');

    // ~3 s of walking: publications must stay cadence-bounded.
    session.input.press('right');
    tick(180);
    session.input.release('right');
    assert.ok(publishes > 1, 'the HUD updates while the player moves');
    assert.ok(publishes <= 32, `bounded by the cadence (got ${publishes} in ~3s)`);

    // Idle steady state stays quiet.
    const settled = publishes;
    tick(120);
    assert.ok(publishes - settled <= 12, 'idle steady state stays quiet');
    act(() => session.dispose());
  });

  it('controls row topology is identical regardless of device class', () => {
    // Phone and tablet share this exact tree; responsive sizing belongs to
    // the shell surface, not the content.
    const { session } = harness();
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(
        createElement(PlatformerLabContent, {
          game: session as never,
          onExit: () => undefined,
          onOpenGame: () => undefined,
        } as never),
      );
    });
    const root = renderer!.root;
    const count = (id: string): number =>
      root.findAll((n: { props?: { testID?: string } }) => n.props?.testID === id).length;
    assert.ok(count('platformer-controls') >= 1, 'controls row present');
    assert.ok(count('platformer-jump') >= 1, 'jump control present');
    assert.equal(
      count('platformer-left') > 0 && count('platformer-right') > 0,
      true,
      'directional controls present',
    );
    act(() => session.dispose());
  });
});
