
import type {
  PlatformerContact2D,
  PlatformerMoveResult2D,
  TileCell2D,
  TileMap2D,
} from './types';
import { cellsInAabb, cellsInSweptBounds } from './queries';
import { tileError } from './errors';
import type { Aabb2D, Vector2D } from '../geometry/types';

/** Frozen v1 movement semantics (T16.0). */
export const PLATFORMER_MAX_ITERATIONS = 4;
export const PLATFORMER_SKIN = 1e-6;
/** Previous-bottom must be at or above the platform top by this tolerance. */
export const ONE_WAY_TOLERANCE = 1e-4;

export interface PlatformerMoveOptions2D {
  /** Explicit per-call drop-through intent; the helper owns no timer. */
  readonly dropThroughOneWay?: boolean;
  /**
   * Snap downward onto floor tops within this many world units when the
   * body ends the step falling or resting and no floor contact was resolved.
   * Default 0 (disabled).
   */
  readonly floorSnapDistance?: number;
}

function isSolid(kind: string | undefined): boolean {
  return kind === 'solid';
}

function isOneWay(kind: string | undefined): boolean {
  return kind === 'one-way-up';
}

function overlaps(a: Aabb2D, b: Aabb2D): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
  );
}

/**
 * Pure fixed-step AABB platformer movement (T16.3, T16-F5).
 *
 * Frozen semantics:
 * - Axis order X then Y.
 * - Solid tiles block both axes; one-way tiles block descent only when the
 *   previous bottom was at/above the platform top (ONE_WAY_TOLERANCE) and
 *   `dropThroughOneWay` is not set.
 * - Starting overlap resolves along the least-penetration face preferring UP
 *   on ties (up = negative y in y-down space), up to PLATFORMER_MAX_ITERATIONS;
 *   unresolved spawn overlap throws deterministically. The reported contact is
 *   always the tile that supplied the winning face.
 * - Each axis resolves against the NEAREST blocking plane and reports contacts
 *   ONLY for tiles touching that winning plane — farther crossed rows/columns
 *   are never reported.
 * - Floor snap pulls a falling/resting body down onto tops within
 *   `floorSnapDistance`.
 * - Candidate order is layer order then row-major cell order; equal physical
 *   candidates preserve that deterministic order.
 */
export function movePlatformerBody2D(options: {
  readonly body: Aabb2D;
  readonly velocity: Vector2D;
  readonly deltaSeconds: number;
  readonly map: TileMap2D;
  /** Layer ids that contribute collision; others render only. */
  readonly collisionLayers: readonly string[];
} & PlatformerMoveOptions2D): PlatformerMoveResult2D {
  const { map, deltaSeconds, collisionLayers } = options;
  let body: Aabb2D = options.body;
  let vx = options.velocity.x;
  let vy = options.velocity.y;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw tileError('deltaSeconds', `must be a finite number >= 0; got ${String(deltaSeconds)}`);
  }
  const intendedX = vx * deltaSeconds;
  const intendedY = vy * deltaSeconds;
  const dropThrough = options.dropThroughOneWay ?? false;
  const snapDistance = options.floorSnapDistance ?? 0;

  const contacts: PlatformerContact2D[] = [];
  let appliedX = 0;
  let appliedY = 0;

  // --- Starting-overlap recovery ---
  // Track the winning tile TOGETHER with its face so the reported contact
  // always names the tile that supplied the resolved plane (T16-F5).
  for (let iter = 0; iter < PLATFORMER_MAX_ITERATIONS; iter++) {
    const overlapping = cellsInAabb(map, body, collisionLayers)
      .filter((c) => isSolid(c.collision) && overlaps(body, c.aabb));
    if (overlapping.length === 0) break;
    // Least-penetration FACE wins; ties prefer pushing UP (negative y).
    let bestAxis: 'x' | 'y' = 'y';
    let bestSign = -1;
    let bestDepth = Number.POSITIVE_INFINITY;
    let bestCell: TileCell2D | undefined;
    const consider = (axis: 'x' | 'y', sign: number, depth: number, cell: TileCell2D): void => {
      // Deterministic tie rule: prefer y over x, and prefer negative-y (up)
      // over positive-y. Otherwise first-evaluated (row-major) wins.
      const better =
        depth < bestDepth ||
        (depth === bestDepth &&
          (axis === 'y' ? bestAxis !== 'y' || sign === -1 : false));
      if (better) {
        bestAxis = axis;
        bestSign = sign;
        bestDepth = depth;
        bestCell = cell;
      }
    };
    for (const c of overlapping) {
      const pushLeft = (c.aabb.x - body.width) - body.x;
      const pushRight = (c.aabb.x + c.aabb.width) - body.x;
      const pushUp = c.aabb.y - body.height - body.y;
      const pushDown = (c.aabb.y + c.aabb.height) - body.y;
      consider('x', -1, Math.abs(pushLeft), c);
      consider('x', 1, Math.abs(pushRight), c);
      consider('y', -1, Math.abs(pushUp), c);
      consider('y', 1, Math.abs(pushDown), c);
    }
    if (bestCell === undefined) break;
    // Closure mutation defeats TS narrowing here; assert the union.
    const axis = bestAxis as 'x' | 'y';
    body =
      axis === 'x'
        ? { ...body, x: body.x + bestSign * bestDepth }
        : { ...body, y: body.y + bestSign * bestDepth };
    // Negative-y push lands the body ON a tile top (floor); positive-y hits
    // a ceiling. The contact names the winning tile.
    if (axis === 'y') {
      contacts.push({
        cell: bestCell,
        normal: { x: 0, y: bestSign },
      });
      vy = 0;
    } else {
      contacts.push({
        cell: bestCell,
        normal: { x: bestSign, y: 0 },
      });
      vx = 0;
    }
  }
  // Final check: unresolved spawn overlap is a deterministic error.
  const stillOverlapping = cellsInAabb(map, body, collisionLayers).some(
    (c) => isSolid(c.collision) && overlaps(body, c.aabb),
  );
  if (stillOverlapping) {
    throw tileError('body', 'starting overlap could not be resolved within PLATFORMER_MAX_ITERATIONS');
  }

  const prevBottom = body.y + body.height;
  // --- X axis sweep ---
  {
    const dx = intendedX;
    if (dx !== 0) {
      const newX = body.x + dx;
      let clamped = newX;
      const yOverlap = (aabb: Aabb2D): boolean =>
        body.y < aabb.y + aabb.height && body.y + body.height > aabb.y;
      const solids = cellsInSweptBounds(map, body, { x: dx, y: 0 }, collisionLayers)
        .filter((c) => isSolid(c.collision));
      // Phase 1: resolve against the NEAREST blocking plane only.
      if (dx > 0) {
        let planeX = Number.POSITIVE_INFINITY;
        for (const c of solids) {
          if (!yOverlap(c.aabb)) continue;
          if (body.x + body.width > c.aabb.x + PLATFORMER_SKIN) continue;
          if (c.aabb.x < planeX) planeX = c.aabb.x;
        }
        if (planeX !== Number.POSITIVE_INFINITY) {
          clamped = Math.min(clamped, planeX - body.width);
          // Phase 2: emit contacts ONLY for tiles touching the winning plane.
          for (const c of solids) {
            if (!yOverlap(c.aabb)) continue;
            if (Math.abs(c.aabb.x - planeX) > PLATFORMER_SKIN) continue;
            contacts.push({ cell: c, normal: { x: -1, y: 0 } });
          }
        }
      } else {
        let planeX = Number.NEGATIVE_INFINITY;
        for (const c of solids) {
          if (!yOverlap(c.aabb)) continue;
          if (body.x < c.aabb.x + c.aabb.width - PLATFORMER_SKIN) continue;
          if (c.aabb.x + c.aabb.width > planeX) planeX = c.aabb.x + c.aabb.width;
        }
        if (planeX !== Number.NEGATIVE_INFINITY) {
          clamped = Math.max(clamped, planeX);
          for (const c of solids) {
            if (!yOverlap(c.aabb)) continue;
            if (Math.abs(c.aabb.x + c.aabb.width - planeX) > PLATFORMER_SKIN) continue;
            contacts.push({ cell: c, normal: { x: 1, y: 0 } });
          }
        }
      }
      if (clamped !== newX) vx = 0;
      appliedX = clamped - body.x;
      body = { ...body, x: clamped };
    }
  }
  // --- Y axis sweep ---
  {
    const dy = intendedY;
    if (dy !== 0) {
      const newY = body.y + dy;
      let clamped = newY;
      const prevBottomY = body.y + body.height;
      const prevTop = body.y;
      const xOverlap = (aabb: Aabb2D): boolean =>
        body.x < aabb.x + aabb.width && body.x + body.width > aabb.x;
      const candidates = cellsInSweptBounds(map, body, { x: 0, y: dy }, collisionLayers);
      interface FloorCandidate { cell: TileCell2D }
      const floors: FloorCandidate[] = [];
      const ceilings: TileCell2D[] = [];
      for (const c of candidates) {
        const solid = isSolid(c.collision);
        const oneWay = isOneWay(c.collision);
        if (!solid && !oneWay) continue;
        if (!xOverlap(c.aabb)) continue;
        if (dy > 0) {
          // Descending: floor candidate.
          if (oneWay && (dropThrough || prevBottomY > c.aabb.y + ONE_WAY_TOLERANCE)) continue;
          // Swept crossing: started above/on the top and reached past it.
          if (prevBottomY <= c.aabb.y + PLATFORMER_SKIN && newY + body.height >= c.aabb.y) {
            floors.push({ cell: c });
          }
        } else {
          // Ascending: only solids block ceilings.
          if (!solid) continue;
          if (
            prevTop >= c.aabb.y + c.aabb.height - PLATFORMER_SKIN &&
            newY <= c.aabb.y + c.aabb.height
          ) {
            ceilings.push(c);
          }
        }
      }
      if (dy > 0 && floors.length > 0) {
        // Nearest plane wins; report only tiles touching it.
        let planeY = Number.POSITIVE_INFINITY;
        for (const f of floors) {
          if (f.cell.aabb.y < planeY) planeY = f.cell.aabb.y;
        }
        clamped = Math.min(clamped, planeY - body.height);
        for (const f of floors) {
          if (f.cell.aabb.y !== planeY) continue;
          contacts.push({ cell: f.cell, normal: { x: 0, y: -1 } });
        }
      } else if (dy < 0 && ceilings.length > 0) {
        let planeBottom = Number.NEGATIVE_INFINITY;
        for (const c of ceilings) {
          if (c.aabb.y + c.aabb.height > planeBottom) planeBottom = c.aabb.y + c.aabb.height;
        }
        clamped = Math.max(clamped, planeBottom);
        for (const c of ceilings) {
          if (Math.abs(c.aabb.y + c.aabb.height - planeBottom) > PLATFORMER_SKIN) continue;
          contacts.push({ cell: c, normal: { x: 0, y: 1 } });
        }
      }
      if (clamped !== newY) vy = 0;
      appliedY = clamped - body.y;
      body = { ...body, y: clamped };
    }
  }

  // --- Floor snap ---
  if (!dropThrough) {
    const hasFloor = contacts.some((c) => c.normal.y === -1);
    if (!hasFloor && vy >= 0 && snapDistance > 0) {
      const probeBottom = body.y + body.height + snapDistance;
      const probe: Aabb2D = { x: body.x, y: body.y + body.height, width: body.width, height: snapDistance };
      const near = cellsInAabb(map, probe, collisionLayers);
      let bestTop = Number.POSITIVE_INFINITY;
      let bestCell: TileCell2D | undefined;
      for (const c of near) {
        const top = c.aabb.y;
        if (top < body.y + body.height - PLATFORMER_SKIN) continue;
        if (top > probeBottom) continue;
        const ok = isSolid(c.collision) ||
          (isOneWay(c.collision) && prevBottom <= top + ONE_WAY_TOLERANCE);
        if (!ok) continue;
        if (top < bestTop) {
          bestTop = top;
          bestCell = c;
        }
      }
      if (bestCell !== undefined && bestTop < Number.POSITIVE_INFINITY) {
        const snapDelta = bestTop - body.height - body.y;
        body = { ...body, y: bestTop - body.height };
        contacts.push({ cell: bestCell, normal: { x: 0, y: -1 } });
        vy = 0;
        appliedY += snapDelta;
      }
    }
  }

  const classified = classify(contacts);
  return Object.freeze({
    body: Object.freeze(body),
    velocity: Object.freeze({ x: vx, y: vy }),
    displacement: Object.freeze({ x: appliedX, y: appliedY }),
    remainingDisplacement: Object.freeze({
      x: intendedX - appliedX,
      y: intendedY - appliedY,
    }),
    contacts: Object.freeze({
      floor: classified.floor,
      ceiling: classified.ceiling,
      leftWall: classified.leftWall,
      rightWall: classified.rightWall,
      all: Object.freeze(contacts),
    }),
  });
}

function classify(contacts: PlatformerContact2D[]): {
  floor: PlatformerContact2D | undefined;
  ceiling: PlatformerContact2D | undefined;
  leftWall: PlatformerContact2D | undefined;
  rightWall: PlatformerContact2D | undefined;
} {
  let floor: PlatformerContact2D | undefined;
  let ceiling: PlatformerContact2D | undefined;
  let leftWall: PlatformerContact2D | undefined;
  let rightWall: PlatformerContact2D | undefined;
  for (const c of contacts) {
    if (c.normal.y === -1 && floor === undefined) floor = c;
    else if (c.normal.y === 1 && ceiling === undefined) ceiling = c;
    else if (c.normal.x === 1 && leftWall === undefined) leftWall = c;
    else if (c.normal.x === -1 && rightWall === undefined) rightWall = c;
  }
  return { floor, ceiling, leftWall, rightWall };
}
