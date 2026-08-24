/** Tilemap definition/query/movement errors with exact field paths. */
export class TileMapError extends Error {
  override name = 'TileMapError';
  constructor(message: string) {
    super(message);
  }
}

export function tileError(path: string, message: string): TileMapError {
  return new TileMapError(`${path}: ${message}`);
}
