/**
 * Compile fixture: preferred imports from `rn-gamekit/geometry`.
 */
import {
  aabbCenter2D,
  addVector2D,
  distancePoint2D,
  expandAabb2D,
  GeometryError,
  lengthVector2D,
  normalizeVector2D,
  scaleVector2D,
  subtractVector2D,
  translateAabb2D,
  unionAabb2D,
  type Aabb2D,
  type Circle2D,
  type Point2D,
  type Segment2D,
  type Vector2D,
  type GeometryErrorCode,
} from 'rn-gamekit/geometry';

const p: Point2D = { x: 1, y: 2 };
const v: Vector2D = { x: 3, y: 4 };
const a: Aabb2D = { x: 0, y: 0, width: 10, height: 10 };
const c: Circle2D = { x: 0, y: 0, radius: 5 };
const s: Segment2D = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };

const _aabb = unionAabb2D(a, a);
const _center = aabbCenter2D(a);
const _expanded = expandAabb2D(a, 2);
const _translated = translateAabb2D(a, v);
const _added = addVector2D(v, v);
const _sub = subtractVector2D(v, v);
const _scaled = scaleVector2D(v, 2);
const _len = lengthVector2D(v);
const _norm = normalizeVector2D(v);
const _dist = distancePoint2D(p, p);

void s;
void c;
void _aabb;
void _center;
void _expanded;
void _translated;
void _added;
void _sub;
void _scaled;
void _len;
void _norm;
void _dist;

const _err: GeometryError = new GeometryError('GEOMETRY_INVALID_NUMBER', 'field', 'bad');
const _code: GeometryErrorCode = 'GEOMETRY_INVALID_NUMBER';
void _err;
void _code;
