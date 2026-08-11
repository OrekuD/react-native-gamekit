/**
 * Manifest validation (T7.2).
 *
 * Everything knowable before decoding is validated here with stable error
 * codes and field paths. Rectangles are additionally validated against the
 * decoded image dimensions after load (T7.4).
 */
import { GameAssetError, assertValidIdentifier } from './errors';
import type {
  AssetGroupMap,
  SpriteClip,
  SpriteFrameRect,
  SpriteSheetDescriptor,
} from './types';

/** Validate one frame rectangle. */
export function validateFrameRect(
  path: readonly string[],
  name: string,
  rect: SpriteFrameRect,
): void {
  assertValidIdentifier(path, name);
  const { x, y, width, height } = rect;
  const values = [x, y, width, height] as const;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new GameAssetError(
        'ASSET_INVALID_FRAME_RECT',
        path,
        `frame ${JSON.stringify(name)} coordinates must be finite numbers`,
      );
    }
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
  clip: SpriteClip,
  frames: Readonly<Record<string, SpriteFrameRect>>,
): void {
  assertValidIdentifier(path, name);
  if (typeof clip.frames !== 'object' || clip.frames.length === 0) {
    throw new GameAssetError(
      'ASSET_EMPTY_CLIP',
      path,
      `clip ${JSON.stringify(name)} must reference at least one frame`,
    );
  }
  for (const frame of clip.frames) {
    if (typeof frame !== 'string' || !(frame in frames)) {
      throw new GameAssetError(
        'ASSET_UNKNOWN_FRAME',
        [...path, 'frames'],
        `clip ${JSON.stringify(name)} references unknown frame ${JSON.stringify(frame)}`,
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
  spec: { readonly frames: Readonly<Record<string, SpriteFrameRect>>; readonly animations: Readonly<Record<string, SpriteClip>> },
): void {
  if (typeof source !== 'number' || !Number.isInteger(source) || source < 0) {
    throw new GameAssetError(
      'ASSET_INVALID_SOURCE',
      [],
      'sprite-sheet source must be a static module handle (number)',
    );
  }
  for (const [name, rect] of Object.entries(spec.frames)) {
    validateFrameRect(['frames', name], name, rect);
  }
  for (const [name, clip] of Object.entries(spec.animations)) {
    validateClip(['animations', name], name, clip, spec.frames);
  }
}

/** Validate an image descriptor's source. */
export function validateImageSource(source: unknown): void {
  if (typeof source !== 'number' || !Number.isInteger(source) || source < 0) {
    throw new GameAssetError(
      'ASSET_INVALID_SOURCE',
      [],
      'image source must be a static module handle (number)',
    );
  }
}

/** Validate a full asset manifest. */
export function validateManifest(manifest: AssetGroupMap): void {
  for (const [group, assets] of Object.entries(manifest)) {
    const groupPath = [group];
    assertValidIdentifier([], group);
    if (typeof assets !== 'object' || assets === null) {
      throw new GameAssetError(
        'ASSET_INVALID_IDENTIFIER',
        groupPath,
        `group ${JSON.stringify(group)} must be an object of named assets`,
      );
    }
    for (const [name, descriptor] of Object.entries(assets)) {
      const path = [...groupPath, name];
      assertValidIdentifier(groupPath, name);
      if (descriptor === null || typeof descriptor !== 'object') {
        throw new GameAssetError(
          'ASSET_INVALID_IDENTIFIER',
          path,
          `asset ${JSON.stringify(name)} must be a descriptor`,
        );
      }
      if ((descriptor as { readonly kind?: unknown }).kind === 'image') {
        validateImageSource((descriptor as { readonly source?: unknown }).source);
      } else if ((descriptor as { readonly kind?: unknown }).kind === 'sprite-sheet') {
        const sheet = descriptor as unknown as SpriteSheetDescriptor;
        validateSpriteSheet(sheet.source, sheet);
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
