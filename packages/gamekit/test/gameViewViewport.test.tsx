/**
 * Mounted viewport publication and input agreement. Native module boundaries
 * are mocked; the real GameView, pointer adapter, viewport binding, and session
 * run together. Publication counts are RN setter calls, not device FPS data.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, useContext, useState } from 'react';
import { act, create } from 'react-test-renderer';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { defineGame, defineScene } from '../src/index';
import type { GameViewport } from '../src/react/GameView';
import type { PointerSample2D } from '../src/react/pointerBinding';
import type { Viewport } from '../src/viewport2d';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

function host(tag: string) {
  return function Host({ children, ...props }: Record<string, unknown>): unknown {
    return createElement(tag, props as never, children as never);
  };
}

const sharedCounters = new WeakMap<object, { reads: number; writes: number }>();
const scheduled: Array<() => void> = [];
let gesture: Record<string, (event: unknown) => void> = {};

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
  },
});
mock.module('@shopify/react-native-skia', { namedExports: { Canvas: host('canvas') } });
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: host('gesture'),
    GestureStateManager: { activate: () => {}, deactivate: () => {}, fail: () => {} },
    useManualGesture: (config: typeof gesture) => { gesture = config; return config; },
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    makeMutable: (initial: unknown) => ({ value: initial }),
    useSharedValue: (initial: unknown) => useState(() => {
      let value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const counter = { reads: 0, writes: 0 };
      const shared = {
        get value() { counter.reads += 1; return value; },
        set value(next: unknown) { counter.writes += 1; value = next; },
      };
      sharedCounters.set(shared, counter);
      return shared;
    })[0],
    useFrameCallback: () => {},
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: () => ({}),
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    scheduleOnUI: (callback: (...args: never[]) => void, ...args: never[]) => callback(...args),
    scheduleOnRN: (callback: (...args: never[]) => void, ...args: never[]) => {
      scheduled.push(() => callback(...args));
    },
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let viewModule: typeof import('../src/react/GameView');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pointerModule: typeof import('../src/react/GamePointerInput');
before(async () => {
  viewModule = await import('../src/react/GameView.tsx');
  pointerModule = await import('../src/react/GamePointerInput.tsx');
});

function createSession(viewport: Viewport = {
  logicalSize: { width: 320, height: 180 }, mode: 'fit',
}) {
  const driver = new ManualFrameDriver();
  const definition = defineGame({
    viewport,
    input: { primary: { type: 'pointer' } },
    scenes: {
      main: defineScene({
        actions: ['primary'],
        create: () => ({ active: false }),
        update: ({ input }) => ({ active: input.pointer('primary').active }),
        snapshot: ({ state }) => state,
      }),
    },
    initialScene: 'main',
  });
  return { driver, game: createGameSessionWithDriver(definition, { frameDriver: driver, fixedStepMs: 10 }) };
}

async function mount(game: ReturnType<typeof createSession>['game']) {
  scheduled.length = 0;
  let viewportContext: GameViewport | null = null;
  let rendererViewport: GameViewport['viewport'] | undefined;
  let rendererFrame: unknown;
  let renderCount = 0;
  const samples: PointerSample2D[] = [];
  const instrumentation = { onPointerSample: (sample: PointerSample2D) => { samples.push(sample); } };
  function Probe() {
    viewportContext = useContext(viewModule.GameViewportContext);
    return null;
  }
  function Renderer({ viewport, frame }: { viewport: GameViewport['viewport']; frame: unknown }) {
    rendererViewport = viewport;
    rendererFrame = frame;
    renderCount += 1;
    return null;
  }
  function element(session: typeof game) {
    return createElement(viewModule.GameView as never, {
      game: session, renderer: Renderer,
      children: createElement('overlay', null,
        createElement(Probe),
        createElement(pointerModule.GamePointerInput as never, {
          game: session, action: 'primary', instrumentation,
        } as never)),
    } as never);
  }
  let mounted!: ReturnType<typeof create>;
  await act(async () => { mounted = create(element(game)); });
  return {
    get context(): GameViewport { assert.ok(viewportContext); return viewportContext; },
    get viewport(): GameViewport['viewport'] { assert.ok(rendererViewport); return rendererViewport; },
    get frame(): unknown { return rendererFrame; },
    get renderCount(): number { return renderCount; },
    samples,
    async layout(width: number, height: number) {
      const surface = mounted.root.findAll((node) => node.type === 'view' && !!node.props.onLayout)[0];
      assert.ok(surface);
      await act(async () => { surface.props.onLayout({ nativeEvent: { layout: { width, height } } }); });
    },
    async replace(session: typeof game) { await act(async () => { mounted.update(element(session)); }); },
    async unmount() { await act(async () => { mounted.unmount(); }); },
  };
}

async function down(id: number, x: number, y: number) {
  await act(async () => {
    gesture.onTouchesDown?.({ changedTouches: [{ id, x, y }], numberOfTouches: 1, handlerTag: 7 });
    for (const callback of scheduled.splice(0)) callback();
  });
}

function assertAgreement(mounted: Awaited<ReturnType<typeof mount>>) {
  assert.equal(mounted.context.viewport, mounted.viewport, 'renderer and input share the same value');
  assert.equal(mounted.viewport.value, mounted.context.binding.resolved, 'both observe the same layout');
}

describe('mounted GameView viewport publication', () => {
  it('accepts the fitted left edge through the real adapter while rejecting the letterbox', async () => {
    const { game } = createSession({ logicalSize: { width: 360, height: 180 }, mode: 'fit' });
    const mounted = await mount(game);
    try {
      await mounted.layout(393, 852);
      assertAgreement(mounted);
      await down(1, 0, 0);
      assert.equal(mounted.samples.length, 0, 'letterbox space is rejected before RN conversion');
      await down(2, 0, 426);
      assert.equal(mounted.samples.length, 1, 'the surface-aligned edge survives UI containment');
      assert.equal(mounted.samples[0]!.world.x, 0);
      assert.ok(Math.abs(mounted.samples[0]!.world.y - 90) < 1e-10);
      assert.equal(mounted.samples[0]!.viewport, mounted.viewport.value);
    } finally {
      await mounted.unmount();
      game.dispose();
    }
  });

  it('ignores duplicate measurements without UI reads, drag cancellation, or presentation restart', async () => {
    const { game, driver } = createSession();
    const mounted = await mount(game);
    try {
      await mounted.layout(640, 480);
      assertAgreement(mounted);
      await down(1, 0, 60);
      assert.deepEqual(mounted.samples.at(-1)?.world, { x: 0, y: 0 });
      driver.fireNext(0);
      driver.fireNext(10);
      assert.equal(game.getRenderFrame().current.active, true);
      const frame = game.getRenderFrame();
      const presentation = mounted.frame;
      const renderCount = mounted.renderCount;
      const counters = sharedCounters.get(mounted.viewport)!;
      const before = { ...counters };
      const revision = mounted.context.binding.revision;
      const pending = driver.pendingCount;

      await mounted.layout(640, 480);
      await mounted.layout(640, 480);
      assert.deepEqual(counters, before, 'unchanged layouts perform neither a shared read nor publication');
      assert.equal(mounted.context.binding.revision, revision);
      assert.deepEqual(game.getRenderFrame(), frame, 'layout never advances or resets the simulation');
      assert.equal(mounted.frame, presentation);
      assert.equal(mounted.renderCount, renderCount);
      assert.equal(driver.pendingCount, pending);
      driver.fireNext(20);
      assert.equal(game.getRenderFrame().current.active, true, 'an unchanged layout preserves the live drag');

      const beforeResize = game.getRenderFrame();
      await mounted.layout(800, 480);
      assert.equal(counters.writes, before.writes + 1, 'the real revision publishes once');
      assert.equal(counters.reads, before.reads, 'resize does not read the UI-owned viewport');
      assertAgreement(mounted);
      assert.equal(mounted.context.binding.revision, revision + 1);
      assert.deepEqual(game.getRenderFrame(), beforeResize);
      assert.equal(mounted.frame, presentation);
      assert.equal(mounted.renderCount, renderCount);
      assert.equal(game.status, 'running');
      driver.fireNext(30);
      assert.equal(game.getRenderFrame().current.active, false, 'a real revision cancels old coordinates');
      await down(2, 800, 465);
      assert.deepEqual(mounted.samples.at(-1)?.world, { x: 320, y: 180 });
      assert.equal(mounted.samples.at(-1)?.viewport, mounted.viewport.value);
    } finally {
      await mounted.unmount();
      game.dispose();
    }
  });

  it('clears presentation and input at zero size, then recovers the same session', async () => {
    const { game, driver } = createSession();
    const mounted = await mount(game);
    try {
      await mounted.layout(640, 480);
      await down(1, 320, 240);
      driver.fireNext(0);
      driver.fireNext(10);
      assert.equal(game.getRenderFrame().current.active, true);
      const presentation = mounted.frame;
      const counters = sharedCounters.get(mounted.viewport)!;
      const writes = counters.writes;
      await mounted.layout(0, 480);
      assertAgreement(mounted);
      assert.equal(mounted.viewport.value, undefined);
      assert.equal(counters.writes, writes + 1);
      await mounted.layout(0, 480);
      assert.equal(counters.writes, writes + 1, 'duplicate invalid layouts need no publication');
      driver.fireNext(20);
      assert.equal(game.getRenderFrame().current.active, false);
      const sampleCount = mounted.samples.length;
      await down(2, 320, 240);
      assert.equal(mounted.samples.length, sampleCount, 'zero-sized surfaces reject begins');

      await mounted.layout(640, 480);
      assertAgreement(mounted);
      assert.equal(counters.writes, writes + 2);
      assert.equal(mounted.frame, presentation);
      assert.equal(game.status, 'running');
      await down(3, 640, 420);
      assert.deepEqual(mounted.samples.at(-1)?.world, { x: 320, y: 180 });
      driver.fireNext(30);
      assert.equal(game.getRenderFrame().current.active, true);
    } finally {
      await mounted.unmount();
      game.dispose();
    }
  });

  it('re-resolves a replacement session viewport without another native layout event', async () => {
    const first = createSession();
    const second = createSession({ logicalSize: { width: 160, height: 120 }, mode: 'fit' });
    const mounted = await mount(first.game);
    try {
      await mounted.layout(640, 480);
      const originalBinding = mounted.context.binding;
      const originalShared = mounted.viewport;
      const originalPresentation = mounted.frame;
      const writes = sharedCounters.get(originalShared)!.writes;
      await mounted.replace(second.game);
      assertAgreement(mounted);
      assert.notEqual(mounted.context.binding, originalBinding);
      assert.equal(mounted.viewport, originalShared, 'the mounted surface keeps its shared value');
      assert.notEqual(mounted.frame, originalPresentation, 'presentation belongs to the new session');
      assert.deepEqual(mounted.viewport.value?.surfaceSize, { width: 640, height: 480 });
      assert.equal(mounted.viewport.value?.scale, 4);
      assert.equal(sharedCounters.get(originalShared)!.writes, writes + 1);
      assert.equal(first.game.status, 'paused');
      assert.equal(second.game.status, 'running');
      await down(1, 640, 480);
      assert.deepEqual(mounted.samples.at(-1)?.world, { x: 160, y: 120 });
      assert.equal(mounted.samples.at(-1)?.viewport, mounted.viewport.value);
      await mounted.layout(640, 480);
      assert.equal(sharedCounters.get(originalShared)!.writes, writes + 1);
    } finally {
      await mounted.unmount();
      first.game.dispose();
      second.game.dispose();
    }
  });
});
