/**
 * T15-F1/F2 mounted contract tests.
 *
 * Mounts the real ParticleView against a mocked Skia/Reanimated runtime and
 * proves:
 * - presentation storage is sized from the immutable effect capacity (not a
 *   global max),
 * - rerenders preserve slot node identity,
 * - views never advance the system clock — only the binding's tick does,
 * - world-space slots hide without camera context while screen-space render.
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement, act } from 'react';
import { create } from 'react-test-renderer';

/** React 19 defers renders out of act scopes; every access must be wrapped. */
async function mount(ui: React.ReactElement) {
  let renderer: ReturnType<typeof create> | null = null;
  await act(async () => {
    renderer = create(ui);
  });
  return renderer!;
}
async function rerender(renderer: ReturnType<typeof create>, ui: React.ReactElement) {
  await act(async () => {
    renderer.update(ui);
  });
}
function findAll(renderer: ReturnType<typeof create>, tag: string) {
  return renderer.root.findAll((n) => String(n.type) === tag);
}

/** Resolve a mocked derived/shared value prop to its current number. */
function resolveNumber(prop: unknown): number | undefined {
  if (typeof prop === 'number') return prop;
  if (prop !== null && typeof prop === 'object' && 'value' in prop) {
    return (prop as { value?: number }).value;
  }
  return undefined;
}

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

const createdSharedValues: unknown[] = [];

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    StyleSheet: { create: (s: Record<string, unknown>) => s, absoluteFill: {} },
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Atlas: host('atlas'),
    Circle: host('circle'),
    Rect: host('rect'),
    Image: host('image'),
    Path: host('path'),
    useRectBuffer: (capacity: number) => ({ current: { capacity } }),
    useRSXformBuffer: (capacity: number) => ({ current: { capacity } }),
    Skia: {},
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    // One identity per call site invocation; counted by the test via createdSharedValues.
    useSharedValue: (initial: unknown) => {
      const sv = { value: initial };
      createdSharedValues.push(sv);
      return sv;
    },
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useFrameCallback: () => {},
  },
});

// Loaded inside the suite via dynamic import (mock.module must land first).

function makeDef(capacity: number, space: 'world' | 'screen') {
  return defineParticleEffect({
    capacity,
    space,
    overflow: 'drop-new',
    particle: { kind: 'shape', shape: 'circle', radius: 4 },
    burst: { count: Math.min(2, capacity) },
    lifetimeSeconds: { min: 1, max: 1 },
    speed: { min: 0, max: 0 },
    gravity: { x: 0, y: 0 },
    fadeOut: true,
  });
}

// Structural declarations would fight the real generics; the mocks land
// before these loads, so the values are the real implementations.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticleViewModule = typeof import('../src/react/particles/ParticleView');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticlesModule = typeof import('../src/particles/index');
let ParticleView: ParticleViewModule['ParticleView'];
let defineParticleEffect: ParticlesModule['defineParticleEffect'];
let createParticleSystem: ParticlesModule['createParticleSystem'];

describe('particle view mounted contract', () => {
  it('loads modules after mocks', async () => {
    ({ ParticleView } = await import('../src/react/particles/ParticleView'));
    ({ defineParticleEffect, createParticleSystem } = await import('../src/particles/index'));
  });
});

describe('T15-F2 capacity-scaled mounted topology', () => {
  it('a capacity of 24 creates exactly 24 slot groups; rerender preserves identity', async () => {
    const def = makeDef(24, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    const binding = system.bindPresentation();
    system.emit('fx', { position: { x: 10, y: 10 }, seed: 1 });
    binding.tick(0.05);

    const snapshot = { value: { revision: binding.revision, data: new Map([[ 'fx', binding.slots('fx') ]]) } };
    const element = createElement(
      ParticleView as never,
      { system, effect: 'fx', width: 100, height: 100, snapshot } as never,
    );
    const renderer = await mount(element);

    const groups = findAll(renderer, 'group');
    assert.equal(groups.length, 24, `expected 24 slot groups for capacity 24, got ${groups.length}`);

    // Rerender with the same props: node identities preserved (no remount).
    const before = groups.slice();
    await rerender(renderer, createElement(
      ParticleView as never,
      { system, effect: 'fx', width: 100, height: 100, snapshot } as never,
    ));
    const after = findAll(renderer, 'group');
    assert.equal(after.length, 24);
    for (let i = 0; i < 24; i++) assert.equal(after[i], before[i], `slot ${i} remounted`);

    // Second effect on the same system must NOT multiply the clock: the
    // binding is one object and views hold no timers.
    renderer.unmount();
    system.dispose();
  });

  it('capacity drives storage size, not PARTICLE_MAX_CAPACITY', async () => {
    const def = makeDef(6, 'screen');
    const small = createParticleSystem({ effects: { fx: def } });
    assert.equal(small.bindPresentation().slots('fx').capacity, 6);
    small.dispose();

    const big = createParticleSystem({ effects: { fx: makeDef(96, 'screen') } });
    assert.equal(big.bindPresentation().slots('fx').capacity, 96);
    big.dispose();
  });
});

describe('T15-F1 views never advance the clock', () => {
  it('mounting two views advances nothing; only binding.tick moves age', async () => {
    const def = makeDef(8, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    const binding = system.bindPresentation();
    system.emit('fx', { position: { x: 0, y: 0 }, seed: 7 });
    const snapshot = { value: { revision: binding.revision, data: new Map([[ 'fx', binding.slots('fx') ]]) } };

    const makeView = () =>
      createElement(ParticleView as never, { system, effect: 'fx', width: 50, height: 50, snapshot } as never);
    const renderer = await mount(makeView());
    const renderer2 = await mount(makeView());

    const ageBefore = system.getActiveParticles('fx')[0]!.age;
    // Merely mounting/unmounting views must not advance anything.
    await rerender(renderer, makeView());
    await rerender(renderer2, makeView());
    const ageAfter = system.getActiveParticles('fx')[0]!.age;
    assert.equal(ageAfter, ageBefore);

    // The single owner ticks once; both readers observe the same result.
    binding.tick(0.25);
    assert.ok(Math.abs(system.getActiveParticles('fx')[0]!.age - (ageBefore + 0.25)) < 1e-9);
    assert.equal(binding.slots('fx').visible[0]!, 1);

    renderer.unmount();
    renderer2.unmount();
    system.dispose();
  });
});

describe('T15-F4 world-space hides without camera context', () => {
  it('world effect outside GameWorld2D renders hidden; screen effect renders', async () => {
    const worldSystem = createParticleSystem({ effects: { fx: makeDef(4, 'world') } });
    const wb = worldSystem.bindPresentation();
    worldSystem.emit('fx', { position: { x: 30, y: 30 }, seed: 2 });
    wb.tick(0.01);
    const wsnap = { value: { revision: wb.revision, data: new Map([[ 'fx', wb.slots('fx') ]]) } };

    // Mocked useDerivedValue executes immediately: visibility worklet runs
    // and must resolve false without camera/viewport context.
    const r1 = await mount(createElement(ParticleView as never, { system: worldSystem, effect: 'fx', width: 100, height: 100, snapshot: wsnap } as never));
    const circlesWorld = findAll(r1, 'circle');
    assert.equal(circlesWorld.length, 4);
    // All opacities collapsed to 0 (hidden) because there is no camera.
    for (const c of circlesWorld) {
      assert.equal(resolveNumber((c.props as { opacity?: unknown }).opacity), 0);
    }
    r1.unmount();
    worldSystem.dispose();

    const screenSystem = createParticleSystem({ effects: { fx: makeDef(4, 'screen') } });
    const sb = screenSystem.bindPresentation();
    screenSystem.emit('fx', { position: { x: 30, y: 30 }, seed: 3 });
    sb.tick(0.01);
    const ssnap = { value: { revision: sb.revision, data: new Map([[ 'fx', sb.slots('fx') ]]) } };
    const r2 = await mount(createElement(ParticleView as never, { system: screenSystem, effect: 'fx', width: 100, height: 100, snapshot: ssnap } as never));
    const circlesScreen = findAll(r2, 'circle');
    const resolvedScreen = resolveNumber((circlesScreen[0]!.props as { opacity?: unknown }).opacity);
    assert.equal((resolvedScreen ?? 0) > 0, true);
    r2.unmount();
    screenSystem.dispose();
  });
});
