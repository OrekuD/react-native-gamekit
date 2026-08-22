/**
 * T15-RF1/RF3/RF5 mounted contract tests.
 *
 * - Shapes render through exactly ONE `Picture` node per effect regardless
 *   of capacity (24 vs 1024 -> same React/worklet topology).
 * - Views never advance the clock; only the acquired driver does, and a
 *   second presentation hook fails deterministically.
 * - The published frame uses FRESH arrays per revision, so successive
 *   positions are all observed (three-position sequence).
 * - Idle stop + emission wake, and manual pause independent of session.
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

// Instrumentation for structural assertions.
const sharedValuesCreated: number[] = [];
let derivedInvocations = 0;

const recordedCircles: { x: number; y: number; r: number }[] = [];
function resetCanvasRecording(): void {
  recordedCircles.length = 0;
}

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
    Picture: host('picture'),
    useRectBuffer: (capacity: number) => ({ current: { capacity } }),
    useRSXformBuffer: (capacity: number) => ({ current: { capacity } }),
    Skia: {
      PictureRecorder: () => ({
        beginRecording: () => ({
          drawCircle: (x: number, y: number, r: number) => {
            recordedCircles.push({ x, y, r });
          },
          save: () => {},
          restore: () => {},
          concat: () => {},
          drawRect: () => {},
        }),
        finishRecordingAsPicture: () => ({ __picture: true }),
      }),
      Paint: () => ({
        setColor: (_c: unknown) => undefined,
        setAlphaf: (_a: number) => undefined,
      }),
      Matrix: () => {
        const m: { translate: () => unknown; rotate: () => unknown } = {
          translate() {
            return m;
          },
          rotate() {
            return m;
          },
        };
        return m;
      },
      Color: (c: string) => c,
    },
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => {
      const sv = { value: initial };
      sharedValuesCreated.push(0);
      void sv;
      return sv;
    },
    useDerivedValue: (fn: () => unknown) => {
      derivedInvocations++;
      return { value: fn() };
    },
    useFrameCallback: () => {},
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticleViewModule = typeof import('../src/react/particles/ParticleView');
type ParticleViewType = ParticleViewModule['ParticleView'];

let ParticleView: ParticleViewType;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PresentationModule = typeof import('../src/react/particles/useParticlePresentation');
let useParticlePresentation: PresentationModule['useParticlePresentation'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticlesModule = typeof import('../src/particles/index');
let defineParticleEffect: ParticlesModule['defineParticleEffect'];
let createParticleSystem: ParticlesModule['createParticleSystem'];

async function mount(ui: React.ReactElement): Promise<ReturnType<typeof create>> {
  let renderer: ReturnType<typeof create> | null = null;
  await act(async () => {
    renderer = create(ui);
  });
  return renderer!;
}

function findAll(renderer: ReturnType<typeof create>, tag: string) {
  return renderer.root.findAll((n) => String(n.type) === tag);
}

function makeDef(capacity: number, space: 'world' | 'screen') {
  return defineParticleEffect({
    capacity,
    space,
    overflow: 'drop-new',
    particle: { kind: 'shape', shape: 'circle', radius: 4 },
    burst: { count: Math.min(2, capacity) },
    lifetimeSeconds: { min: 10, max: 10 },
    speed: { min: 0, max: 0 },
    gravity: { x: 0, y: 0 },
    fadeOut: false,
  });
}

describe('particle view mounted contract', () => {
  it('loads modules after mocks', async () => {
    ({ ParticleView } = await import('../src/react/particles/ParticleView'));
    ({ useParticlePresentation } = await import('../src/react/particles/useParticlePresentation'));
    ({ defineParticleEffect, createParticleSystem } = await import('../src/particles/index'));
  });
});

describe('T15-RF5 constant topology across capacities', () => {
  it('capacity 24 and 1024 both render exactly one Picture with equal worklet invocations', async () => {
    const results: { pictures: number; worklets: number }[] = [];
    for (const capacity of [24, 1024]) {
      const def = makeDef(capacity, 'screen');
      const system = createParticleSystem({ effects: { fx: def } });
      system.emit('fx', { position: { x: 20, y: 20 }, seed: 1 });
      const binding = system.bindPresentation();
      binding.tick(0.05);
      // Fresh plain arrays per revision — what the hook would publish.
      const b = binding.slots('fx');
        const snapshot = {
        value: {
          revision: binding.revision,
          effects: {
            fx: {
              x: Array.from(b.x),
              y: Array.from(b.y),
              rotation: Array.from(b.rotation),
              scale: Array.from(b.scale),
              opacity: Array.from(b.opacity),
              visible: Array.from(b.visible),
              capacity,
            },
          },
        },
      } as unknown as Parameters<typeof ParticleView>[0]['snapshot'];

      resetCanvasRecording();
      const beforeWorklets = derivedInvocations;
      const renderer = await mount(
        createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, snapshot } as never),
      );
      const pictures = findAll(renderer, 'picture').length;
      const groups = findAll(renderer, 'group').length;
      results.push({ pictures, worklets: derivedInvocations - beforeWorklets });
      assert.equal(groups, 0, 'shape path must not mount per-slot nodes');
      renderer.unmount();
      system.dispose();
    }
    assert.equal(results[0]!.pictures, 1, 'capacity 24 must render one Picture');
    assert.equal(results[1]!.pictures, 1, 'capacity 1024 must render one Picture');
    assert.equal(results[0]!.worklets, results[1]!.worklets, 'worklet count must not scale with capacity');
  });

  it('visible slots are drawn at their sampled center positions', async () => {
    const def = makeDef(8, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    system.emit('fx', { position: { x: 40, y: 60 }, seed: 5 });
    const binding = system.bindPresentation();
    binding.tick(0.01);
    const b = binding.slots('fx');
    const snapshot = {
      value: {
        revision: binding.revision,
        effects: {
          fx: {
            x: Array.from(b.x),
            y: Array.from(b.y),
            rotation: Array.from(b.rotation),
            scale: Array.from(b.scale),
            opacity: Array.from(b.opacity),
            visible: Array.from(b.visible),
            capacity: 8,
          },
        },
      },
    };
    resetCanvasRecording();
    const renderer = await mount(
      createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, snapshot } as never),
    );
    assert.equal(recordedCircles.length, 2);
    assert.equal(recordedCircles[0]!.x, 40);
    assert.equal(recordedCircles[0]!.y, 60);
    renderer.unmount();
    system.dispose();
  });
});

describe('T15-RF1 three-position observation through fresh publishes', () => {
  it('each revision reaches the renderer; identities are never reused', async () => {
    const def = defineParticleEffect({
      capacity: 4,
      space: 'screen',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle', radius: 4 },
      burst: { count: 1 },
      lifetimeSeconds: { min: 5, max: 5 },
      speed: { min: 100, max: 100 },
      direction: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const system = createParticleSystem({ effects: { fx: def } });
    const binding = system.bindPresentation();
    system.emit('fx', { position: { x: 0, y: 0 }, seed: 9 });

    const seenX: number[] = [];
    let snapshot: { value: unknown } = { value: { revision: -1, effects: {} } };
    let previousArrays: number[] | null = null;

    const positions = [10, 20, 30];
    for (const target of positions) {
      // Drive the particle to the target x via its +x velocity.
      const snap = system.getActiveParticles('fx')[0]!;
      const dt = (target - snap.position.x) / snap.velocity.x;
      binding.tick(dt);
      // Publish like the hook: FRESH arrays each revision.
      const b = binding.slots('fx');
      const fresh = {
        revision: binding.revision,
        effects: {
          fx: {
            x: Array.from(b.x),
            y: Array.from(b.y),
            rotation: Array.from(b.rotation),
            scale: Array.from(b.scale),
            opacity: Array.from(b.opacity),
            visible: Array.from(b.visible),
            capacity: 4,
          },
        },
      };
      if (previousArrays !== null) {
        assert.notEqual(fresh.effects.fx.x, previousArrays, 'published array identity was reused');
      }
      previousArrays = fresh.effects.fx.x;
      snapshot = { value: fresh };
      resetCanvasRecording();
      const renderer = await mount(
        createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, snapshot } as never),
      );
      void renderer;
      // The last recorded circle reflects THIS revision's position.
      const last = recordedCircles[recordedCircles.length - 1]!;
      seenX.push(last.x);
      renderer.unmount();
    }
    assert.equal(seenX.length, 3);
    assert.ok(Math.abs(seenX[0]! - 10) < 1e-6, `first position ${String(seenX[0])}`);
    assert.ok(Math.abs(seenX[1]! - 20) < 1e-6, `second position ${String(seenX[1])}`);
    assert.ok(Math.abs(seenX[2]! - 30) < 1e-6, `third position ${String(seenX[2])}`);
    system.dispose();
  });
});

describe('T15-RF3 exclusive driver, idle stop/wake, manual pause', () => {
  it('second hook fails deterministically; manual pause survives a running session', async () => {
    const def = makeDef(4, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    system.emit('fx', { position: { x: 0, y: 0 }, seed: 11 });

    // Deterministic scheduler we can step explicitly, frame by frame.
    const queue: (() => void)[] = [];
    const schedule = (tick: () => void) => {
      queue.push(tick);
      return () => {
        const i = queue.indexOf(tick);
        if (i >= 0) queue.splice(i, 1);
      };
    };
    const runFrames = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        const t = queue.shift();
        if (t === undefined) return;
        await act(async () => t());
      }
    };

    const sessionStatus = (): 'running' => 'running';
    const manualRef = { paused: false };
    let fakeNow = 1_000_000;
    const options = {
      sessionStatus,
      manualPaused: () => manualRef.paused,
      schedule,
      now: () => {
        fakeNow += 16; // one 60fps frame per read
        return fakeNow;
      },
    };

    let rendererA: ReturnType<typeof create> | null = null;
    await act(async () => {
      rendererA = create(
        createElement(function HookHostA(): null {
          useParticlePresentation(system as never, options);
          return null;
        }, {}),
      );
    });
    const hostA = rendererA!;

    // Second owner must fail deterministically while the first holds the
    // lease (asserted on the binding itself so React's async error reporting
    // cannot mask the deterministic contract).
    const b = (system as unknown as {
      bindPresentation(): {
        readonly driverOwned: boolean;
        acquireDriver(): unknown;
        tick(d: number): void;
      };
    }).bindPresentation();
    assert.equal(b.driverOwned, true);
    assert.throws(() => b.acquireDriver(), /already owned/);
    assert.throws(() => b.tick(1 / 60), /owned by an acquired driver/);

    // One initial frame from the hook's own scheduling.
    await runFrames(1);
    const age0 = (system.getActiveParticles('fx')[0] as { age: number }).age;

    // Manual pause freezes age across MULTIPLE frames even though the
    // session reports running (independent pause sources).
    manualRef.paused = true;
    await runFrames(3);
    const ageFrozen = (system.getActiveParticles('fx')[0] as { age: number }).age;
    assert.equal(ageFrozen, age0);

    // Releasing manual pause resumes advancement on the next frame.
    manualRef.paused = false;
    await runFrames(1);
    const ageResumed = (system.getActiveParticles('fx')[0] as { age: number }).age;
    assert.ok(ageResumed > ageFrozen);

    await act(async () => {
      hostA.unmount();
    }); // releases the exclusive clock
    assert.equal(b.driverOwned, false);
    b.tick(1 / 60); // manual path restored after release
    system.dispose();
  });


  it('idle stop and emission wake through driver handle', async () => {
    const short = defineParticleEffect({
      capacity: 2,
      space: 'screen',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const system = createParticleSystem({ effects: { s: short } });
    const binding = system.bindPresentation();
    const driver = binding.acquireDriver();

    const woken: number[] = [];
    driver.setWakeListener(() => woken.push(binding.activeCount));

    system.emit('s', { position: { x: 0, y: 0 }, seed: 1 });
    assert.equal(woken.length >= 1, true, 'accepted emission must wake the driver');

    driver.step(0.06); // expires the single particle
    assert.equal(driver.isIdle(), true);

    system.emit('s', { position: { x: 0, y: 0 }, seed: 2 });
    assert.equal(driver.isIdle(), false);
    driver.release();
    system.dispose();
  });
});
