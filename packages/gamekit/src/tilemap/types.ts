import type { Aabb2D, Point2D } from '../geometry/types';

/**
 * Tilemap v1 contract (Task 16).
 *
 * Finite orthogonal maps, y-down world coordinates matching Gamekit
 * geometry. All public values are immutable plain data; mutable author
 * buffers are cloned at definition time and never exposed.
 */

/** Collision behavior contributed by one tile kind. */
export type TileCollisionKind2D = 'solid' | 'one-way-up';

/** One named tile: render frame plus optional collision role. */
export interface TileDef2D {
  /** Frame name inside the bound sprite sheet. */
  readonly frame: string;
  /** Collision role; absent means purely decorative. */
  readonly collision?: TileCollisionKind2D;
}

/**
 * Named tile registry. Numeric tile ids are assigned by declaration order
 * starting at 1; id 0 always means EMPTY.
 */
export interface TileSet2D {
  /** Insertion-ordered tile names; index i corresponds to tile id i+1. */
  readonly names: readonly string[];
  /** Frozen tile defs by name. */
  readonly tiles: Readonly<Record<string, TileDef2D>>;
  /** name -> numeric id (≥1). */
  readonly idOfName: Readonly<Record<string, number>>;
  /** numeric id -> name. */
  readonly nameOfId: Readonly<Record<number, string>>;
  /** collision kind by numeric id (absent = decorative). */
  readonly collisionOfId: Readonly<Record<number, TileCollisionKind2D>>;
}

/** Author input for one layer: row-major tile ids, 0 = empty. */
export interface TileLayerInput2D {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Row-major tile ids; length MUST equal width*height; 0 = empty. */
  readonly data: readonly number[];
  /** Purely decorative layers skip collision queries entirely. */
  readonly collidable?: boolean;
}

/** Normalized immutable layer with owned storage. */
export interface TileLayer2D {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly collidable: boolean;
  /** Owned row-major copy; index = y*width + x; 0 = empty. */
  readonly data: readonly number[];
}

export interface TileMapInput2D {
  /** Finite positive cell size in world units. */
  readonly cellSize: { readonly width: number; readonly height: number };
  readonly tileset: TileSet2D;
  /** Ordered layers; later entries render above earlier ones. */
  readonly layers: TileLayerInput2D[];
  /** World origin of cell (0,0)'s top-left corner. Defaults to {x:0,y:0}. */
  readonly origin?: Point2D;
}

/** Normalized immutable map with precomputed bounds and chunk indexes. */
export interface TileMap2D {
  readonly cellSize: { readonly width: number; readonly height: number };
  readonly origin: Point2D;
  readonly tileset: TileSet2D;
  /** Frozen ordered layer list. */
  readonly layers: readonly TileLayer2D[];
  /** layer id -> layer. */
  readonly layerById: Readonly<Record<string, TileLayer2D>>;
  /** World-space AABB covering every layer's cells. */
  readonly worldBounds: Aabb2D;
  /** Frozen chunk size in cells (both axes). Internal detail. */
  readonly chunkSize: number;
}

/** Immutable query result for one non-empty cell. */
export interface TileCell2D {
  readonly layerId: string;
  readonly tileId: number;
  readonly tileName: string;
  readonly collision: TileCollisionKind2D | undefined;
  /** Cell coordinate (signed safe integers). */
  readonly cell: Point2D;
  /** World AABB of the cell. */
  readonly aabb: Aabb2D;
}

/** Classified contact between a platformer body and one tile. */
export interface PlatformerContact2D {
  readonly cell: TileCell2D;
  /** Contact normal pointing OUT of the tile toward the body. */
  readonly normal: { readonly x: number; readonly y: number };
}

/** Result of one fixed-step platformer movement. */
export interface PlatformerMoveResult2D {
  readonly body: Aabb2D;
  readonly velocity: { readonly x: number; readonly y: number };
  /** Displacement actually applied. */
  readonly displacement: { readonly x: number; readonly y: number };
  /** intended − applied. */
  readonly remainingDisplacement: { readonly x: number; readonly y: number };
  readonly contacts: {
    readonly floor: PlatformerContact2D | undefined;
    readonly ceiling: PlatformerContact2D | undefined;
    readonly leftWall: PlatformerContact2D | undefined;
    readonly rightWall: PlatformerContact2D | undefined;
    readonly all: readonly PlatformerContact2D[];
  };
}
