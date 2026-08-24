import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// T19.3 — root compatibility and module identity
describe('entry-points: root ↔ subpath identity', () => {
  it('geometry: root and subpath share runtime symbols', async () => {
    const root = await import('../src/index.ts');
    const geometry = await import('../src/geometry.ts');
    // Functions
    assert.equal(root.aabbCenter2D, geometry.aabbCenter2D);
    assert.equal(root.addVector2D, geometry.addVector2D);
    assert.equal(root.distancePoint2D, geometry.distancePoint2D);
    assert.equal(root.GeometryError, geometry.GeometryError);
    // instanceof preserved across entry points
    const fromRoot = new root.GeometryError('GEOMETRY_INVALID_NUMBER', 'field', 'bad');
    const fromSub = new geometry.GeometryError('GEOMETRY_INVALID_NUMBER', 'field', 'bad');
    assert.ok(fromRoot instanceof geometry.GeometryError);
    assert.ok(fromSub instanceof root.GeometryError);
  });

  it('collision2d: root and subpath share runtime symbols', async () => {
    const root = await import('../src/index.ts');
    const mod = await import('../src/collision2d.ts');
    assert.equal(root.collideCircleAabb2D, mod.collideCircleAabb2D);
    assert.equal(root.collideAabbAabb2D, mod.collideAabbAabb2D);
    assert.equal(root.sweepAabbAabb2D, mod.sweepAabbAabb2D);
    assert.equal(root.buildSpatialHash2D, mod.buildSpatialHash2D);
    assert.equal(root.RESOLUTION_TOLERANCE, mod.RESOLUTION_TOLERANCE);
    assert.equal(root.canCollide2D, mod.canCollide2D);
    assert.equal(root.projectHit2D, mod.projectHit2D);
  });

  it('camera2d: root and subpath share runtime symbols', async () => {
    const root = await import('../src/index.ts');
    const mod = await import('../src/camera2d.ts');
    assert.equal(root.createCamera2D, mod.createCamera2D);
    assert.equal(root.followCamera2D, mod.followCamera2D);
    assert.equal(root.clampCameraBounds2D, mod.clampCameraBounds2D);
    assert.equal(root.sampleCameraShake2D, mod.sampleCameraShake2D);
    assert.equal(root.getCameraVisibleBounds2D, mod.getCameraVisibleBounds2D);
    assert.equal(root.logicalToWorld2D, mod.logicalToWorld2D);
  });

  it('events: root and subpath share runtime symbols and error identity', async () => {
    const root = await import('../src/index.ts');
    const mod = await import('../src/events.ts');
    assert.equal(root.defineGameEvents, mod.defineGameEvents);
    assert.equal(root.gameEvent, mod.gameEvent);
    assert.equal(root.seedGameEvent, mod.seedGameEvent);
    assert.equal(root.GameEventError, mod.GameEventError);
    assert.equal(root.PAYLOAD_LIMITS, mod.PAYLOAD_LIMITS);
    const e1 = new root.GameEventError('bad');
    const e2 = new mod.GameEventError('bad');
    assert.ok(e1 instanceof mod.GameEventError);
    assert.ok(e2 instanceof root.GameEventError);
    // PAYLOAD_LIMITS is the same object, not a duplicate
    assert.equal(root.PAYLOAD_LIMITS, mod.PAYLOAD_LIMITS);
  });

  it('assets: root and subpath share runtime symbols and error identity', async () => {
    const root = await import('../src/index.ts');
    const mod = await import('../src/assets.ts');
    assert.equal(root.defineAssets, mod.defineAssets);
    assert.equal(root.image, mod.image);
    assert.equal(root.spriteSheet, mod.spriteSheet);
    assert.equal(root.GameAssetError, mod.GameAssetError);
    const e1 = new root.GameAssetError('ASSET_INVALID_SOURCE', [], 'bad');
    const e2 = new mod.GameAssetError('ASSET_INVALID_SOURCE', [], 'bad');
    assert.ok(e1 instanceof mod.GameAssetError);
    assert.ok(e2 instanceof root.GameAssetError);
  });

  it('sprites: root and subpath share runtime symbols', async () => {
    const root = await import('../src/index.ts');
    const mod = await import('../src/sprites.ts');
    assert.equal(root.sampleSpriteClipFrame, mod.sampleSpriteClipFrame);
    assert.equal(root.sampleSpriteClipFrameName, mod.sampleSpriteClipFrameName);
    assert.equal(root.spriteClipDurationMs, mod.spriteClipDurationMs);
    assert.equal(root.startSpriteAnimation, mod.startSpriteAnimation);
    assert.equal(root.advanceSpriteAnimation, mod.advanceSpriteAnimation);
    assert.equal(root.pauseSpriteAnimation, mod.pauseSpriteAnimation);
    assert.equal(root.playSpriteAnimation, mod.playSpriteAnimation);
    assert.equal(root.resetSpriteAnimation, mod.resetSpriteAnimation);
    assert.equal(root.resumeSpriteAnimation, mod.resumeSpriteAnimation);
    assert.equal(root.setSpriteAnimationSpeed, mod.setSpriteAnimationSpeed);
  });

  it('export inventory snapshot is intentional (additions reviewed)', async () => {
    // Snapshot of public export names per new subpath — if this fails, review API change intentionally
    const geometry = await import('../src/geometry.ts');
    const collision2d = await import('../src/collision2d.ts');
    const camera2d = await import('../src/camera2d.ts');
    const events = await import('../src/events.ts');
    const assets = await import('../src/assets.ts');
    const sprites = await import('../src/sprites.ts');

    const geometryNames = Object.keys(geometry).sort();
    const collisionNames = Object.keys(collision2d).sort();
    const cameraNames = Object.keys(camera2d).sort();
    const eventsNames = Object.keys(events).sort();
    const assetsNames = Object.keys(assets).sort();
    const spritesNames = Object.keys(sprites).sort();

    assert.deepEqual(geometryNames, [
      'GeometryError',
      'aabbCenter2D',
      'addVector2D',
      'distancePoint2D',
      'expandAabb2D',
      'lengthVector2D',
      'normalizeVector2D',
      'scaleVector2D',
      'subtractVector2D',
      'translateAabb2D',
      'unionAabb2D',
    ]);

    // collision2d is larger — check key members present and no React leakage
    for (const must of [
      'collideCircleAabb2D',
      'collideAabbAabb2D',
      'intersectsAabbAabb2D',
      'sweepAabbAabb2D',
      'buildSpatialHash2D',
      'circleCollider2D',
      'projectHit2D',
    ]) {
      assert.ok(collisionNames.includes(must), `collision2d missing ${must}`);
    }
    assert.ok(!collisionNames.includes('Sprite'), 'collision2d leaked Sprite');
    assert.ok(!collisionNames.includes('GameView'), 'collision2d leaked GameView');

    for (const must of [
      'createCamera2D',
      'followCamera2D',
      'clampCameraBounds2D',
      'sampleCameraShake2D',
      'getCameraVisibleBounds2D',
      'logicalToWorld2D',
    ]) {
      assert.ok(cameraNames.includes(must), `camera2d missing ${must}`);
    }
    assert.ok(!cameraNames.includes('GameView'), 'camera2d leaked GameView');

    assert.deepEqual(eventsNames.sort(), [
      'GameEventError',
      'PAYLOAD_LIMITS',
      'defineGameEvents',
      'gameEvent',
      'seedGameEvent',
    ].sort());
    // Ensure internal helper not leaked
    assert.ok(!(events as Record<string, unknown>).cloneAndValidatePayload, 'events leaked internal helper');

    for (const must of ['defineAssets', 'image', 'spriteSheet', 'GameAssetError']) {
      assert.ok(assetsNames.includes(must), `assets missing ${must}`);
    }
    assert.ok(!(assets as Record<string, unknown>).useGameAssets, 'assets leaked React hook');
    assert.ok(!(assets as Record<string, unknown>).createGameAssetStore, 'assets leaked React store');

    for (const must of [
      'sampleSpriteClipFrame',
      'sampleSpriteClipFrameName',
      'spriteClipDurationMs',
      'startSpriteAnimation',
      'advanceSpriteAnimation',
    ]) {
      assert.ok(spritesNames.includes(must), `sprites missing ${must}`);
    }
    assert.ok(!spritesNames.includes('Sprite'), 'sprites leaked Sprite component');
    assert.ok(!spritesNames.includes('GameSprite'), 'sprites leaked GameSprite');
  });
});
