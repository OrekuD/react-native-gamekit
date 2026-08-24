
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
 * Pure fixed-step AABB platformer movement (T16.3).
 *
 * Frozen semantics:
 * - Axis order X then Y.
 * - Solid tiles block both axes; one-way tiles block descent only when the
 *   previous bottom was at/above the platform top (ONE_WAY_TOLERANCE) and
 *   `dropThroughOneWay` is not set.
 * - Starting overlap resolves along the least-penetration axis preferring
 *   up, up to PLATFORMER_MAX_ITERATIONS; unresolved spawn overlap throws.
 * - Floor snap pulls a falling/resting body down onto tops within
 *   `floorSnapDistance`.
 * - Contacts are classified per tile with outward normals; candidate order
 *   is layer order then row-major cell order.
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
  for (let iter = 0; iter < PLATFORMER_MAX_ITERATIONS; iter++) {
    const overlapping = cellsInAabb(map, body, collisionLayers)
      .filter((c) => isSolid(c.collision) && overlaps(body, c.aabb));
    if (overlapping.length === 0) break;
    // Least penetration axis; ties prefer pushing UP (+y in y-down space).
    let bestAxis: 'x' | 'y' = 'y';
    let bestSign = 1;
    let bestDepth = Number.POSITIVE_INFINITY;
    for (const c of overlapping) {
      const pushLeft = (c.aabb.x - body.width) - body.x;
      const pushRight = (c.aabb.x + c.aabb.width) - body.x;
      const pushUp = c.aabb.y - body.height - body.y;
      const pushDown = (c.aabb.y + c.aabb.height) - body.y;
      const candidates: [axis: 'x' | 'y', sign: number, depth: number][] = [
        ['x', -1, Math.abs(pushLeft)],
        ['x', 1, Math.abs(pushRight)],
        ['y', -1, Math.abs(pushUp)],
        ['y', 1, Math.abs(pushDown)],
      ];
      for (const [axis, sign, depth] of candidates) {
        if (depth < bestDepth || (depth === bestDepth && axis === 'y' && sign === 1)) {
          bestAxis = axis;
          bestSign = sign;
          bestDepth = depth;
        }
      }
    }
    body =
      bestAxis === 'x'
        ? { ...body, x: body.x + bestSign * bestDepth }
        : { ...body, y: body.y + bestSign * bestDepth };
    // Up-push (-y) lands the body on a floor; down-push (+y) hits a ceiling.
    if (bestAxis === 'y') {
      contacts.push({
        cell: overlapping[0]!,
        normal: { x: 0, y: bestSign === -1 ? -1 : 1 },
      });
      vy = 0;
    } else if (bestAxis === 'x') {
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
      for (const c of solids) {
        if (!yOverlap(c.aabb)) continue;
        if (dx > 0) {
          // Moving right: blocked by the tile's LEFT face when the previous
          // right edge was at/before it.
          if (body.x + body.width <= c.aabb.x + PLATFORMER_SKIN) {
            clamped = Math.min(clamped, c.aabb.x - body.width);
            contacts.push({ cell: c, normal: { x: -1, y: 0 } });
          }
        } else {
          if (body.x >= c.aabb.x + c.aabb.width - PLATFORMER_SKIN) {
            clamped = Math.max(clamped, c.aabb.x + c.aabb.width);
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
      const prevBottom = body.y + body.height;
      const prevTop = body.y;
      const xOverlap = (aabb: Aabb2D): boolean =>
        body.x < aabb.x + aabb.width && body.x + body.width > aabb.x;
      const candidates = cellsInSweptBounds(map, body, { x: 0, y: dy }, collisionLayers);
      for (const c of candidates) {
        console.error('CAND-DETAIL:', JSON.stringify({ bx: body?.x, bw: body?.width, ax: c?.aabb?.x, aw: c?.aabb?.width }));
        const solid = isSolid(c.collision);
        const oneWay = isOneWay(c.collision);
        if (!solid && !oneWay) continue;
        if (!xOverlap(c.aabb)) continue;
        if (dy > 0) {
          // Descending: floor candidate.
          if (oneWay) {
            if (dropThrough) continue;
            // Previous support edge must be at/above the platform top.
            if (prevBottom > c.aabb.y + ONE_WAY_TOLERANCE) continue;
          }
          // Swept crossing: started above/on the top and reached past it.
          if (prevBottom <= c.aabb.y + PLATFORMER_SKIN && newY + body.height >= c.aabb.y) {
            clamped = Math.min(clamped, c.aabb.y - body.height);
            contacts.push({ cell: c, normal: { x: 0, y: -1 } });
          }
        } else {
          // Ascending: only solids block ceilings.
          if (!solid) continue;
          if (prevTop >= c.aabb.y + c.aabb.height - PLATFORMER_SKIN &&
              newY <= c.aabb.y + c.aabb.height) {
            clamped = Math.max(clamped, c.aabb.y + c.aabb.height);
            contacts.push({ cell: c, normal: { x: 0, y: 1 } });
          }
        }
      }
      if (clamped !== newY) vy = 0;
      appliedY = clamped - body.y;
      body = { ...body, y: clamped };
    }
  }

  // --- Floor snap ---
  try {
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

  } catch (e) {
    throw e;
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
