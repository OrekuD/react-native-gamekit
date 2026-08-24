/**
 * Compile fixture: preferred imports from `rn-gamekit/collision2d`.
 */
import {
  ALL_FILTER2D,
  buildSpatialHash2D,
  canCollide2D,
  circleCollider2D,
  closestPointOnAabb2D,
  collideAabbAabb2D,
  collideCircleAabb2D,
  collideCircleCircle2D,
  collideWorldColliders2D,
  intersectSegmentAabb2D,
  intersectSegmentCircle2D,
  intersectsAabbAabb2D,
  intersectsCircleAabb2D,
  intersectsCircleCircle2D,
  NONE_FILTER2D,
  placeCollider2D,
  pointInAabb2D,
  pointInCircle2D,
  projectHit2D,
  projectSweepPath2D,
  projectVector2D,
  projectWorldCollider2D,
  querySpatialHash2D,
  rectangleCollider2D,
  RESOLUTION_TOLERANCE,
  sweepAabbAabb2D,
  sweepCircleAabb2D,
  worldColliderBounds2D,
  worldColliderCircle2D,
  type BuildSpatialHash2DOptions,
  type CollisionFilter2D,
  type CollisionHit2D,
  type WorldCollider2D,
} from 'rn-gamekit/collision2d';
import type { Aabb2D, Circle2D, Point2D, Segment2D } from 'rn-gamekit/geometry';

const a: Aabb2D = { x: 0, y: 0, width: 10, height: 10 };
const b: Aabb2D = { x: 5, y: 5, width: 10, height: 10 };
const circle: Circle2D = { x: 0, y: 0, radius: 5 };
const seg: Segment2D = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };
const pt: Point2D = { x: 5, y: 5 };

void collideAabbAabb2D(a, b);
void collideCircleAabb2D(circle, a);
void collideCircleCircle2D(circle, { x: 5, y: 5, radius: 5 });
void intersectsAabbAabb2D(a, b);
void intersectsCircleAabb2D(circle, a);
void intersectsCircleCircle2D(circle, { x: 5, y: 5, radius: 5 });
void pointInAabb2D(pt, a);
void pointInCircle2D(pt, circle);
void closestPointOnAabb2D(pt, a);
void intersectSegmentAabb2D(seg, a);
void intersectSegmentCircle2D(seg, circle);
void sweepAabbAabb2D({ aabb: a, displacement: { x: 1, y: 0 }, target: b });
void sweepCircleAabb2D({ circle, displacement: { x: 1, y: 0 }, target: a });
void canCollide2D(ALL_FILTER2D, NONE_FILTER2D);
void buildSpatialHash2D({ items: [{ id: 'a', bounds: a }], cellSize: 16 });
void querySpatialHash2D({} as unknown as import('rn-gamekit/collision2d').SpatialHashIndex2D, a);
void circleCollider2D({ offset: { x: 0, y: 0 }, radius: 5 });
void rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 10, height: 10 });
void placeCollider2D({} as unknown as import('rn-gamekit/collision2d').LocalCollider2D, { x: 0, y: 0 });
void collideWorldColliders2D({} as WorldCollider2D, {} as WorldCollider2D);
void worldColliderBounds2D({} as WorldCollider2D);
void worldColliderCircle2D({} as WorldCollider2D);
void projectHit2D({} as CollisionHit2D);
void projectSweepPath2D({ x: 0, y: 0 }, { x: 10, y: 10 });
void projectVector2D({ x: 0, y: 0 }, { x: 1, y: 0 });
void projectWorldCollider2D({} as WorldCollider2D);

const _tol: number = RESOLUTION_TOLERANCE;
void _tol;

// Type-only
type _Opts = BuildSpatialHash2DOptions;
type _Filter = CollisionFilter2D;
void null as unknown as _Opts;
void null as unknown as _Filter;
