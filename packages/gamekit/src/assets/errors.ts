/**
 * Structured asset errors (T7.2).
 *
 * Every definition/loading failure carries a stable machine-readable code
 * and the field path that caused it. Paths are documented in the public
 * error reference; messages never embed machine-specific paths.
 */

/** Stable error codes for asset definition and loading. */
export type GameAssetErrorCode =
  | 'ASSET_INVALID_IDENTIFIER'
  | 'ASSET_INVALID_SOURCE'
  | 'ASSET_INVALID_FRAME_RECT'
  | 'ASSET_EMPTY_CLIP'
  | 'ASSET_UNKNOWN_FRAME'
  | 'ASSET_INVALID_DURATION'
  | 'ASSET_INVALID_MODE'
  | 'ASSET_UNSUPPORTED_SOURCE';

/** A structured asset definition or loading failure. */
export class GameAssetError extends Error {
  /** Stable machine-readable code. */
  readonly code: GameAssetErrorCode;
  /** Field path within the manifest/descriptor that caused the failure. */
  readonly path: readonly string[];

  constructor(code: GameAssetErrorCode, path: readonly string[], message: string) {
    super(`${code}${path.length > 0 ? ` at ${path.join('.')}` : ''}: ${message}`);
    this.name = 'GameAssetError';
    this.code = code;
    this.path = path;
  }
}

/** Throw when a definition-time identifier is invalid. */
export function assertValidIdentifier(
  path: readonly string[],
  value: string,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GameAssetError(
      'ASSET_INVALID_IDENTIFIER',
      path,
      'identifiers must be non-empty strings',
    );
  }
  // '/' is the diagnostic-id separator (group/key); reserving it keeps
  // diagnostic ids unambiguous.
  if (value.includes('/')) {
    throw new GameAssetError(
      'ASSET_INVALID_IDENTIFIER',
      path,
      `identifier ${JSON.stringify(value)} contains the reserved separator '/'`,
    );
  }
}
