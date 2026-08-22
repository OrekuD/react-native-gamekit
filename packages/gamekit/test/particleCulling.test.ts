/**
 * T15-RF2 camera-aware world culling (pure math) and
 * T15-RF4 sprite RSXform scale/pivot math.
 *
 * Both modules are worklet-safe and free of React/RN imports, so they run
 * directly under the default node loader.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cameraVisibleWorldBounds,
  screenVisibleBounds,
  visibleInBounds,
  PARTICLE_CULL_PADDING,
} from '../src/react/particles/culling';
import { assertUniformParticleSpriteRatio, particleSpriteXform } from '../src/react/particles/spriteXForm';

const VIEW = { visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 } };

function cameraAt(centerX: number, centerY: number, zoom = 1, rotation = 0) {
  // SharedValue-shaped holder, matching how the view layer passes refs.
  return { value: { camera: { center: { x: centerX, y: centerY }, zoom, rotationRadians: rotation } } };
}
const VIEW_REF = { value: VIEW };

describe('T15-RF2 camera-visible world culling', () => {
  it('camera far from logical origin hides origin particles', () => {
    const bounds = cameraVisibleWorldBounds(cameraAt(5000, 5000), VIEW_REF, PARTICLE_CULL_PADDING);
    assert.ok(bounds !== undefined);
    assert.equal(visibleInBounds(0, 0, bounds), false, 'origin must be hidden');
    assert.equal(visibleInBounds(5000, 5000, bounds), true, 'camera center visible');
  });

  it('no camera context yields undefined bounds (fail-closed hide)', () => {
    assert.equal(cameraVisibleWorldBounds(null, VIEW_REF, 0), undefined);
    const cam = cameraAt(0, 0);
    assert.equal(cameraVisibleWorldBounds(cam, null, 0), undefined);
  });

  it('zoom narrows the visible region around the center', () => {
    // Zoom 2 halves half-extents: 160x240 -> 80x120 (+pad).
    const bounds = cameraVisibleWorldBounds(cameraAt(1000, 1000, 2), VIEW_REF, 0);
    assert.ok(bounds !== undefined);
    assert.ok(Math.abs(bounds.maxX - bounds.minX - 160) < 1e-9);
    assert.ok(Math.abs(bounds.maxY - bounds.minY - 240) < 1e-9);
    assert.equal(visibleInBounds(1000 + 70, 1000, bounds), true);
    assert.equal(visibleInBounds(1000 + 90, 1000, bounds), false);
  });

  it('rotation swaps effective extents at 90 degrees', () => {
    const flat = cameraVisibleWorldBounds(cameraAt(0, 0, 1, 0), VIEW_REF, 0)!;
    const turned = cameraVisibleWorldBounds(cameraAt(0, 0, 1, Math.PI / 2), VIEW_REF, 0)!;
    assert.ok(Math.abs(flat.maxX - flat.minX - 320) < 1e-9);
    assert.ok(Math.abs(turned.maxX - turned.minX - 480) < 1e-9);
    assert.ok(Math.abs(turned.maxY - turned.minY - 320) < 1e-9);
  });

  it('padding widens the region in world units; screen bounds use surface size', () => {
    const padded = cameraVisibleWorldBounds(cameraAt(0, 0, 1, 0), VIEW_REF, 50)!;
    assert.ok(Math.abs(padded.maxX - padded.minX - (320 + 100)) < 1e-9);
    const s = screenVisibleBounds(200, 300, 16);
    assert.deepEqual([s.minX, s.minY, s.maxX, s.maxY], [-16, -16, 216, 316]);
    assert.equal(visibleInBounds(250, 10, s), false);
  });
});

describe('T15-RF4 sprite RSXform scale and pivot', () => {
  it('scale folds into scos/ssin; pivot compensates authored size', () => {
    const rotation = Math.PI / 4;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // T15-SF2 case: a 32x32 SOURCE drawn at 24x24 authored size.
    for (const sampledScale of [0.5, 1, 2]) {
      const xf = particleSpriteXform({
        x: 200,
        y: 300,
        rotation,
        scale: sampledScale,
        drawWidth: 24,
        drawHeight: 24,
        frameWidth: 32,
        frameHeight: 32,
      });
      // Effective scale includes authored/source ratio: 24/32 = 0.75.
      const eff = sampledScale * 0.75;
      assert.ok(Math.abs(xf.scos - eff * cos) < 1e-12, `scos at scale ${sampledScale}`);
      assert.ok(Math.abs(xf.ssin - eff * sin) < 1e-12, `ssin at scale ${sampledScale}`);
      // Pivot against the DRAWN extent: half of frame * effScale = 16*eff.
      const px = 16 * eff;
      assert.ok(Math.abs(xf.tx - (200 - px * cos + px * sin)) < 1e-9, `tx at scale ${sampledScale}`);
      assert.ok(Math.abs(xf.ty - (300 - px * sin - px * cos)) < 1e-9, `ty at scale ${sampledScale}`);
      const magnitude = Math.hypot(xf.scos, xf.ssin);
      assert.ok(Math.abs(magnitude - eff) < 1e-12);
    }
  });

  it('zero rotation centers the sprite on the sampled point regardless of scale', () => {
    for (const sampledScale of [0.5, 2]) {
      const xf = particleSpriteXform({
        x: 40,
        y: 80,
        rotation: 0,
        scale: sampledScale,
        drawWidth: 20,
        drawHeight: 10,
        frameWidth: 40,
        frameHeight: 20,
      });
      const eff = sampledScale * 0.5;
      assert.ok(Math.abs(xf.scos - eff) < 1e-12);
      assert.equal(xf.ssin, 0);
      assert.ok(Math.abs(xf.tx - (40 - (40 / 2) * eff)) < 1e-12);
      assert.ok(Math.abs(xf.ty - (80 - (20 / 2) * eff)) < 1e-12);
    }
  });

  it('nonuniform authored-to-source aspect fails with a structured error', () => {
    // Uniform ratio is accepted; nonuniform is rejected with the structured
    // v1 message (RSXform cannot scale nonuniformly).
    assert.doesNotThrow(() => assertUniformParticleSpriteRatio(24, 24, 32, 32));
    assert.throws(
      () => assertUniformParticleSpriteRatio(24, 48, 32, 32),
      /does not match source frame/,
    );
  });
});
