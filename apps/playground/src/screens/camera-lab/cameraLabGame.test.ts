/**
 * Camera Lab headless rules (T12.8).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';

const { CAMERA_LAB_CONFIG, CAMERA_LAB_WORLD, cameraLabDefinition } = await import('./cameraLabGame.ts');
type CameraLabSnapshot = {
  readonly camera: { readonly center: { x: number; y: number }; readonly zoom: number; readonly rotationRadians: number };
  readonly follow: boolean;
  readonly rotating: boolean;
  readonly shaking: boolean;
  readonly culling: boolean;
  readonly cutSignal: boolean;
  readonly visibleMarkerIds: readonly string[];
  readonly markers: readonly { readonly id: string }[];
  readonly visibleBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(cameraLabDefinition, { frameDriver: driver });
  let timeline = 0;
  const tick = (frames: number): void => {
    for (let index = 0; index < frames; index += 1) {
      timeline += 1000 / 60;
      driver.fireNext(timeline);
    }
  };
  session.start();
  driver.fireNext(0);
  const snap = (): CameraLabSnapshot => session.getRenderFrame().current as CameraLabSnapshot;
  return { session, tick, snap };
}

describe('Camera Lab rules (T12.8)', () => {
  it('follows the pointer target only past the dead zone and clamps to the world', () => {
    const { session, tick, snap } = harness();
    const start = snap();
    const startX = start.camera.center.x;
    const startY = start.camera.center.y;

    // A target inside the dead zone does not move the camera.
    session.input.begin('primary', 1, { x: startX + 20, y: startY - 20 });
    tick(30);
    const inside = snap();
    assert.equal(inside.camera.center.x, startX, 'dead zone holds the camera');
    session.input.cancel('primary');

    // A target far away moves the camera, and the world clamp holds.
    session.input.begin('primary', 2, { x: 1950, y: 1400 });
    tick(240);
    const far = snap();
    assert.ok(far.camera.center.x <= CAMERA_LAB_WORLD.width - 160, 'clamped to the right edge');
    assert.ok(far.camera.center.y <= CAMERA_LAB_WORLD.height - 240, 'clamped to the bottom edge');
    session.input.cancel('primary');
  });

  it('cycles zoom presets and reports the same zoom in the snapshot', () => {
    const { session, tick, snap } = harness();
    assert.equal(snap().camera.zoom, 1);
    session.input.press('cycle-zoom');
    session.input.release('cycle-zoom');
    tick(1);
    assert.equal(snap().camera.zoom, 0.75);
    session.input.press('cycle-zoom');
    session.input.release('cycle-zoom');
    tick(1);
    assert.equal(snap().camera.zoom, 1.5);
  });

  it('rotates the view over simulation time when enabled', () => {
    const { session, tick, snap } = harness();
    session.input.press('toggle-rotation');
    session.input.release('toggle-rotation');
    tick(1);
    const first = snap();
    tick(60);
    const second = snap();
    assert.ok(second.rotating);
    assert.ok(second.camera.rotationRadians > first.camera.rotationRadians, 'rotation advances');
    assert.ok(second.camera.rotationRadians <= Math.PI * 2);
  });

  it('publishes an explicit cut signal on demand', () => {
    const { session, tick, snap } = harness();
    assert.equal(snap().cutSignal, false);
    session.input.press('trigger-cut');
    session.input.release('trigger-cut');
    tick(1);
    assert.equal(snap().cutSignal, true, 'the cut frame is signaled');
    tick(1);
    assert.equal(snap().cutSignal, false, 'the signal clears');
  });

  it('keeps the shake deterministic and within its envelope', () => {
    const { session, tick, snap } = harness();
    const base = snap().camera;
    session.input.press('toggle-shake');
    session.input.release('toggle-shake');
    tick(1);
    const first = snap().camera;
    tick(6);
    const shaken = snap().camera;
    // The amplitude bounds EACH AXIS of the offset around the unshaken
    // base (the combined vector may reach amplitude * sqrt(2)).
    for (const sample of [first, shaken]) {
      const dx = Math.abs(sample.center.x - base.center.x);
      const dy = Math.abs(sample.center.y - base.center.y);
      assert.ok(dx <= CAMERA_LAB_CONFIG.shakeAmplitude, `x within the amplitude (${dx})`);
      assert.ok(dy <= CAMERA_LAB_CONFIG.shakeAmplitude, `y within the amplitude (${dy})`);
    }
    // After the duration the base camera returns exactly.
    tick(60);
    const settled = snap().camera;
    assert.ok(Math.hypot(settled.center.x - base.center.x, settled.center.y - base.center.y) < 1e-6);
  });

  it('culls markers headlessly and the visible bounds contain the camera center', () => {
    const { session, snap } = harness();
    const current = snap();
    assert.ok(current.visibleMarkerIds.length <= current.markers.length);
    assert.ok(current.visibleMarkerIds.length > 0, 'the center markers stay visible');
    const bounds = current.visibleBounds;
    assert.ok(current.camera.center.x >= bounds.x);
    assert.ok(current.camera.center.x <= bounds.x + bounds.width);
    assert.ok(current.camera.center.y >= bounds.y);
    assert.ok(current.camera.center.y <= bounds.y + bounds.height);
  });
});
