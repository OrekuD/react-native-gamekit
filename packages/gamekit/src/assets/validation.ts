/**
 * Manifest validation (T7.2).
 *
 * Everything knowable before decoding is validated here with stable error
 * codes and field paths. Rectangles are additionally validated against the
 * decoded image dimensions after load (T7.4).
 */
import { GameAssetError, assertValidIdentifier, type GameAssetErrorCode } from './errors';

function assertRecord(
  value: unknown,
  path: readonly string[],
  code: GameAssetErrorCode,
  message: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GameAssetError(code, path, message);
  }
}

/** Validate one frame rectangle. */
export function validateFrameRect(
  path: readonly string[],
  name: string,
  rect: unknown,
): void {
  assertValidIdentifier(path, name);
  assertRecord(rect, path, 'ASSET_INVALID_FRAME_RECT', 'frame must be a rectangle record');
  const { x, y, width, height } = rect;
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) ||
    typeof height !== 'number' || !Number.isFinite(height)
  ) {
    throw new GameAssetError(
      'ASSET_INVALID_FRAME_RECT',
      path,
      `frame ${JSON.stringify(name)} coordinates must be finite numbers`,
    );
  }
  if (x < 0 || y < 0) {
    throw new GameAssetError(
      'ASSET_INVALID_FRAME_RECT',
      path,
      `frame ${JSON.stringify(name)} x/y must be non-negative`,
    );
  }
  if (width <= 0 || height <= 0) {
    throw new GameAssetError(
      'ASSET_INVALID_FRAME_RECT',
      path,
      `frame ${JSON.stringify(name)} width/height must be greater than zero`,
    );
  }
}

/** Validate one animation clip against the sheet's declared frames. */
export function validateClip(
  path: readonly string[],
  name: string,
  clip: unknown,
  frames: Readonly<Record<string, unknown>>,
): void {
  assertValidIdentifier(path, name);
  assertRecord(clip, path, 'ASSET_EMPTY_CLIP', 'clip must be an animation record');
  if (!Array.isArray(clip.frames) || clip.frames.length === 0) {
    throw new GameAssetError(
      'ASSET_EMPTY_CLIP',
      path,
      `clip ${JSON.stringify(name)} must reference at least one frame`,
    );
  }
  for (const frame of clip.frames) {
    if (typeof frame !== 'string' || !Object.prototype.propertyIsEnumerable.call(frames, frame)) {
      throw new GameAssetError(
        'ASSET_UNKNOWN_FRAME',
        [...path, 'frames'],
        typeof frame === 'string'
          ? `clip ${JSON.stringify(name)} references unknown frame ${JSON.stringify(frame)}`
          : `clip ${JSON.stringify(name)} frame references must be strings`,
      );
    }
  }
  const duration = clip.frameDurationMs;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new GameAssetError(
      'ASSET_INVALID_DURATION',
      [...path, 'frameDurationMs'],
      `clip ${JSON.stringify(name)} duration must be finite and greater than zero`,
    );
  }
  if (clip.mode !== 'loop' && clip.mode !== 'once') {
    throw new GameAssetError(
      'ASSET_INVALID_MODE',
      [...path, 'mode'],
      `clip ${JSON.stringify(name)} mode must be 'loop' or 'once'`,
    );
  }
}

/** Validate a full sprite-sheet descriptor. */
export function validateSpriteSheet(
  source: unknown,
  spec: unknown,
  path: readonly string[] = [],
): void {
  if (typeof source !== 'number' || !Number.isInteger(source) || source < 0) {
    throw new GameAssetError(
      'ASSET_INVALID_SOURCE',
      path.length === 0 ? [] : [...path, 'source'],
      'sprite-sheet source must be a static module handle (number)',
    );
  }
  assertRecord(spec, path, 'ASSET_INVALID_IDENTIFIER', 'sprite-sheet must be a descriptor record');
  assertRecord(spec.frames, [...path, 'frames'], 'ASSET_INVALID_FRAME_RECT', 'frames must be a record of named rectangles');
  assertRecord(spec.animations, [...path, 'animations'], 'ASSET_EMPTY_CLIP', 'animations must be a record of named clips');
  for (const [name, rect] of Object.entries(spec.frames)) {
    validateFrameRect([...path, 'frames', name], name, rect);
  }
  for (const [name, clip] of Object.entries(spec.animations)) {
    validateClip([...path, 'animations', name], name, clip, spec.frames);
  }
}

/** Validate an image descriptor's source. */
export function validateImageSource(source: unknown, path: readonly string[] = []): void {
  if (typeof source !== 'number' || !Number.isInteger(source) || source < 0) {
    throw new GameAssetError(
      'ASSET_INVALID_SOURCE',
      path,
      'image source must be a static module handle (number)',
    );
  }
}

/** Validate a full asset manifest. */
export function validateManifest(manifest: unknown): void {
  assertRecord(manifest, [], 'ASSET_INVALID_IDENTIFIER', 'manifest must be a record of named groups');
  for (const [group, assets] of Object.entries(manifest)) {
    const groupPath = [group];
    assertValidIdentifier([], group);
    assertRecord(assets, groupPath, 'ASSET_INVALID_IDENTIFIER', `group ${JSON.stringify(group)} must be an object of named assets`);
    for (const [name, descriptor] of Object.entries(assets)) {
      const path = [...groupPath, name];
      assertValidIdentifier(groupPath, name);
      assertRecord(descriptor, path, 'ASSET_INVALID_IDENTIFIER', `asset ${JSON.stringify(name)} must be a descriptor`);
      if (descriptor.kind === 'image') {
        validateImageSource(descriptor.source, [...path, 'source']);
      } else if (descriptor.kind === 'sprite-sheet') {
        validateSpriteSheet(descriptor.source, descriptor, path);
      } else {
        throw new GameAssetError(
          'ASSET_INVALID_IDENTIFIER',
          path,
          `asset ${JSON.stringify(name)} has unknown descriptor kind`,
        );
      }
    }
  }
}
