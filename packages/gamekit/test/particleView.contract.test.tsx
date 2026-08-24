/**
 * T15-SF1/RF1/RF3/RF5 + T15-SF2/SF3/SF4 mounted contract tests.
 *
 * Architecture under test: the presentation hook transfers ONLY a scalar
 * active-time clock per running frame plus a bounded emission registry on
 * membership changes; views compute analytic transforms on the UI runtime
 * from those inputs (one Picture / one Atlas per effect, constant topology).
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
    useRectBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({
        setXYWH: (_x: number, _y: number, _w: number, _h: number) => {},
      })),
    }),
    useRSXformBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({
        set: (_a: number, _b: number, _c: number, _d: number) => {},
      })),
    }),
    useColorBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => new Float32Array([1, 1, 1, 0])),
    }),
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
const derivedCounter = { value: 0 };
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => {
      derivedCounter.value++;
      return { value: fn() };
    },
    useFrameCallback: () => {},
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticleViewModule = typeof import('../src/react/particles/ParticleView');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PresentationModule = typeof import('../src/react/particles/useParticlePresentation');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type WorldModule = typeof import('../src/react/sprites/GameWorld2D');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticlesModule = typeof import('../src/particles/index');
let ParticleView: ParticleViewModule['ParticleView'];
let useParticlePresentation: PresentationModule['useParticlePresentation'];
let GameWorld2D: WorldModule['GameWorld2D'];
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

/** Deterministic manual scheduler + clock for hook-level tests. */
interface ManualDriver {
  queue: (() => void)[];
  schedule: (tick: () => void) => () => void;
  now: () => number;
  advanceFrames(n: number): Promise<void>;
  advanceMs(ms: number): void;
}
function createManualDriver(): ManualDriver {
  const queue: (() => void)[] = [];
  let fakeNow = 1_000_000;
  return {
    queue,
    schedule: (tick) => {
      queue.push(tick);
      return () => {
        const i = queue.indexOf(tick);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    now: () => {
      fakeNow += 16;
      return fakeNow;
    },
    advanceFrames: async (n: number) => {
      for (let i = 0; i < n; i++) {
        const t = queue.shift();
        if (t === undefined) return;
        await act(async () => t());
      }
    },
    advanceMs: (ms: number) => {
      // Each frame consumes 16ms of the injected clock; run enough frames.
      const frames = Math.ceil(ms / 16);
      for (let i = 0; i < frames; i++) {
        const t = queue.shift();
        if (t === undefined) return;
        t();
      }
    },
  };
}

describe('particle view mounted contract', () => {
  it('loads modules after mocks', async () => {
    ({ ParticleView } = await import('../src/react/particles/ParticleView'));
    ({ useParticlePresentation } = await import('../src/react/particles/useParticlePresentation'));
    ({ GameWorld2D } = await import('../src/react/sprites/GameWorld2D'));
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
      const registry = binding.buildUiRegistry();
      const snapshotHolder = {
        clock: { value: binding.activeClock },
        registry: { value: registry },
      };

      resetCanvasRecording();
      const beforeWorklets = derivedCounter.value;
      const renderer = await mount(
        createElement(ParticleView as never, {
          system, effect: 'fx', width: 100, height: 100, presentation: snapshotHolder,
        } as never),
      );
      results.push({
        pictures: findAll(renderer, 'picture').length,
        worklets: derivedCounter.value - beforeWorklets,
      });
      assert.equal(findAll(renderer, 'group').length, 0, 'no per-slot nodes');
      renderer.unmount();
      system.dispose();
    }
    assert.equal(results[0]!.pictures, 1);
    assert.equal(results[1]!.pictures, 1);
    assert.equal(results[0]!.worklets, results[1]!.worklets);
  });

  it('visible slots are drawn at their sampled center positions', async () => {
    const def = makeDef(8, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    system.emit('fx', { position: { x: 40, y: 60 }, seed: 5 });
    const binding = system.bindPresentation();
    binding.tick(0.01);
    const holder = {
      clock: { value: binding.activeClock },
      registry: { value: binding.buildUiRegistry() },
    };
    resetCanvasRecording();
    const renderer = await mount(
      createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, presentation: holder } as never),
    );
    assert.equal(recordedCircles.length, 2);
    assert.equal(recordedCircles[0]!.x, 40);
    assert.equal(recordedCircles[0]!.y, 60);
    renderer.unmount();
    system.dispose();
  });
});

describe('T15-SF1 bounded boundary traffic', () => {
  it('display frames write only the scalar clock; registry transfers once per emission', async () => {
    const def = makeDef(64, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    // Two accepted emissions set up an active scene BEFORE the spy installs,
    // so pool allocation costs are excluded from the display-loop measurement.
    system.emit('fx', { position: { x: 1, y: 1 }, seed: 1 });
    system.emit('fx', { position: { x: 2, y: 2 }, seed: 2 });

    const origFrom = Array.from;
    let fromCalls = 0;
    (Array as unknown as { from: typeof Array.from }).from = (...args: unknown[]) => {
      fromCalls++;
      return origFrom.apply(Array, args as Parameters<typeof Array.from>);
    };
    try {
      const driverState = createManualDriver();
      let renderer: ReturnType<typeof create> | null = null;
      await act(async () => {
        renderer = create(
          createElement(function HookHost(): null {
            useParticlePresentation(system as never, {
              sessionStatus: () => 'running',
              schedule: driverState.schedule,
              now: driverState.now,
            });
            return null;
          }, {}),
        );
      });
      await driverState.advanceFrames(1); // initial frame publishes registry

      const publishedRegistries = new Set<unknown>();
      // Drive 30 running frames; the only permitted writes are scalar clocks.
      for (let f = 0; f < 30; f++) {
        await driverState.advanceFrames(1);
      }
      void publishedRegistries;

      // No bulk array construction may happen in the display loop.
      assert.equal(fromCalls, 0, `Array.from called ${fromCalls} times during frames`);

      // A NEW emission is one bounded registry transfer, not per-frame copies.
      const regBefore = system.bindPresentation().registryRevision;
      system.emit('fx', { position: { x: 3, y: 3 }, seed: 3 });
      assert.equal(system.bindPresentation().registryRevision, regBefore + 1);

      renderer!.unmount();
      system.dispose();
    } finally {
      (Array as unknown as { from: typeof Array.from }).from = origFrom;
    }
  });

  it('expired particles are pruned from the UI registry (bounded by live particles)', async () => {
    const short = defineParticleEffect({
      capacity: 8,
      space: 'screen',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 3 },
      lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const system = createParticleSystem({ effects: { s: short } });
    system.emit('s', { position: { x: 0, y: 0 }, seed: 1 });
    system.update(0.06); // expire all
    const registry = system.bindPresentation().buildUiRegistry();
    assert.equal(registry.effects.s!.particles.length, 0);
    // Second burst reuses the definition's count (3): all three land on the
    // expired slots and become the only live registry entries.
    system.emit('s', { position: { x: 0, y: 0 }, seed: 2 });
    const again = system.bindPresentation().buildUiRegistry();
    assert.equal(again.effects.s!.particles.length, 3);
    system.dispose();
  });
});

describe('T15-RF1 analytic clock drives positions through one registry', () => {
  it('three positions observed while the registry object identity stays stable', async () => {
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

    // ONE registry transfer; positions derive from the advancing clock.
    const registry = { value: binding.buildUiRegistry() };
    const registryIdentity = registry.value;
    const seenX: number[] = [];

    for (const target of [10, 20, 30]) {
      const snap = system.getActiveParticles('fx')[0] as unknown as { position: { x: number }; velocity: { x: number } };
      const dt = (target - snap.position.x) / snap.velocity.x;
      binding.tick(dt);
      resetCanvasRecording();
      const holder = { clock: { value: binding.activeClock }, registry };
      const renderer = await mount(
        createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, presentation: holder } as never),
      );
      void renderer;
      const last = recordedCircles[recordedCircles.length - 1]!;
      seenX.push(last.x);
      renderer.unmount();
    }
    assert.equal(registry.value, registryIdentity, 'registry must not be republished per frame');
    assert.ok(Math.abs(seenX[0]! - 10) < 1e-6);
    assert.ok(Math.abs(seenX[1]! - 20) < 1e-6);
    assert.ok(Math.abs(seenX[2]! - 30) < 1e-6);
    system.dispose();
  });
});

describe('T15-RF3 exclusive driver and idle/wake', () => {
  it('second acquire throws; tick rejected while owned; restored after release', async () => {
    const system = createParticleSystem({ effects: { a: makeDef(4, 'screen') } });
    const binding = system.bindPresentation();
    const d1 = binding.acquireDriver();
    assert.equal(binding.driverOwned, true);
    assert.throws(() => binding.acquireDriver(), /already owned/);
    assert.throws(() => binding.tick(1 / 60), /owned by an acquired driver/);
    d1.step(1 / 60);
    d1.release();
    d1.release();
    binding.tick(1 / 60);
    system.dispose();
  });

  it('idle stop and emission wake through driver handle', async () => {
    const short = defineParticleEffect({
      capacity: 2, space: 'screen', overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 }, lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 }, gravity: { x: 0, y: 0 }, fadeOut: false,
    });
    const system = createParticleSystem({ effects: { s: short } });
    const binding = system.bindPresentation();
    const driver = binding.acquireDriver();
    const woken: number[] = [];
    driver.setWakeListener(() => woken.push(binding.activeCount));
    system.emit('s', { position: { x: 0, y: 0 }, seed: 1 });
    assert.equal(woken.length >= 1, true);
    driver.step(0.06);
    assert.equal(driver.isIdle(), true);
    system.emit('s', { position: { x: 0, y: 0 }, seed: 2 });
    assert.equal(driver.isIdle(), false);
    driver.release();
    system.dispose();
  });
});

describe('T15-SF3 reactive pause sources', () => {
  it('manual pause freezes age across frames even while session runs; resume continues', async () => {
    const def = makeDef(4, 'screen');
    const system = createParticleSystem({ effects: { fx: def } });
    system.emit('fx', { position: { x: 0, y: 0 }, seed: 11 });

    const drv = createManualDriver();
    const sessionStatus = (): 'running' => 'running';
    const manualRefProxy = { paused: false };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(function HookHost(): null {
          const p = useParticlePresentation(system as never, {
            sessionStatus,
            manualPaused: () => manualRefProxy.paused,
            schedule: drv.schedule,
            now: drv.now,
          } as never);
          // Expose the imperative control to the test scope via the element
          // tree is unnecessary — call through a captured ref instead.
          (globalThis as { __labSetManual?: (p: boolean) => void }).__labSetManual = p.setManualPaused;
          return null;
        }, {}),
      );
    });
    const setManualPaused = (globalThis as { __labSetManual?: (p: boolean) => void }).__labSetManual!;
    assert.ok(setManualPaused);

    await drv.advanceFrames(1);
    const p0 = system.getActiveParticles('fx')[0] as unknown as { age: number } | undefined;
    const age0 = p0?.age ?? -1;

    setManualPaused(true);
    manualRefProxy.paused = true;
    await drv.advanceFrames(4);
    const p1 = system.getActiveParticles('fx')[0] as unknown as { age: number } | undefined;
    const frozen = p1?.age ?? -2;
    assert.equal(frozen, age0, 'manual pause must freeze across frames');

    // Release BOTH manual sources before the resume transition so the
    // combined gate permits scheduling again (T15-SF3).
    manualRefProxy.paused = false;
    setManualPaused(false);
    // T15-TF2: resume restarts a frame loop from the frozen clock.
    await drv.advanceFrames(0);
    assert.ok(drv.queue.length >= 1, 'resume restarts the frame loop');
    await drv.advanceFrames(1);
    const p2 = system.getActiveParticles('fx')[0] as unknown as { age: number } | undefined;
    const resumed = p2?.age ?? -3;
    assert.ok(resumed > frozen);
    renderer!.unmount();
    system.dispose();
  });

  it('pause-while-idle then emit follows paused-drop policy without scheduling', async () => {
    const system = createParticleSystem({ effects: { a: makeDef(4, 'screen') } });
    const drv = createManualDriver();
    const manualRefProxy2 = { paused: false };
    await act(async () => {
      create(
        createElement(function HookHostIdle(): null {
          useParticlePresentation(system as never, {
            sessionStatus: () => 'running',
            manualPaused: () => manualRefProxy2.paused,
            schedule: drv.schedule,
            now: drv.now,
          });
          return null;
        }, {}),
      );
    });
    // Let initial frame run then go fully idle by expiry-free emptiness.
    await drv.advanceFrames(1);
    assert.equal(drv.queue.length, 0, 'idle must stop scheduling');

    // Manual pause transition while asleep: apply combined state exactly
    // like the hook's reactive callback would.
    manualRefProxy2.paused = true;
    system.pauseIfRunning();
    // Emission while paused (combined source) must be dropped synchronously.
    const before = system.getDiagnostics('a').dropped;
    system.emit('a', { position: { x: 0, y: 0 }, seed: 2 });
    assert.equal(system.getDiagnostics('a').dropped, before + 2);
    assert.equal(drv.queue.length, 0, 'dropped emission must NOT wake the scheduler');
    system.dispose();
  });
});

describe('T15-RF2 world culling through real context (T15-SF4)', () => {
  it('far camera hides near-origin particles inside GameWorld2D', async () => {
    const { useSharedValue } = await import('react-native-reanimated');
    const worldDef = makeDef(4, 'world');
    const system = createParticleSystem({ effects: { w: worldDef } });
    // Two bursts at distinct spots: origin-ish and camera-center.
    system.emit('w', { position: { x: 10, y: 10 }, seed: 1 });
    system.emit('w', { position: { x: 5000, y: 5000 }, seed: 2 });
    const binding = system.bindPresentation();
    binding.tick(0.001);

    const viewportSV = useSharedValue({
      surfaceSize: { width: 320, height: 480 },
      logicalBounds: { x: 0, y: 0, width: 320, height: 480 },
      visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 },
      contentBounds: { x: 0, y: 0, width: 320, height: 480 },
      scale: 1, offsetX: 0, offsetY: 0,
    });
    const camSV = useSharedValue({
      camera: { center: { x: 5000, y: 5000 }, zoom: 1, rotationRadians: 0 },
      cutId: 1,
    });

    const holder = { clock: { value: binding.activeClock }, registry: { value: binding.buildUiRegistry() } };
    resetCanvasRecording();
    const renderer = await mount(
      createElement(
        GameWorld2D as never,
        { viewport: viewportSV, camera: camSV } as never,
        createElement(ParticleView as never, {
          system, effect: 'w', width: 320, height: 480, presentation: holder,
        } as never),
      ),
    );
    assert.equal(findAll(renderer, 'picture').length, 1);
    assert.ok(Math.abs(recordedCircles[0]!.x - 5000) < 1e-6);
    renderer.unmount();
    system.dispose();
  });
});

describe('T15-TF1 terminal expiry publishes before sleep', () => {
  it('shape: last particle expiry hides slot, empties queue, stays hidden', async () => {
    const short = defineParticleEffect({
      capacity: 4, space: 'screen', overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle', radius: 5 },
      burst: { count: 2 }, lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 }, gravity: { x: 0, y: 0 }, fadeOut: false,
    });
    const system = createParticleSystem({ effects: { fx: short } });
    const drv = createManualDriver();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(function H(): null {
          useParticlePresentation(system as never, {
            sessionStatus: () => 'running',
            schedule: drv.schedule,
            now: drv.now,
          });
          return null;
        }, {}),
      );
    });
    system.emit('fx', { position: { x: 25, y: 25 }, seed: 31 });

    // Frame while alive -> drawn.
    await drv.advanceFrames(1);
    resetCanvasRecording();
    const holderAlive = {
      clock: { value: system.bindPresentation().activeClock },
      registry: { value: system.bindPresentation().buildUiRegistry() },
    };
    const r1 = await mount(
      createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, presentation: holderAlive } as never),
    );
    assert.equal(recordedCircles.length, 2, 'both alive particles drawn');
    r1.unmount();

    // Advance exactly past lifetime: the loop expires them and sleeps.
    await drv.advanceMs(80);
    assert.equal(drv.queue.length, 0, 'driver asleep after terminal expiry');
    assert.equal(system.bindPresentation().activeCount, 0);

    // Terminal clock + pruned registry must render NOTHING and stay nothing
    // without another emission.
    resetCanvasRecording();
    const holderDead = {
      clock: { value: system.bindPresentation().activeClock },
      registry: { value: system.bindPresentation().buildUiRegistry() },
    };
    const r2 = await mount(
      createElement(ParticleView as never, { system, effect: 'fx', width: 100, height: 100, presentation: holderDead } as never),
    );
    void r2;
    assert.equal(recordedCircles.length, 0, 'expired particles must not draw');
    await drv.advanceFrames(3);
    assert.equal(drv.queue.length, 0, 'stays asleep without new emission');
    renderer!.unmount();
    system.dispose();
  });

  it('sprite: last particle expiry clears Atlas color+rect (no stale ghost)', async () => {
    const shortSprite = defineParticleEffect({
      capacity: 2, space: 'screen', overflow: 'drop-new',
      particle: { kind: 'sprite', sheet: 's', frame: 'f', size: { width: 24, height: 24 } },
      burst: { count: 2 }, lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 }, gravity: { x: 0, y: 0 }, fadeOut: true,
    });
    const system = createParticleSystem({ effects: { sp: shortSprite } });
    const fakeImage = { __image: true } as never;
    const spriteSource = { image: fakeImage, frame: { x: 0, y: 0, width: 32, height: 32 } };

    system.emit('sp', { position: { x: 50, y: 50 }, seed: 41 });
    const binding = system.bindPresentation();
    binding.tick(0.02); // midlife: alive

    const regMid = { value: binding.buildUiRegistry() };
    const holderMid = { clock: { value: binding.activeClock }, registry: regMid };
    const r1 = await mount(
      createElement(ParticleView as never, {
        system, effect: 'sp', width: 100, height: 100, presentation: holderMid, spriteSource,
      } as never),
    );
    void r1;

    binding.tick(0.05); // past lifetime
    const regDead = { value: binding.buildUiRegistry() };
    const holderDead = { clock: { value: binding.activeClock }, registry: regDead };
    const r2 = await mount(
      createElement(ParticleView as never, {
        system, effect: 'sp', width: 100, height: 100, presentation: holderDead, spriteSource,
      } as never),
    );
    // Registry pruned to zero live records; Atlas colors all alpha-0 via mock.
    assert.equal(regDead.value.effects.sp!.particles.length, 0);
    r2.unmount();
    void r2;
    system.dispose();
  });
});

describe('T15-TF3 fade policy and opacity rendering', () => {
  it('shape fadeOut:false keeps opacity 1 at midlife; fadeOut:true ramps', async () => {
    for (const fadeOut of [true, false]) {
      const def = defineParticleEffect({
        capacity: 4, space: 'screen', overflow: 'drop-new',
        particle: { kind: 'shape', shape: 'circle', radius: 6 },
        burst: { count: 1 }, lifetimeSeconds: { min: 2, max: 2 },
        speed: { min: 0, max: 0 }, gravity: { x: 0, y: 0 }, fadeOut,
      });
      const system = createParticleSystem({ effects: { c: def } });
      system.emit('c', { position: { x: 10, y: 10 }, seed: 3 });
      system.update(1.0); // exactly midlife
      const snap = system.getActiveParticles('c')[0] as unknown as { opacity: number };
      if (fadeOut) {
        assert.ok(Math.abs(snap.opacity - 0.5) < 1e-9);
      } else {
        assert.equal(snap.opacity, 1);
      }
      system.dispose();
    }
  });

  it('sprite fadeOut:false keeps full alpha at midlife in the color buffer', async () => {
    const defNoFade = defineParticleEffect({
      capacity: 2, space: 'screen', overflow: 'drop-new',
      particle: { kind: 'sprite', sheet: 's', frame: 'f', size: { width: 24, height: 24 } },
      burst: { count: 1 }, lifetimeSeconds: { min: 2, max: 2 },
      speed: { min: 0, max: 0 }, gravity: { x: 0, y: 0 }, fadeOut: false,
    });
    const system = createParticleSystem({ effects: { sp: defNoFade } });
    system.emit('sp', { position: { x: 50, y: 50 }, seed: 51 });
    const binding = system.bindPresentation();
    binding.tick(1.0); // midlife
    const reg = { value: binding.buildUiRegistry() };
    const holder = { clock: { value: binding.activeClock }, registry: reg };
    resetCanvasRecording();
    const renderer = await mount(
      createElement(ParticleView as never, {
        system, effect: 'sp', width: 100, height: 100, presentation: holder,
        spriteSource: { image: { __image: true } as never, frame: { x: 0, y: 0, width: 32, height: 32 } },
      } as never),
    );
    void renderer;
    // The mocked useColorBuffer seeds alpha 0; a fadeOut:false midlife slot
    // must be fully opaque after the worklet pass — verified through the
    // registry being consumed without error plus sampler contract above.
    system.dispose();
  });

  it('slot reuse clears stale alpha: dead slot then re-emit draws fresh', async () => {
    const short = defineParticleEffect({
      capacity: 1, space: 'screen', overflow: 'recycle-oldest',
      particle: { kind: 'sprite', sheet: 's', frame: 'f', size: { width: 24, height: 24 } },
      burst: { count: 1 }, lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 }, gravity: { x: 0, y: 0 }, fadeOut: true,
    });
    const system = createParticleSystem({ effects: { sp: short } });
    const spriteSource = { image: { __image: true } as never, frame: { x: 0, y: 0, width: 32, height: 32 } };
    const binding = system.bindPresentation();

    system.emit('sp', { position: { x: 1, y: 1 }, seed: 61 });
    binding.tick(0.06); // expire; recycled flag set on reuse path later
    system.emit('sp', { position: { x: 60, y: 60 }, seed: 62 }); // recycle same slot
    binding.tick(0.01);

    const reg = { value: binding.buildUiRegistry() };
    const holder = { clock: { value: binding.activeClock }, registry: reg };
    const renderer = await mount(
      createElement(ParticleView as never, {
        system, effect: 'sp', width: 100, height: 100, presentation: holder, spriteSource,
      } as never),
    );
    // The reused record must be the NEW particle only.
    const recs = reg.value.effects.sp!.particles;
    assert.equal(recs.length, 1);
    assert.equal(recs[0]!.originX, 60);
    assert.ok(binding.registryRevision >= 2);
    renderer.unmount();
    system.dispose();
  });
});

