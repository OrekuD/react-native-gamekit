import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { createElement, StrictMode, useRef } from 'react';
import { act, create } from 'react-test-renderer';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { defineGame, defineScene } from '../src/index';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

type Value<T = unknown> = { value: T };
type Camera = { center: { x: number; y: number }; zoom: number; rotationRadians: number };
type Frame = { scene: string; revision: number; hardCut: boolean; previous: unknown; current: { camera: Camera } };
type Props = { frame: Value<Frame>; camera?: Value<{ camera: Camera; cutId: number }>; alpha: Value<number> };
type Definition = { select(frame: Frame): Camera; cut?(frame: Frame): boolean; onError?(info: { error: unknown; phase: string }): void };
let runtime = 'RN';
let deferUI = false;
let uiQueue: (() => void)[] = [];
let frameCallbacks: ((info: { timeSincePreviousFrame: number }) => void)[] = [];
let rnReads = 0;
let writeRuntimes: string[] = [];

function mutable<T>(initial: T): Value<T> {
  let value = initial;
  return {
    get value() { if (runtime === 'RN') rnReads += 1; return value; },
    set value(next: T) { writeRuntimes.push(runtime); value = next; },
  };
}
function onUI(fn: () => void): void {
  const previous = runtime;
  runtime = 'UI';
  try { fn(); } finally { runtime = previous; }
}
function flushUI(): void {
  const jobs = uiQueue;
  uiQueue = [];
  jobs.forEach(onUI);
}
function host(tag: string) {
  return ({ children, ...props }: Record<string, unknown>): unknown => createElement(tag, props as never, children as never);
}

mock.module('react-native', { namedExports: {
  View: host('view'),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
} });
mock.module('@shopify/react-native-skia', { namedExports: { Canvas: host('canvas') } });
mock.module('react-native-reanimated', { namedExports: {
  makeMutable: mutable,
  useSharedValue: (initial: unknown) => {
    const ref = useRef<Value | null>(null);
    if (ref.current === null) ref.current = mutable(typeof initial === 'function' ? (initial as () => unknown)() : initial);
    return ref.current;
  },
  useFrameCallback: (callback: (info: { timeSincePreviousFrame: number }) => void) => { frameCallbacks.push(callback); },
} });
mock.module('react-native-worklets', { namedExports: {
  scheduleOnUI: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    const job = () => fn(...args);
    if (deferUI) uiQueue.push(job); else onUI(job);
  },
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    const previous = runtime;
    runtime = 'RN';
    try { fn(...args); } finally { runtime = previous; }
  },
} });

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GameView: typeof import('../src/react/GameView')['GameView'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let useCameraBinding: typeof import('../src/react/camera2d/usePresentedCameraBinding')['usePresentedCameraBinding'];
before(async () => {
  GameView = (await import('../src/react/GameView.tsx')).GameView;
  useCameraBinding = (await import('../src/react/camera2d/usePresentedCameraBinding.ts')).usePresentedCameraBinding;
});
beforeEach(() => { deferUI = false; uiQueue = []; frameCallbacks = []; rnReads = 0; writeRuntimes = []; });

function cameraAt(x: number): Camera { return { center: { x, y: 0 }, zoom: 1, rotationRadians: 0 }; }
const select = (frame: Frame) => frame.current.camera;
function sessionAt(x = 0) {
  const scene = (center: number) => defineScene({
    actions: [],
    create: () => ({ camera: cameraAt(center) }),
    update: ({ state }: { state: { camera: Camera } }) => ({ camera: cameraAt(state.camera.center.x + 10) }),
    snapshot: ({ state }: { state: { camera: Camera } }) => state,
  });
  const game = defineGame({ viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' }, input: {},
    scenes: { play: scene(x), boss: scene(x + 500) }, initialScene: 'play' });
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
  return { session, driver };
}
function mount(session: ReturnType<typeof sessionAt>['session'], definition?: Definition, strict = false) {
  let props: Props | undefined;
  const rendered: { scene: string; cameraX: number | undefined }[] = [];
  function Renderer(value: Props) {
    props = value;
    rendered.push({ scene: value.frame.value.scene, cameraX: value.camera?.value?.camera.center.x });
    return null;
  }
  const element = (game: typeof session, camera2D: Definition | undefined) => {
    const child = createElement(GameView as never, { game, renderer: Renderer, camera2D } as never);
    return strict ? createElement(StrictMode, {}, child) : child;
  };
  let root!: ReturnType<typeof create>;
  act(() => { root = create(element(session, definition)); });
  return { props: () => props, rendered, update: (game: typeof session, camera2D: Definition | undefined) => act(() => root.update(element(game, camera2D))),
    unmount: () => act(() => root.unmount()) };
}

describe('Camera2D presentation transactions', () => {
  it('reselects a replacement definition immediately while paused without restarting or clearing the camera', () => {
    const { session } = sessionAt();
    const view = mount(session, { select });
    act(() => session.pause());
    const before = view.props()!;
    before.alpha.value = 0.4;
    view.update(session, { select: (frame) => cameraAt(select(frame).center.x + 1000) });
    assert.equal(session.status, 'paused');
    assert.equal(view.props()!.camera!.value.camera.center.x, 1000);
    assert.equal(view.props()!.alpha.value, 0.4, 'definition replacement advances no time');
    view.unmount(); session.dispose();
  });

  it('holds the last valid frame, alpha, and camera on failure and recovers with one coherent cut', () => {
    const { session, driver } = sessionAt();
    let fail = false;
    const view = mount(session, { select: (frame) => { if (fail) throw new Error('invalid camera'); return select(frame); } });
    act(() => { driver.fireNext(0); driver.fireNext(15); });
    onUI(() => frameCallbacks.at(-1)!({ timeSincePreviousFrame: 4 }));
    onUI(() => frameCallbacks.at(-1)!({ timeSincePreviousFrame: 4 }));
    const frame = view.props()!.frame.value;
    const alpha = view.props()!.alpha.value;
    const camera = view.props()!.camera!.value;
    fail = true;
    act(() => { driver.fireNext(25); });
    onUI(() => frameCallbacks.at(-1)!({ timeSincePreviousFrame: 8 }));
    assert.equal(view.props()!.frame.value, frame);
    assert.equal(view.props()!.alpha.value, alpha);
    assert.deepEqual(view.props()!.camera!.value, camera);
    fail = false;
    act(() => { driver.fireNext(35); });
    const recovered = view.props()!.frame.value;
    assert.equal(recovered.revision, session.getRenderFrame().revision);
    assert.equal(recovered.hardCut, true);
    assert.equal(recovered.previous, recovered.current);
    assert.equal(view.props()!.camera!.value.camera.center.x, recovered.current.camera.center.x);
    assert.ok(view.props()!.camera!.value.cutId > camera.cutId);
    view.unmount(); session.dispose();
  });

  it('does not coerce thrown values and reports only once until a successful commit', () => {
    const { session, driver } = sessionAt();
    const thrown = Object.create(null) as unknown;
    let failure: unknown = thrown;
    const reports: unknown[] = [];
    const view = mount(session, { select: (frame) => { if (failure) throw failure; return select(frame); },
      onError: ({ error }) => { reports.push(error); throw new Error('reporter failed'); } });
    assert.equal(reports[0], thrown);
    failure = new Error('a different message');
    act(() => { driver.fireNext(0); driver.fireNext(15); driver.fireNext(25); });
    assert.equal(reports.length, 1);
    failure = null;
    act(() => { driver.fireNext(35); });
    failure = thrown;
    act(() => { driver.fireNext(45); });
    assert.equal(reports.length, 2);
    view.unmount(); session.dispose();
  });

  it('keeps an invalid initial camera renderer unmounted until a valid UI publication', () => {
    const { session } = sessionAt();
    const view = mount(session, { select: () => { throw new Error('missing camera'); } });
    assert.equal(view.rendered.length, 0);
    act(() => session.pause());
    deferUI = true;
    view.update(session, { select });
    assert.equal(view.rendered.length, 0, 'RN selection alone cannot make the renderer ready');
    act(flushUI);
    assert.ok(view.rendered.length > 0);
    assert.equal(view.rendered.at(-1)!.cameraX, 0);
    view.unmount(); act(flushUI); session.dispose();
  });

  it('separates session camera lifetimes and retires old display callbacks under StrictMode', () => {
    const first = sessionAt(10);
    const second = sessionAt(900);
    const definition = { select };
    const view = mount(first.session, definition, true);
    const oldCamera = view.props()!.camera;
    const oldCallback = frameCallbacks.at(-1)!;
    const oldCutId = oldCamera!.value.cutId;
    view.rendered.length = 0;
    view.update(second.session, definition);
    assert.notEqual(view.props()!.camera, oldCamera);
    assert.ok(view.rendered.every((value) => value.cameraX === 900));
    assert.ok(view.props()!.camera!.value.cutId > oldCutId);
    const replacementCamera = view.props()!.camera!.value;
    onUI(() => oldCallback({ timeSincePreviousFrame: 20 }));
    assert.equal(view.props()!.camera!.value, replacementCamera);
    view.unmount(); first.session.dispose(); second.session.dispose();
  });

  it('publishes an accepted camera/frame pair together on UI without RN SharedValue reads', () => {
    const { session } = sessionAt();
    const view = mount(session, { select: (frame) => { assert.equal(runtime, 'RN'); return select(frame); } });
    act(() => session.pause());
    const previous = view.props()!.frame.value;
    deferUI = true;
    rnReads = 0; writeRuntimes = [];
    act(() => session.setScene('boss'));
    assert.equal(rnReads, 0, 'camera commit does not synchronously read UI state');
    assert.deepEqual(writeRuntimes, [], 'no separate RN writes can expose a partial pair');
    assert.equal(view.props()!.frame.value, previous);
    act(flushUI);
    assert.equal(view.props()!.frame.value.scene, 'boss');
    assert.equal(view.props()!.camera!.value.camera.center.x, 500);
    assert.ok(writeRuntimes.every((value) => value === 'UI'));
    view.unmount(); act(flushUI); session.dispose();
  });

  it('removing a failed camera resumes the latest frame and adding it again waits for readiness', () => {
    const { session, driver } = sessionAt();
    const view = mount(session, { select });
    view.update(session, { select: () => { throw new Error('invalid replacement'); } });
    act(() => { driver.fireNext(0); driver.fireNext(15); });
    assert.equal(view.props()!.frame.value.revision, 0, 'the old valid pair stays visible');
    view.update(session, undefined);
    assert.equal(view.props()!.frame.value.revision, session.getRenderFrame().revision);
    assert.equal(view.props()!.camera, undefined);
    onUI(() => frameCallbacks.at(-1)!({ timeSincePreviousFrame: 4 }));
    onUI(() => frameCallbacks.at(-1)!({ timeSincePreviousFrame: 4 }));
    assert.ok(view.props()!.alpha.value > 0, 'the no-camera clock is no longer blocked');
    view.rendered.length = 0;
    view.update(session, { select: () => { throw new Error('still invalid'); } });
    assert.equal(view.rendered.length, 0, 'removed cameras cannot satisfy new readiness');
    view.update(session, { select });
    assert.equal(view.props()!.camera!.value.camera.center.x, 10);
    view.unmount(); session.dispose();
  });

  it('a reporter can recover through a nested scene transition without the outer failure overwriting it', () => {
    const { session } = sessionAt();
    let fail = false;
    const view = mount(session, { select: (frame) => {
      if (fail && frame.scene === 'boss') throw new Error('boss unavailable');
      return select(frame);
    }, onError: () => session.setScene('play') });
    act(() => session.pause());
    fail = true;
    act(() => session.setScene('boss'));
    assert.equal(session.scene, 'play');
    assert.equal(view.props()!.frame.value.scene, 'play');
    assert.equal(view.props()!.camera!.value.camera.center.x, 0);
    view.unmount(); session.dispose();
  });

  it('keeps renderer mount frequency independent of subsequent simulation commits', () => {
    const { session, driver } = sessionAt();
    const view = mount(session, { select });
    const renderCount = view.rendered.length;
    act(() => { driver.fireNext(0); driver.fireNext(15); driver.fireNext(25); driver.fireNext(35); });
    assert.equal(view.rendered.length, renderCount);
    view.unmount(); session.dispose();
  });

  it('rejects delayed publication, failure, and cleanup tasks after an effect lifetime is rearmed', () => {
    const { session } = sessionAt();
    const presented = mutable<unknown>(undefined);
    let fail = false;
    let binding!: ReturnType<typeof useCameraBinding>;
    const definition = { select: (frame: Frame) => { if (fail) throw new Error('late failure'); return select(frame); } };
    function Probe() { binding = useCameraBinding(definition as never, presented as never); return null; }
    let root!: ReturnType<typeof create>;
    act(() => { root = create(createElement(Probe)); });
    deferUI = true;
    binding.activate();
    binding.commit(session.getRenderFrame() as never);
    fail = true;
    binding.commit(session.getRenderFrame() as never);
    binding.dispose();
    const stale = uiQueue;
    uiQueue = [];
    fail = false;
    binding.activate();
    session.setScene('boss');
    binding.commit(session.getRenderFrame() as never);
    act(flushUI);
    const accepted = presented.value;
    assert.equal((accepted as { camera: Camera }).camera.center.x, 500);
    stale.forEach(onUI);
    assert.equal(presented.value, accepted, 'older UI tasks cannot overwrite or clear the new generation');
    assert.equal(binding.blocked.value, false, 'a stale failure cannot freeze the new generation');
    act(() => root.unmount()); session.dispose();
  });
});
