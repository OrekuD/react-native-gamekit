/**
 * T12.3-T12.5: camera binding, pointer mapping, and layer integration.
 *
 * Mounts the real binding hook and the real pointer binding against
 * controllable shared values; verifies the presented camera pipeline
 * (commit -> interpolate -> cut), the camera-aware pointer conversion with
 * containment first, and the composed world/layer transforms.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode } from 'react';
import { act, create } from 'react-test-renderer';

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
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    },
  },
});
mock.module('react-native-safe-area-context', {
  namedExports: {
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Atlas: host('atlas'),
    Picture: host('picture'),
    Circle: host('circle'),
    Rect: host('rect'),
    Image: host('image'),
    Path: host('path'),
    Skia: { makeImageFromView: () => undefined },
    useRectBuffer: () => ({ current: undefined }),
    useRSXformBuffer: () => ({ current: undefined }),
    useColorBuffer: () => ({ current: undefined }),
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useFrameCallback: () => {},
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    scheduleOnRN: () => {},
  },
});
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: host('gesture-detector'),
    GestureStateManager: {},
    useManualGesture: () => ({ gesture: null, gestureState: undefined }),
  },
});
mock.module('expo-asset', {
  namedExports: {
    Asset: class {},
  },
});

type Cam = {
  readonly center: { readonly x: number; readonly y: number };
  readonly zoom: number;
  readonly rotationRadians: number;
};

let GameLayer2D: React.ComponentType<{
  readonly parallax?: { readonly x: number; readonly y: number };
  readonly children?: React.ReactNode;
}>;
let cameraViewportTransform2D: (
  camera: unknown,
  viewport: unknown,
) => readonly Record<string, number>[];
let layerParallaxTransform2D: (
  camera: unknown,
  viewport: unknown,
  x: number,
  y: number,
) => readonly Record<string, number>[];
let PointerBinding: new (
  action: string,
  input: unknown,
  getViewport: () => unknown,
  generation: number,
) => {
  begin(
    pointerId: number,
    point: { x: number; y: number },
    camera?: { readonly camera: Cam; readonly cutId: number },
  ): boolean;
  move(
    pointerId: number,
    point: { x: number; y: number },
    camera?: { readonly camera: Cam; readonly cutId: number },
  ): void;
  end(pointerId: number): void;
};
let createCamera2D: (value?: Partial<Cam>) => Cam;
let logicalToWorld2D: (point: unknown, camera: unknown, view: unknown) => { x: number; y: number };
let worldToSurface2D: (point: unknown, viewport: unknown, camera: unknown) => { x: number; y: number };
let surfaceToWorld: (viewport: unknown, point: unknown) => { x: number; y: number };
let batchVisibleBounds2D: (camera: unknown, viewport: unknown, padding: number) => unknown;
let intersectsBounds2D: (first: unknown, second: unknown) => boolean;

before(async () => {
  const gk = await import('rn-gamekit');
  const react = await import('rn-gamekit/react');
  const binding = await import('../src/react/camera2d/usePresentedCameraBinding.ts');
  const pointer = await import('../src/react/pointerBinding.ts');
  const world = await import('../src/react/sprites/GameWorld2D.tsx');
  const viewport = await import('../src/viewport2d/index.ts');
  GameLayer2D = react.GameLayer2D as unknown as typeof GameLayer2D;
  usePresentedCameraBindingRef.current = binding.usePresentedCameraBinding;
  cameraViewportTransform2D = world.cameraViewportTransform2D as unknown as typeof cameraViewportTransform2D;
  layerParallaxTransform2D = world.layerParallaxTransform2D as unknown as typeof layerParallaxTransform2D;
  PointerBinding = pointer.PointerBinding as unknown as typeof PointerBinding;
  createCamera2D = gk.createCamera2D as unknown as typeof createCamera2D;
  logicalToWorld2D = gk.logicalToWorld2D as unknown as typeof logicalToWorld2D;
  worldToSurface2D = gk.worldToSurface2D as unknown as typeof worldToSurface2D;
  surfaceToWorld = viewport.surfaceToWorld as unknown as typeof surfaceToWorld;
  const batch = await import('../src/react/sprites/SpriteBatch.tsx');
  batchVisibleBounds2D = batch.batchVisibleBounds2D as unknown as typeof batchVisibleBounds2D;
  intersectsBounds2D = batch.intersectsBounds2D as unknown as typeof intersectsBounds2D;
  SpriteBatchComponent = batch.SpriteBatch as unknown as typeof SpriteBatchComponent;
  const collision = await import('../src/collision2d/index.ts');
  intersectsAabbAabb2DPublic = collision.intersectsAabbAabb2D as unknown as typeof intersectsAabbAabb2DPublic;
  const policy = await import('../src/react/sprites/spriteBatchPolicy.ts');
  batchUpdatePolicy = policy.batchUpdatePolicy as unknown as typeof batchUpdatePolicy;
});

const usePresentedCameraBindingRef: { current: unknown } = { current: undefined };
let SpriteBatchComponent: React.ComponentType<Record<string, unknown>>;
let batchUpdatePolicy: (count: number, capacity: number, dev: boolean) => { overflow: boolean; activeCount: number };
let intersectsAabbAabb2DPublic: (first: unknown, second: unknown) => boolean;

const FIT = {
  surfaceSize: { width: 320, height: 480 },
  logicalBounds: { x: 0, y: 0, width: 160, height: 240 },
  visibleLogicalBounds: { x: 0, y: 0, width: 160, height: 240 },
  contentBounds: { x: 0, y: 0, width: 320, height: 480 },
  scale: 2,
  offsetX: 0,
  offsetY: 0,
};

type Frame = {
  readonly scene: string;
  readonly hardCut: boolean;
  readonly current: { readonly camera: unknown };
};

function frame(scene: string, camera: unknown, hardCut = false): Frame {
  return { scene, hardCut, current: { camera } };
}

interface CameraBinding {
  commit(frame: unknown): void;
  present(alpha: number): void;
  dispose(): void;
}

/** Render the real binding hook with a controllable presented value. */
function harness(definition: unknown, strict = false) {
  let presented!: { value: unknown };
  let binding!: CameraBinding;
  let renderer!: ReturnType<typeof create>;
  const useSharedValueMockRef = { current: { value: undefined } };
  function Probe({ def }: { readonly def: unknown }) {
    const value = useSharedValueMockRef.current as { value: unknown };
    const created = (usePresentedCameraBindingRef.current as (
      definition: unknown,
      presented: unknown,
    ) => CameraBinding)(def, value);
    presented = value;
    binding = created;
    return null;
  }
  act(() => {
    renderer = create(
      strict ? (
        <StrictMode>
          <Probe def={definition} />
        </StrictMode>
      ) : (
        <Probe def={definition} />
      ),
    );
  });
  return {
    presented: () => presented.value,
    // T12-RF5: the CURRENT binding, re-read after every rerender — the
    // replacement binding owns the pending cut, never the stale one.
    binding: () => binding,
    rerender: (nextDefinition: unknown) => {
      act(() => {
        renderer.update(
          strict ? (
            <StrictMode>
              <Probe def={nextDefinition} />
            </StrictMode>
          ) : (
            <Probe def={nextDefinition} />
          ),
        );
      });
    },
  };
}

/** Apply a Skia element list last-first (the Group semantics). */
function applyElements(elements: readonly Record<string, number>[], point: { x: number; y: number }): { x: number; y: number } {
  let x = point.x;
  let y = point.y;
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i]!;
    if (element.translateX !== undefined) x += element.translateX;
    if (element.translateY !== undefined) y += element.translateY;
    if (element.scaleX !== undefined) {
      x *= element.scaleX;
      y *= element.scaleY ?? element.scaleX;
    }
    if (element.rotate !== undefined) {
      const cos = Math.cos(element.rotate);
      const sin = Math.sin(element.rotate);
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      x = nx;
      y = ny;
    }
  }
  return { x, y };
}

describe('presented camera binding (T12.3)', () => {
  it('interpolates between commits by the presentation alpha', () => {
    const definition = { select: (f: Frame) => f.current.camera };
    const { presented, binding } = harness(definition);
    const cameraA = createCamera2D({ center: { x: 0, y: 0 } });
    const cameraB = createCamera2D({ center: { x: 100, y: 0 }, zoom: 2 });
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(0));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 0);
    act(() => binding().commit(frame('play', cameraB)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 50);
    act(() => binding().present(1));
    const final = presented() as { camera: { center: { x: number }; zoom: number } };
    assert.equal(final.camera.center.x, 100);
    assert.equal(final.camera.zoom, 2);
  });

  it('snaps on scene change, hard cuts, and explicit cut predicates', () => {
    const definition = { select: (f: Frame) => f.current.camera, cut: (f: Frame) => f.scene === 'boss' };
    const { presented, binding } = harness(definition);
    const cameraA = createCamera2D({ center: { x: 0, y: 0 } });
    const cameraB = createCamera2D({ center: { x: 100, y: 0 } });
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(0));
    act(() => binding().commit(frame('boss', cameraB)));
    act(() => binding().present(0.25));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 100, 'explicit cut snaps');

    const plain = { select: (f: Frame) => f.current.camera };
    const second = harness(plain);
    act(() => second.binding().commit(frame('play', cameraA)));
    act(() => second.binding().present(0));
    act(() => second.binding().commit(frame('game-over', cameraB)));
    act(() => second.binding().present(0.25));
    assert.equal((second.presented() as { camera: { center: { x: number } } }).camera.center.x, 100, 'scene change snaps');

    const third = harness(plain);
    act(() => third.binding().commit(frame('play', cameraA)));
    act(() => third.binding().present(0));
    act(() => third.binding().commit(frame('play', cameraB, true)));
    act(() => third.binding().present(0.25));
    assert.equal((third.presented() as { camera: { center: { x: number } } }).camera.center.x, 100, 'hard cut snaps');
  });

  it('treats definition replacement as ONE pending cut owned by the NEW binding (T12-F3, T12-RF5)', () => {
    // Definition B is OBSERVABLY different: a different selection source
    // and cut behavior, so accidentally committing through A cannot pass.
    const definitionA = { select: (f: Frame) => f.current.camera };
    const definitionB = {
      select: (f: Frame) => {
        const camera = f.current.camera as { center: { x: number; y: number }; zoom: number; rotationRadians: number };
        return { ...camera, center: { x: camera.center.x + 1000, y: camera.center.y } };
      },
      cut: (f: Frame) => f.scene === 'boss',
    };
    const { presented, binding, rerender } = harness(definitionA);
    const cameraA = createCamera2D({ center: { x: 0, y: 0 } });
    const cameraB = createCamera2D({ center: { x: 100, y: 0 } });
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 0);

    // Replacement: the first B commit (through the CURRENT binding) snaps,
    // and B's selector transform is visible: 100 + 1000.
    rerender(definitionB);
    act(() => binding().commit(frame('play', cameraB)));
    act(() => binding().present(0.25));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 1100, 'first B commit snaps through the new binding');

    // ...and later B commits interpolate normally between B's own outputs.
    const cameraC = createCamera2D({ center: { x: 200, y: 0 } });
    act(() => binding().commit(frame('play', cameraC)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 1150, 'second B commit interpolates');
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 1200, 'third B commit completes');
  });

  it('produces exactly one cut per replacement under Strict Mode (T12-F3, T12-RF5)', () => {
    const definitionA = { select: (f: Frame) => f.current.camera };
    const definitionB = { select: (f: Frame) => f.current.camera };
    const { presented, binding, rerender } = harness(definitionA, true);
    const cameraA = createCamera2D({ center: { x: 0, y: 0 } });
    const cameraB = createCamera2D({ center: { x: 100, y: 0 } });
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(1));

    rerender(definitionB);
    // One cut: the first B commit snaps, the second interpolates.
    act(() => binding().commit(frame('play', cameraB)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 100, 'the single replacement cut snaps');
    const cameraC = createCamera2D({ center: { x: 200, y: 0 } });
    act(() => binding().commit(frame('play', cameraC)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 150, 'interpolation resumes after the cut');
  });

  it('recovers after select, cut, and validation failures (T12-F3)', () => {
    let failSelect = false;
    let failCut = false;
    const definition = {
      select: (f: Frame) => {
        if (failSelect) {
          throw new Error('select boom');
        }
        return f.current.camera;
      },
      cut: (f: Frame) => {
        if (failCut) {
          throw new Error('cut boom');
        }
        return f.scene === 'boss';
      },
    };
    const { presented, binding } = harness(definition);
    const cameraA = createCamera2D({ center: { x: 10, y: 0 } });
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 10);

    // Select failure: prior presentation intact.
    failSelect = true;
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 10, 'select failure keeps the last valid value');
    failSelect = false;

    // Cut failure: prior presentation intact.
    failCut = true;
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 10, 'cut failure keeps the last valid value');
    failCut = false;

    // Validation failure: an invalid camera is rejected, then recovery.
    const invalid = { center: { x: NaN, y: 0 }, zoom: 1, rotationRadians: 0 };
    act(() => binding().commit(frame('play', invalid)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 10, 'invalid camera rejected');
    const cameraB = createCamera2D({ center: { x: 50, y: 0 } });
    act(() => binding().commit(frame('play', cameraB)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 50, 'the next valid commit recovers');
  });

  it('rejects partial selector output and retains the prior presentation (T12-SF3)', () => {
    const definition = { select: (f: Frame) => f.current.camera };
    const { presented, binding } = harness(definition);
    const full = createCamera2D({ center: { x: 7, y: 0 } });
    act(() => binding().commit(frame('play', full)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 7);

    // Partial selector results (missing center, zoom, or rotation) are
    // rejected at the commit boundary: the prior presentation survives.
    const partials = [
      { zoom: 1, rotationRadians: 0 },
      { center: { x: 0, y: 0 }, rotationRadians: 0 },
      { center: { x: 0, y: 0 }, zoom: 1 },
    ];
    for (const partial of partials) {
      act(() => binding().commit(frame('play', partial)));
      act(() => binding().present(0.5));
      assert.equal(
        (presented() as { camera: { center: { x: number } } }).camera.center.x,
        7,
        'a partial camera never replaces the prior presentation',
      );
    }

    // The next FULL selector output recovers normally.
    const cameraB = createCamera2D({ center: { x: 50, y: 0 } });
    act(() => binding().commit(frame('play', cameraB)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 50);
  });

  it('copies and freezes the selector output before publishing (T12-RF4)', () => {
    // A MUTABLE camera returned by the selector: mutation after commit must
    // never alter the authored previous/current values.
    const mutable: { center: { x: number; y: number }; zoom: number; rotationRadians: number } = {
      center: { x: 0, y: 0 },
      zoom: 1,
      rotationRadians: 0,
    };
    const definition = { select: (f: Frame) => f.current.camera };
    const { presented, binding } = harness(definition);
    act(() => binding().commit(frame('play', mutable)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 0);

    // Mutate the caller-owned object after the commit.
    mutable.center.x = 999;
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 0, 'published values are copies');

    // A second commit with the mutated object is a NEW camera, validated
    // and copied at the boundary.
    const cameraB = createCamera2D({ center: { x: 50, y: 0 } });
    act(() => binding().commit(frame('play', cameraB)));
    act(() => binding().present(1));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 50);
  });

  it('keeps the previous presented value safe when the selector throws', () => {
    const definition = {
      select: (f: Frame) => {
        if (f.scene === 'broken') {
          throw new Error('boom');
        }
        return f.current.camera;
      },
    };
    const { presented, binding } = harness(definition);
    const cameraA = createCamera2D({ center: { x: 10, y: 0 } });
    act(() => binding().commit(frame('play', cameraA)));
    act(() => binding().present(0));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 10);
    act(() => binding().commit(frame('broken', cameraA)));
    act(() => binding().present(0.5));
    assert.equal((presented() as { camera: { center: { x: number } } }).camera.center.x, 10, 'the last valid value survives');
  });
});

describe('camera-aware pointer conversion (T12.4)', () => {
  function eventsBinding() {
    const events: unknown[] = [];
    const input = {
      begin: (_a: string, _id: number, point: unknown) => events.push(point),
      move: (_a: string, _id: number, point: unknown) => events.push(point),
      end: () => undefined,
      cancel: () => undefined,
    };
    const binding = new PointerBinding('move', input, () => FIT, 1);
    return { events, binding };
  }

  it('maps surface -> world through the event-time camera cut after containment', () => {
    const camera = createCamera2D({ center: { x: 40, y: -30 }, zoom: 1.5, rotationRadians: 0.4 });
    const { events, binding } = eventsBinding();
    const cut = { camera, cutId: 1 };
    assert.equal(binding.begin(7, { x: 20, y: 20 }, cut), true);
    binding.move(7, { x: 100, y: 100 }, cut);
    assert.deepEqual(
      events[0],
      logicalToWorld2D(surfaceToWorld(FIT, { x: 20, y: 20 }), camera, FIT.visibleLogicalBounds),
    );
    assert.deepEqual(
      events[1],
      logicalToWorld2D(surfaceToWorld(FIT, { x: 100, y: 100 }), camera, FIT.visibleLogicalBounds),
    );
  });

  it('rejects letterbox begins BEFORE camera inversion', () => {
    const letterboxed = {
      ...FIT,
      surfaceSize: { width: 640, height: 480 },
      scale: 2,
      offsetX: 160,
      contentBounds: { x: 160, y: 0, width: 320, height: 480 },
    };
    const camera = createCamera2D({ center: { x: 500, y: 500 } });
    const events: unknown[] = [];
    const input = {
      begin: (_a: string, _id: number, point: unknown) => events.push(point),
      move: () => undefined,
      end: () => undefined,
      cancel: () => undefined,
    };
    const binding = new PointerBinding('move', input, () => letterboxed, 1);
    const cut = { camera, cutId: 1 };
    assert.equal(binding.begin(7, { x: 0, y: 240 }, cut), false, 'letterbox begin rejected');
    assert.equal(events.length, 0, 'no event synthesized');
  });

  it('uses the EVENT-TIME camera stamp, never a later presentation (T12-F4)', () => {
    // A touch happens under camera A; presentation advances to camera B
    // before the JS dispatch. The delivered world coordinate uses the
    // stamped cut from each event, never a lazy JS-side read.
    const cameraA = createCamera2D({ center: { x: 0, y: 0 } });
    const cameraB = createCamera2D({ center: { x: 80, y: 0 } });
    const { events, binding } = eventsBinding();
    binding.begin(7, { x: 10, y: 10 }, { camera: cameraA, cutId: 1 });
    binding.move(7, { x: 10, y: 10 }, { camera: cameraB, cutId: 1 });
    assert.deepEqual(
      events[0],
      logicalToWorld2D(surfaceToWorld(FIT, { x: 10, y: 10 }), cameraA, FIT.visibleLogicalBounds),
      'the begin uses camera A (its event time)',
    );
    assert.deepEqual(
      events[1],
      logicalToWorld2D(surfaceToWorld(FIT, { x: 10, y: 10 }), cameraB, FIT.visibleLogicalBounds),
      'the move uses camera B (its own event time)',
    );
  });

  it('keeps drag continuity while the stamped camera changes mid-drag', () => {
    const cameraA = createCamera2D({ center: { x: 0, y: 0 } });
    const cameraB = createCamera2D({ center: { x: 80, y: 0 } });
    const { events, binding } = eventsBinding();
    binding.begin(7, { x: 10, y: 10 }, { camera: cameraA, cutId: 1 });
    binding.move(7, { x: 10, y: 10 }, { camera: cameraB, cutId: 1 });
    binding.move(7, { x: 20, y: 20 }, { camera: cameraB, cutId: 1 });
    assert.equal(events.length, 3, 'ownership continues through the camera change');
    assert.deepEqual(
      events[2],
      logicalToWorld2D(surfaceToWorld(FIT, { x: 20, y: 20 }), cameraB, FIT.visibleLogicalBounds),
    );
  });
});

describe('GameView camera surface (T12.3)', () => {
  let createGameSessionWithDriver: (definition: unknown, options: unknown) => {
    input: { press(a: string): void; release(a: string): void };
    getRenderFrame(): { current: { camera: unknown } };
    start(): void;
    dispose(): void;
    status: string;
    viewport: unknown;
    scene: string;
    addStatusListener(): { remove(): void };
    addCommitListener(): { remove(): void };
    setScene(): void;
    restartScene(): void;
    pause(): void;
  };
  let ManualFrameDriver: new () => { fireNext(t: number): void };
  let GameViewComponent: React.ComponentType<{
    readonly game: unknown;
    readonly renderer: React.ComponentType<Record<string, unknown>>;
    readonly camera2D?: unknown;
  }>;

  before(async () => {
    const testing = await import('rn-gamekit/testing');
    createGameSessionWithDriver = testing.createGameSessionWithDriver as unknown as typeof createGameSessionWithDriver;
    ManualFrameDriver = testing.ManualFrameDriver as unknown as typeof ManualFrameDriver;
    const react = await import('rn-gamekit/react');
    GameViewComponent = react.GameView as unknown as typeof GameViewComponent;
  });

  function cameraDefinition() {
    return {
      select: (frame: { current: { camera: unknown } }) => frame.current.camera,
    };
  }

  function makeSession() {
    const definition = {
      viewport: { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
      input: { move: { type: 'pointer' } },
      scenes: {
        play: {
          kind: 'gamekit.scene',
          actions: [],
          create: () => ({ camera: createCamera2D() }),
          update: ({ state }: { state: unknown }) => state,
          snapshot: ({ state }: { state: { camera: unknown } }) => ({ camera: state.camera }),
        },
      },
      initialScene: 'play',
    };
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(definition, { frameDriver: driver });
    return { session, driver };
  }

  it('passes the camera shared value to the renderer only when camera2D is set', () => {
    const { session, driver } = makeSession();
    let received: Record<string, unknown> | undefined;
    function ProbeRenderer(props: Record<string, unknown>) {
      received = props;
      return null;
    }
    act(() => session.start());
    act(() => driver.fireNext(0));
    act(() => {
      create(
        <GameViewComponent game={session} renderer={ProbeRenderer} camera2D={cameraDefinition()} />,
      );
    });
    const cameraProp = received?.camera as { value: unknown } | undefined;
    assert.ok(cameraProp !== undefined, 'the renderer receives the camera shared value');
    act(() => session.dispose());
  });

  it('never passes a camera prop for games without a camera', () => {
    const { session, driver } = makeSession();
    let received: Record<string, unknown> | undefined;
    function ProbeRenderer(props: Record<string, unknown>) {
      received = props;
      return null;
    }
    act(() => session.start());
    act(() => driver.fireNext(0));
    act(() => {
      create(<GameViewComponent game={session} renderer={ProbeRenderer} />);
    });
    assert.equal('camera' in (received ?? {}), false, 'no camera prop on the no-camera path');
    act(() => session.dispose());
  });
});

describe('world and layer transforms (T12.5)', () => {
  it('composes camera before viewport and matches worldToSurface2D', () => {
    const camera = createCamera2D({ center: { x: 40, y: -30 }, zoom: 1.5, rotationRadians: 0.4 });
    const elements = cameraViewportTransform2D({ camera, cutId: 1 }, FIT);
    const point = { x: 12.5, y: -7.25 };
    const viaElements = applyElements(elements, point);
    const expected = worldToSurface2D(point, FIT, camera);
    assert.ok(Math.abs(viaElements.x - expected.x) < 1e-9);
    assert.ok(Math.abs(viaElements.y - expected.y) < 1e-9);
  });

  it('reproduces the no-camera path for the identity camera', () => {
    const identity = createCamera2D({ center: { x: 80, y: 120 } });
    const elements = cameraViewportTransform2D({ camera: identity, cutId: 1 }, FIT);
    // T(offset) x2, S(scale) x2, T(L) x2, R(0), S(zoom) x2, T(-C) x2.
    assert.equal(elements.length, 11);
    const point = { x: 10, y: 20 };
    const viaElements = applyElements(elements, point);
    const plain = worldToSurface2D(point, FIT, identity);
    assert.ok(Math.abs(viaElements.x - plain.x) < 1e-9);
    assert.ok(Math.abs(viaElements.y - plain.y) < 1e-9);
  });

  it('applies parallax as a pure center-relative translation', () => {
    const camera = createCamera2D({ center: { x: 100, y: 60 }, rotationRadians: 0.8 });
    const cut = { camera, cutId: 1 };
    assert.deepEqual(layerParallaxTransform2D(cut, FIT, 1, 1), [], 'primary layer has no correction');
    assert.deepEqual(layerParallaxTransform2D(cut, FIT, 0, 0), [
      { translateX: 20 },
      { translateY: -60 },
    ]);
    assert.deepEqual(layerParallaxTransform2D(cut, FIT, 0.5, 0.5), [
      { translateX: 10 },
      { translateY: -30 },
    ]);
  });

  it('computes conservative batch culling bounds and tests them inline', () => {
    const camera = createCamera2D({ center: { x: 100, y: 50 }, zoom: 2 });
    const visible = batchVisibleBounds2D({ camera, cutId: 1 }, FIT, 4) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    // Half view at zoom 2: 40 x 60, padded by 4.
    assert.deepEqual(visible, { x: 56, y: -14, width: 88, height: 128 });
    assert.equal(intersectsBounds2D({ x: 60, y: 0, width: 10, height: 10 }, visible), true);
    assert.equal(intersectsBounds2D({ x: 1000, y: 1000, width: 10, height: 10 }, visible), false);
    // Padding rescues a just-off-screen sprite.
    assert.equal(intersectsBounds2D({ x: 54, y: 0, width: 10, height: 10 }, visible), true);
    assert.equal(batchVisibleBounds2D(undefined, FIT, 0), undefined, 'no camera: no culling');
  });

  it('keeps boundary parity between the inline and public predicates (T12-F5)', () => {
    const cases = [
      { x: 0, y: 0, width: 10, height: 10 }, // fully inside
      { x: -5, y: -5, width: 200, height: 200 }, // crossing
      { x: 56, y: 0, width: 1, height: 1 }, // left edge contact
      { x: 143, y: 0, width: 1, height: 1 }, // right edge contact
      { x: 0, y: 56, width: 1, height: 1 }, // top edge contact
      { x: 0, y: 143, width: 1, height: 1 }, // bottom edge contact
      { x: 2000, y: 2000, width: 10, height: 10 }, // just outside
    ];
    const view = { x: 56, y: -14, width: 88, height: 128 };
    for (const bounds of cases) {
      assert.equal(
        intersectsBounds2D(bounds, view),
        intersectsAabbAabb2DPublic(bounds, view),
        `parity for ${JSON.stringify(bounds)}`,
      );
    }
  });

  it('hides malformed item bounds before the intersection test (T12-RF6)', () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    // Valid zero-size contact still intersects (inclusive contract).
    assert.equal(intersectsBounds2D({ x: 100, y: 0, width: 0, height: 0 }, view), true, 'zero-size edge contact');
    assert.equal(intersectsBounds2D({ x: 0, y: 0, width: 0, height: 0 }, view), true, 'zero-size inside');
    // NaN in any field hides the item.
    assert.equal(intersectsBounds2D({ x: NaN, y: 0, width: 1, height: 1 }, view), false);
    assert.equal(intersectsBounds2D({ x: 0, y: NaN, width: 1, height: 1 }, view), false);
    assert.equal(intersectsBounds2D({ x: 0, y: 0, width: NaN, height: 1 }, view), false);
    assert.equal(intersectsBounds2D({ x: 0, y: 0, width: 1, height: NaN }, view), false);
    // Positive/negative infinity in every field hides the item.
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      const bad = { x: 0, y: 0, width: 1, height: 1 };
      bad[field] = Infinity;
      assert.equal(intersectsBounds2D(bad, view), false, field + ' = Infinity hides');
      bad[field] = -Infinity;
      assert.equal(intersectsBounds2D(bad, view), false, field + ' = -Infinity hides');
    }
    // Negative sizes are rejected even when the arithmetic would "work".
    assert.equal(intersectsBounds2D({ x: 0, y: 0, width: -5, height: 100 }, view), false);
    assert.equal(intersectsBounds2D({ x: 0, y: 0, width: 100, height: -5 }, view), false);
  });

  it('rejects invalid culling padding at the public boundary (T12-F5)', () => {
    for (const padding of [-1, NaN, Infinity, -Infinity]) {
      assert.throws(
        () => {
          act(() => {
            create(
              <SpriteBatchComponent
                scene="play"
                commit={undefined as never}
                alpha={undefined as never}
                source={{ image: undefined, descriptor: { kind: 'image' } } as never}
                capacity={4}
                select={() => []}
                write={() => undefined}
                cull={{
                  camera: undefined as never,
                  viewport: undefined as never,
                  padding,
                  bounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
                }}
              />,
            );
          });
        },
        RangeError,
        `padding ${String(padding)} rejected`,
      );
    }
  });

  it('clamps production overflow to exactly the capacity writes (T12-F5)', () => {
    const policy = batchUpdatePolicy(64, 32, false);
    assert.equal(policy.overflow, true);
    assert.equal(policy.activeCount, 32, 'production clamps to capacity');
    assert.equal(batchUpdatePolicy(16, 32, false).activeCount, 16);
    assert.throws(() => batchUpdatePolicy(64, 32, true), /overflow/i, 'development throws');
  });

  it('renders GameLayer2D only inside GameWorld2D', () => {
    assert.throws(() => {
      act(() => {
        create(<GameLayer2D>{null}</GameLayer2D>);
      });
    }, /GameLayer2D must be rendered inside a GameWorld2D/);
  });
});
