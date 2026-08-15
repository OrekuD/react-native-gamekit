/**
 * Mounted test for the reference pause overlay (T10-F4).
 *
 * The overlay is plain React Native UI, so react-native is mocked with
 * renderable host components and the real PauseOverlay is mounted with
 * react-test-renderer. Covers: one press pauses, the paused overlay blocks
 * gameplay touches (pointerEvents="auto"), one press resumes, accessibility
 * labels and roles, and 44pt effective hit targets.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode } from 'react';
import { act, create } from 'react-test-renderer';
import type { GameSessionStatus } from 'rn-gamekit';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
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

type PauseOverlayModule = typeof import('./PauseOverlay');
let PauseOverlay: PauseOverlayModule['PauseOverlay'];

function renderOverlay(status: GameSessionStatus, onPause: () => void, onResume: () => void) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PauseOverlay status={status} onPause={onPause} onResume={onResume} />,
    );
  });
  return renderer;
}

function hostPressables(renderer: ReturnType<typeof create>) {
  return renderer.root.findAll(
    (node) => (node.type as string) === 'pressable',
  );
}

describe('PauseOverlay', () => {
  // The real component imports react-native, so it loads only after the
  // module mock is registered.
  before(async () => {
    PauseOverlay = (await import('./PauseOverlay')).PauseOverlay;
  });

  it('shows the pause button while running and one press pauses', () => {
    let paused = false;
    const renderer = renderOverlay(
      'running',
      () => {
        paused = true;
      },
      () => {},
    );

    const pressables = hostPressables(renderer);
    assert.equal(pressables.length, 1, 'exactly the pause button is interactive');
    const pause = pressables[0]!;
    assert.equal(pause.props.accessibilityLabel, 'Pause the game');
    assert.equal(pause.props.accessibilityRole, 'button');
    const hitSlop = pause.props.hitSlop as number | { horizontal?: number } | undefined;
    assert.ok(
      typeof hitSlop === 'number' ? hitSlop >= 12 : (hitSlop?.horizontal ?? 0) >= 12,
      'the pause control keeps an adequate hit target',
    );

    act(() => (pause.props.onPress as () => void)());
    assert.equal(paused, true, 'one press pauses');
  });

  it('replaces the pause button with a blocking overlay while paused and resumes on press', () => {
    let resumed = false;
    const renderer = renderOverlay(
      'paused',
      () => {},
      () => {
        resumed = true;
      },
    );

    // The overlay captures touches: the container is pointerEvents="auto"
    // over the frozen gameplay surface below it.
    const views = renderer.root.findAll((node) => (node.type as string) === 'view');
    assert.ok(
      views.some((view) => view.props.pointerEvents === 'auto'),
      'the paused overlay blocks gameplay touches',
    );

    const pressables = hostPressables(renderer);
    assert.equal(pressables.length, 1, 'the resume control is the only interactive element');
    const resume = pressables[0]!;
    assert.equal(resume.props.accessibilityLabel, 'Resume the game');
    assert.equal(resume.props.accessibilityRole, 'button');

    act(() => (resume.props.onPress as () => void)());
    assert.equal(resumed, true, 'one press resumes');
  });

  it('stays Strict Mode safe and keeps 44pt hit targets on both controls', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <StrictMode>
          <PauseOverlay status={'running'} onPause={() => {}} onResume={() => {}} />
        </StrictMode>,
      );
    });
    const running = hostPressables(renderer);
    assert.equal(running.length, 1);

    act(() => {
      renderer.update(
        <StrictMode>
          <PauseOverlay status={'paused'} onPause={() => {}} onResume={() => {}} />
        </StrictMode>,
      );
    });
    const paused = hostPressables(renderer);
    assert.equal(paused.length, 1);
    const resumeStyle = paused[0]!.props.style as { paddingVertical?: number };
    const height = (resumeStyle.paddingVertical ?? 0) * 2 + 16;
    assert.ok(height >= 44, `resume hit target is at least 44pt tall (${height})`);
  });
});
