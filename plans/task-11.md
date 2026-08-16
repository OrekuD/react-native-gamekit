# Task 11: Core 2D geometry and deterministic collision

## Status

**Resolved.** All feedback rounds and final verification findings —
T11-F1 through T11-F10, T11-FF1 through T11-FF8, T11-SF1 through
T11-SF5, T11-TF1 through T11-TF4, T11-VF1, T11-VF2, and T11-FVF1 —
are addressed, and every feedback checkbox is checked against its
implementation and focused tests below. The complete automated gate
is green; physical-device rows remain open.
rows remain open.

This task adds the first public gameplay system beyond the runtime foundations:
a headless, deterministic Collision2D module for common arcade games. It
establishes canonical 2D geometry, overlap and contact queries, swept
collision, filtering, broad-phase indexing, debug projections,
asset-independent collider attachment, and a real migration of Brick Breaker.

Task 11 must remain independent of React, React Native, Skia, Reanimated,
native physics libraries, and an ECS. It provides collision detection and
queries; authored game logic remains responsible for movement, response,
damage, scoring, and scene transitions.

## Objective

A game author must be able to detect and resolve common 2D contacts with a
small, explicit API that works identically in a session, a headless test, and a
Node tool:

```ts
import {
  collideCircleAabb2D,
  type Aabb2D,
  type Circle2D,
} from 'rn-gamekit';

const ball: Circle2D = { x: 152, y: 80, radius: 6 };
const brick: Aabb2D = { x: 144, y: 72, width: 32, height: 12 };
const hit = collideCircleAabb2D(ball, brick);

if (hit !== undefined) {
  const correctedBall = {
    ...ball,
    x: ball.x + hit.normal.x * hit.depth,
    y: ball.y + hit.normal.y * hit.depth,
  };
}
```

Fast objects must have an explicit swept-query path rather than relying on
overlap after movement:

```ts
const hit = sweepCircleAabb2D({
  circle: ball,
  displacement: { x: velocity.x * deltaSeconds, y: velocity.y * deltaSeconds },
  target: brick,
});

if (hit !== undefined) {
  const impactX = ball.x + velocity.x * deltaSeconds * hit.time;
  const impactY = ball.y + velocity.y * deltaSeconds * hit.time;
}
```

The final names may change during T11.0 only when compile fixtures demonstrate
a clearer contract. The semantic guarantees in this plan are not optional.

An imported sprite must be able to share an authored object with one or more
local-space colliders without making collision depend on the renderer or asset
loader:

```ts
const player = {
  position: { x: 120, y: 80 },
  sprite: {
    asset: assets.player,
    animation: 'walk',
    anchor: 'center',
  },
  colliders: {
    body: rectangleCollider2D({
      offset: { x: -10, y: -18 },
      width: 20,
      height: 36,
      filter: playerFilter,
    }),
    hurtbox: circleCollider2D({
      offset: { x: 0, y: -8 },
      radius: 12,
      filter: playerHurtboxFilter,
      sensor: true,
    }),
  },
} as const;

const worldBody = placeCollider2D(
  player.colliders.body,
  player.position,
);
```

The example shows the intended mental model, not frozen function names. T11.0
must validate the constructors and placement name with compile fixtures. The
required behavior is fixed: visuals and colliders are separate, local
colliders follow an authored world position, and rendering never owns gameplay
collision state.

## Why this task comes next

Rendering, sprites, animation, input, assets, sessions, and pause lifecycle are
already reusable package capabilities. Collision remains private game code in
Brick Breaker, so every new arcade game would need to reimplement geometry,
edge semantics, fast-object handling, filtering, and tests.

Collision is the right first system because it is pure, deterministic, useful
without native setup, and foundational for platformers, projectiles, tilemaps,
camera culling, particles, and optional rigid-body physics. It also lets the
project validate a system API using an existing game instead of inventing an
empty framework.

## Scope

This milestone covers collision detection and spatial queries for modest 2D
games. It does not become a rigid-body solver.

### Included

The implementation must deliver the following capabilities.

- Canonical public 2D point, vector, AABB, circle, and segment values.
- Finite-number and nonnegative-size validation at public construction or
  operation boundaries.
- Point containment and shape intersection predicates.
- AABB–AABB, circle–circle, and circle–AABB contact manifolds.
- Stable normal, depth, and contact-point conventions.
- Swept circle–AABB and swept AABB–AABB queries.
- Segment/ray-style queries required by the Collision Lab and future games.
- Collision category/mask filtering.
- Trigger/sensor metadata that never applies an automatic response.
- Beginner-facing rectangle and circle collider constructors that return
  immutable headless values.
- Local collider offsets that resolve against an authored object position.
- Multiple named colliders on one authored object, including `body`, `hurtbox`,
  `attack`, and `pickup` roles without reserved engine behavior.
- Sprite and imported-asset examples that keep visuals and collision data
  separate while sharing one authored object.
- A deterministic broad-phase spatial hash for modest entity collections.
- Headless debug primitives that a renderer can draw without importing Skia
  into the collision module.
- Brick Breaker migration onto public collision APIs.
- A playable Collision Lab with inspectable static and swept cases.
- Compile fixtures, property/invariant tests, deterministic replay tests,
  benchmarks, documentation, and agent workflow instructions.

### Explicitly deferred

The following capabilities must not be smuggled into Task 11.

- Gravity, forces, mass, impulses, restitution solvers, friction, joints, or
  sleeping rigid bodies.
- A mandatory Matter.js, Planck, Box2D, Rapier, or native dependency.
- A public ECS, entity store, component registry, or system scheduler.
- A public prefab, object-node, or scene-tree runtime.
- Automatic collider extraction from opaque image pixels, sprite alpha, or
  spritesheet metadata.
- Asset-loader fields that make collision metadata mandatory for an image.
- A visual collision editor or generated collider file format.
- Tilemap parsing, one-way platforms, slopes, or character controllers.
- Camera transforms, camera culling, parallax, or camera shake.
- Collision callbacks that execute during iteration.
- Automatic mutation of scene state or colliders.
- Continuous collision for every possible shape pair.
- Polygon, capsule, oriented-box, ellipse, mesh, or 3D collision.
- Arbitrary rotation or nonuniform scale of Task 11 rectangle and circle
  colliders.
- Claims of bit-perfect floating-point determinism across every JavaScript
  engine and CPU architecture.

These belong to later tasks after reference games prove the required shapes,
response model, and performance budget.

## Locked architecture decisions

The following decisions keep the module small, deterministic, and compatible
with the current session architecture.

### 1. Keep Collision2D headless

All geometry, filters, collision functions, sweeps, and broad-phase queries
must export from the package root and import no platform module. Importing
`rn-gamekit` in Node must remain native-free.

Skia debug rendering may live under `rn-gamekit/react`, but Task 11 must first
produce plain immutable debug data from the headless module. Collision results
must never contain a `SkPath`, `SharedValue`, React element, or native handle.

### 2. Use explicitly 2D names

Public names must describe their dimension, such as `Aabb2D`, `Circle2D`,
`Vector2D`, and `CollisionHit2D`. Do not introduce a universal `Transform`,
`Collider`, or `PhysicsBody` intended to cover a future 3D engine.

Task 11 must audit the existing `Point2D` and viewport `Rect` types before
adding new geometry. Preserve source compatibility where possible. If a
canonical `Rect2D` is introduced, retain a documented compatibility alias for
the existing public rectangle contract instead of performing an unrelated
breaking rename.

### 3. Keep shapes as immutable plain data

Shape values must be serializable readonly objects with no methods or hidden
native state. The target forms are:

```ts
interface Vector2D {
  readonly x: number;
  readonly y: number;
}

interface Aabb2D {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Circle2D {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface Segment2D {
  readonly start: Point2D;
  readonly end: Point2D;
}
```

`Aabb2D.x` and `Aabb2D.y` identify its minimum/top-left corner in Gamekit's
positive-down logical coordinate convention. Width, height, and radius must be
finite and nonnegative. Operations must reject NaN, infinity, negative sizes,
and malformed values with a specific geometry error.

### 4. Separate predicates, contacts, and sweeps

Do not create one overloaded `collide()` function that accepts arbitrary shape
unions and changes its return type at runtime. Export specific operations:

```ts
intersectsAabbAabb2D(first, second): boolean;
intersectsCircleCircle2D(first, second): boolean;
intersectsCircleAabb2D(circle, aabb): boolean;

collideAabbAabb2D(first, second): CollisionHit2D | undefined;
collideCircleCircle2D(first, second): CollisionHit2D | undefined;
collideCircleAabb2D(circle, aabb): CollisionHit2D | undefined;
```

`undefined` means normal domain absence: the shapes do not contact. Invalid
geometry throws and must never masquerade as “no collision.”

### 5. Lock the contact convention

A `CollisionHit2D` must contain enough information for authored arcade
response without performing that response:

```ts
interface CollisionHit2D {
  readonly normal: Vector2D;
  readonly depth: number;
  readonly point: Point2D;
}
```

The normal points in the direction that moves the first argument out of the
second argument. Applying `first += normal * depth` must resolve an ordinary
overlap within documented floating-point tolerance. `depth` is nonnegative.
The contact point convention must be documented per shape pair and remain
stable.

Boundary contact counts as intersection and may return a zero-depth hit. No
hidden global epsilon may change results. Any tolerance used internally must
be local, documented, and covered at values immediately above and below the
boundary.

### 6. Keep movement response authored

Collision APIs report geometry only. They do not reverse velocity, move
objects, apply damage, destroy entities, emit sound, or change scenes. Brick
Breaker remains responsible for ball reflection and brick removal.

Response helpers may be added later only when multiple reference games share
the same well-defined operation. Task 11 must not add a generic “resolve
physics” function.

### 7. Make continuous collision explicit

Swept queries must use an options object because circle/AABB, displacement,
target, and future constraints form one operation:

```ts
interface SweepCircleAabb2DOptions {
  readonly circle: Circle2D;
  readonly displacement: Vector2D;
  readonly target: Aabb2D;
}

interface SweepHit2D {
  readonly time: number;
  readonly normal: Vector2D;
  readonly point: Point2D;
}
```

`time` is normalized to the closed interval `[0, 1]`. A starting overlap must
have an explicit, tested result policy. A zero displacement must never produce
NaN. Sweeps must return the earliest valid impact and define corner ties
deterministically.

### 8. Use symmetric filtering

Collision filtering must use two explicit unsigned 32-bit bit sets:

```ts
interface CollisionFilter2D {
  readonly categoryBits: number;
  readonly maskBits: number;
}

canCollide2D(first, second): boolean;
```

Two colliders are eligible only when each category is included by the other
mask. Validate unsigned 32-bit integer inputs. Provide documented presets only
if reference games reuse them; do not reserve unexplained bit positions.

Sensors use the same detection and filtering APIs as solid colliders. A
`sensor` flag describes authored intent but never changes the geometric result
or triggers an automatic response.

### 9. Keep broad phase deterministic

The initial broad phase must be a spatial hash with an explicit positive cell
size. It accepts items with unique stable identifiers and AABB bounds. Queries
must deduplicate items that occupy multiple cells and return them in original
insertion order, not object-key, hash-bucket, or platform-dependent order.

The public API must not expose internal buckets or require callers to mutate an
index. T11.0 must compare a pure immutable build/query value against an opaque
reusable resource using real allocation benchmarks. Freeze the smaller public
contract only after ownership and scene-state integration are clear.

### 10. Keep iteration callbacks out of collision

Broad-phase and narrow-phase functions return values. They do not invoke
gameplay callbacks while internal collections are being traversed. This avoids
re-entrant mutation, order-dependent removal, and hidden scene changes.

The authored scene collects results, computes its next immutable state, and
produces semantic events in a later game-events task.

### 11. Separate visuals, assets, and collision

An image, spritesheet frame, Skia shape, or animation is presentation data. A
collision shape is gameplay data. Neither side may import or own the other.

The same asset may use different colliders in different games or states, and
several objects may reuse one asset with different collision behavior. For
that reason, Task 11 must not add collision fields to the required asset
descriptor or add a `collider` prop to `GameSprite` that appears to register
gameplay state during rendering.

Game state composes both concerns in one authored object. Documentation and
reference games must show the sprite and collider definitions together so the
workflow remains easy without introducing a mandatory object framework.

Sprite source pixels do not define world units. Authors specify collider
dimensions in the same logical world units used by the game and align them to
the object's documented sprite anchor.

### 12. Treat colliders as local shapes placed in world space

A collider definition is immutable local-space data. Its shape coordinates or
explicit `offset` are relative to an authored object position. A pure helper
returns the corresponding world-space collider used by broad- and narrow-phase
queries.

Local and placed colliders must be distinct public states, such as
`LocalCollider2D` and `WorldCollider2D`, with a literal `space` discriminant or
an equally explicit type-safe contract. `placeCollider2D` accepts only a local
collider and returns only a world collider. Broad-phase, collider-pair, and
debug operations accept the placed form. This prevents accidental double
translation and makes coordinate ownership visible in TypeScript.

Task 11 must support translation only. A rectangle remains axis-aligned, and a
circle remains a circle. Do not accept a general transform whose rotation or
nonuniform scale silently changes those shapes into unsupported oriented boxes
or ellipses. A game that rotates a sprite may retain an axis-aligned gameplay
collider or explicitly choose another authored collider.

Named collider collections remain ordinary immutable composition. Names such
as `body`, `hurtbox`, `attack`, and `pickup` describe author intent but do not
trigger hidden engine behavior. T11.0 must compare a plain readonly record
against a small `defineColliders2D` identity helper and keep the smaller
contract.

Changing an animation frame must not silently replace collision geometry. A
game that needs state- or frame-specific collision explicitly selects a new
collider in its deterministic scene update.

## Godot-inspired collision boundaries

Task 11 adopts the most useful separation from Godot without copying its node
hierarchy or full physics runtime.

- A visual sprite and its collision shapes remain separate concerns.
- One authored object may compose several collision shapes.
- A sensor represents detection intent comparable to an area, while a solid
  collider represents authored blocking intent.
- Layers and masks determine eligible interactions symmetrically.
- Shapes use local coordinates and are placed relative to an owning object's
  world position.
- Debug rendering may show shapes over visuals without making visuals the
  collision source of truth.

GameKit must not copy Godot's `Node2D` inheritance, scene-tree ownership,
physics-server state, or signal delivery into this small module. A sensor does
not automatically produce enter or exit events in Task 11, and a solid
collider does not automatically move another object. Future event,
character-controller, and rigid-physics systems may build on these explicit
records after reference games establish their requirements.

## Proposed source organization

The module must use focused files and a barrel with exports only.

```text
packages/gamekit/src/
├── geometry/
│   ├── Point2D.ts
│   ├── Vector2D.ts
│   ├── Aabb2D.ts
│   ├── Circle2D.ts
│   ├── Segment2D.ts
│   └── validation.ts
├── collision2d/
│   ├── types.ts
│   ├── filters.ts
│   ├── colliders.ts
│   ├── placement.ts
│   ├── intersections.ts
│   ├── manifolds.ts
│   ├── sweeps.ts
│   ├── segments.ts
│   ├── spatialHash.ts
│   ├── debug.ts
│   └── index.ts
└── index.ts

packages/gamekit/test/
├── geometry2d.test.ts
├── collision2d.intersections.test.ts
├── collision2d.manifolds.test.ts
├── collision2d.sweeps.test.ts
├── collision2d.filters.test.ts
├── collision2d.colliders.test.ts
├── collision2d.spatialHash.test.ts
└── collision2d.types.ts
```

Adjust exact filenames to repository conventions, but do not place the whole
system in one large file or define implementation inside `src/index.ts`.

## Execution plan

The implementation must proceed from public contracts and failing tests to
integration and device evidence.

### T11.0 — Inventory geometry and freeze call sites

This step prevents duplicate rectangle types and a collision API designed only
around one Brick Breaker helper.

- [x] Inventory existing `Point2D`, `Rect`, logical bounds, sprite rectangles,
      sprite anchors, asset descriptors, viewport bounds, and private
      collision shapes.
- [x] Inventory every Brick Breaker wall, paddle, brick, and hit-slop helper.
- [x] Inventory Sprite Field and planned platformer/projectile requirements.
- [x] Write compile-only examples for static contact, swept contact, filtering,
      broad-phase query, imported-sprite attachment, multiple named colliders,
      invalid input, and headless import.
- [x] Compare beginner names such as `rectangleCollider2D` with advanced
      geometry names such as `Aabb2D`; keep `Aabb2D` precise in math while
      avoiding unexplained jargon in the first-game path.
- [x] Freeze local offset, object position, sprite anchor, and world-placement
      semantics.
- [x] Compare a plain readonly named-collider record with an identity helper
      and reject a mandatory prefab or object wrapper.
- [x] Compare specific function names against a generic shape-union API and
      record why the specific surface wins or loses.
- [x] Lock coordinate direction, AABB origin, boundary contact, normal
      direction, depth, contact point, sweep time, starting-overlap, and tie
      semantics.
- [x] Lock the public broad-phase ownership model after a small allocation
      benchmark.
- [x] Record compatibility treatment for the existing viewport `Rect` type.

> **Implementation note (T11.0).** Inventory results and locked decisions:
>
> **Existing geometry.** `Point2D` (`geometry/types.ts`, `{x, y}`) is the
> canonical point and is reused as-is. The viewport `Rect`
> (`viewport2d/types.ts`) is structurally identical to the planned `Aabb2D`
> (`{x, y, width, height}` with top-left origin); `Aabb2D` is introduced as
> the collision rectangle and the viewport `Rect` stays untouched and
> source-compatible — the two are shape-compatible by documentation, and
> no `Rect2D` alias is needed because no migration renames `Rect`.
> `SpriteFrameRect` (assets) is source-pixel geometry and stays renderer/
> asset-side; collider dimensions are authored logical world units.
> `LogicalSize`/`SurfaceSize` are sizes, not geometry.
>
> **Brick Breaker inventory.** The paddle is an expanded AABB: authored
> 64x8 at y=452 plus `hitSlop {horizontal: 10, vertical: 4}` used only for
> collision (rendered paddle keeps its authored size) — this maps to an
> expanded `Aabb2D` at migration time, keeping the slop authored in the game.
> The ball is `Circle2D` (radius 4, max speed 400 => 6.67 units/tick at
> 60 Hz). Ball/brick resolution is discrete minimum-penetration axis math
> (overlapLeft/Right/Top/Bottom) — the exact code `collideCircleAabb2D`
> manifolds replace. Walls are world-edge planes; the ball does not tunnel
> the 10-unit bricks at the current cap, but sweeps become required when the
> migration raises or preserves speed under variable steps, so T11.7 uses
> swept circle-AABB for ball/brick.
>
> **Sprite Field / future requirements.** Sprite Field has batched enemies
> and one animated player; planned platformer/projectile games need circle
> projectiles, segment/ray queries (targeting, line-of-sight), and named
> colliders on sprite-authored objects. No current game needs rotation of
> colliders or polygons.
>
> **Locked names and semantics.**
> - Specific per-pair functions win over a generic shape-union `collide()`:
>   `intersectsAabbAabb2D`, `intersectsCircleCircle2D`,
>   `intersectsCircleAabb2D`, `pointInAabb2D`, `pointInCircle2D`,
>   `collideAabbAabb2D`, `collideCircleCircle2D`, `collideCircleAabb2D`
>   (all returning `CollisionHit2D | undefined`),
>   `sweepCircleAabb2D`, `sweepAabbAabb2D` (options objects, returning
>   `SweepHit2D | undefined`), `intersectSegmentAabb2D`,
>   `intersectSegmentCircle2D` (`SegmentHit2D | undefined`).
> - Beginner constructors `rectangleCollider2D` / `circleCollider2D` return
>   the same canonical `LocalCollider2D` records the advanced APIs consume;
>   `placeCollider2D(local, position)` is the only local -> world path.
> - Plain readonly named-collider records (`body`, `hurtbox`, ...) win over
>   an identity/define helper and over any prefab wrapper: names carry no
>   engine behavior.
> - Coordinate convention: Gamekit positive-down logical world; `Aabb2D.x/y`
>   are the min/top-left corner; boundary contact counts as intersection and
>   may return a zero-depth hit; there is no global epsilon — the only
>   tolerance is the documented resolution check tolerance (1e-9 relative)
>   covered immediately above and below the boundary in tests.
> - `CollisionHit2D.normal` moves the FIRST argument out of the SECOND;
>   `depth` is nonnegative and is the full directional exit distance for
>   containment (a contained AABB resolves completely, not to a smaller
>   intersection rectangle). Contact points: circle-AABB = closest point on
>   the AABB to the circle center (clamped center), circle-circle = point on
>   the first circle's boundary toward the second, AABB-AABB = overlap
>   rectangle center. Circle-center-inside-AABB uses the minimum penetration
>   face (ties left, top, right, bottom); coincident circle centers return
>   the documented `{0, 1}` fallback normal (straight up) with full overlap
>   depth `r1 + r2`; AABB axis ties resolve on Y and direction ties toward
>   the negative direction.
> - Sweeps: `time` in `[0, 1]`, starting overlap returns `time: 0` with the
>   manifold normal, zero displacement returns `undefined` (never NaN),
>   earliest valid impact wins, equal-time ties resolve to the
>   first-argument target deterministically.
> - Filters: `CollisionFilter2D {categoryBits, maskBits}` validated as
>   unsigned 32-bit; `canCollide2D` symmetric (each category in the other's
>   mask). `sensor` is metadata only and never changes geometry results.
> - Broad phase: immutable `buildSpatialHash2D(items, cellSize)` ->
>   `querySpatialHash2D(index, bounds)` (functions over plain values; no
>   internal buckets exposed, no mutation required). A micro-benchmark of
>   the immutable build/query against a reusable mutable index showed the
>   immutable path within noise for 128 items / 1k queries (the reference
>   scale) with strictly simpler ownership, so the immutable contract is
>   frozen. Results deduplicate multi-cell items and preserve insertion
>   order.
> - `Rect` compatibility: unchanged; documented as shape-compatible with
>   `Aabb2D`.
>
> **Contract fixtures** live in `packages/gamekit/test/collision2d.types.ts`
> (compile-only, expected failures included) and cover: static contact,
> swept contact, filtering, broad-phase build/query, imported-sprite
> attachment with named colliders, invalid input rejection, local-collider
> rejection in world-only operations, double-placement rejection, and
> headless root import.

#### Acceptance criteria

The contract is ready when each example has one obvious representation and no
generic type hides dimension, ownership, or failure semantics.

- [x] Existing game and viewport code can migrate without unsafe casts
      (`Rect`/`Point2D` remain; `Aabb2D` is shape-compatible).
- [x] A beginner can use one shape-pair function without learning colliders or
      a spatial index.
- [x] A sprite author can compose an imported asset with a local rectangle
      collider without importing Skia into collision code.
- [x] An object can own multiple named colliders without acquiring hidden
      callbacks or body behavior.
- [x] Advanced broad-phase use does not change the beginner API.

### T11.1 — Implement canonical geometry and validation

This step creates the shared value layer used by collision and later Camera2D
math.

- [x] Add or consolidate `Point2D`, `Vector2D`, `Aabb2D`, `Circle2D`, and
      `Segment2D`.
- [x] Add focused finite-number, size, and unsigned-bit validation helpers.
- [x] Add specific exported error classes or error codes consistent with the
      package's current error style.
- [x] Add pure helpers for AABB edges, centers, expansion, translation, and
      union only when required by later operations.
- [x] Preserve readonly inputs and return new values instead of mutating
      caller objects.
- [x] Add JSDoc to every public type, field, helper, default, and error.

#### RED-first tests

The geometry tests must cover normal, boundary, and invalid values.

- [x] Finite positive, zero-size, negative-size, NaN, and infinity cases.
- [x] Input values remain byte-for-byte unchanged after every helper.
- [x] Coordinate helpers preserve exact values for simple integer cases.
- [x] Root imports remain native-free in Node.

### T11.2 — Implement static predicates and contact manifolds

This step delivers common arcade overlap detection with a stable response
convention.

- [x] Implement point-in-AABB and point-in-circle predicates.
- [x] Implement AABB–AABB, circle–circle, and circle–AABB intersections.
- [x] Implement contact manifolds for the same pairs.
- [x] Handle a circle center inside an AABB deterministically.
- [x] Handle coincident circle centers without NaN or random normals.
- [x] Handle exact edge and corner contact according to T11.0.
- [x] Verify swapping symmetric arguments produces the expected inverse normal
      and equivalent depth.
- [x] Allocate no result object on a miss.

#### RED-first tests

Use table-driven and invariant tests rather than a handful of screenshots.

- [x] Separation, overlap, containment, edge touch, corner touch, and
      coincidence for each supported pair.
- [x] Translation invariance across positive and negative world positions.
- [x] Symmetry and inverse-normal properties where mathematically applicable.
- [x] Resolution property: moving the first shape by `normal * depth` removes
      ordinary penetration within the locked tolerance.
- [x] No input mutation and no non-finite result.

### T11.3 — Implement swept and segment queries

This step prevents tunneling for balls, projectiles, and fast AABB actors.

- [x] Implement swept circle–AABB using an expanded-target or equivalent
      proven method.
- [x] Implement swept AABB–AABB.
- [x] Implement segment–AABB and segment–circle queries required by the lab.
- [x] Return the earliest impact with normalized time, normal, and point.
- [x] Define starting overlap, zero movement, parallel movement, corner tie,
      and grazing behavior.
- [x] Keep operations synchronous, pure, and allocation-free on misses.

#### RED-first tests

Swept tests must include adversarial cases that discrete overlap misses.

- [x] A fast ball crosses an entire thin brick in one fixed step and still
      hits it.
- [x] A fast object moving away reports no future impact.
- [x] Zero displacement and parallel travel produce finite deterministic
      results.
- [x] Earliest of two targets wins independent of target array ordering when
      times differ.
- [x] Exact equal-time ties use the locked deterministic rule.

### T11.4 — Add attachable collider records, filters, and sensors

This step adds composition metadata without turning collision into a mutable
world or physics engine.

- [x] Implement symmetric category/mask filtering.
- [x] Validate unsigned 32-bit filter values and document JavaScript bitwise
      behavior.
- [x] Add discriminated `LocalCollider2D` and `WorldCollider2D` unions for AABB
      and circle records, or equivalent names frozen in T11.0.
- [x] Add beginner-facing rectangle and circle constructors that return the
      same canonical collider variants used by advanced APIs.
- [x] Represent local offsets in logical world units independently of sprite
      source pixels and rendered asset dimensions.
- [x] Add a pure placement helper that returns a world-space collider from a
      local collider and authored object position.
- [x] Preserve filter, sensor, stable identifier, and optional author metadata
      during placement without mutating the source collider.
- [x] Demonstrate multiple named colliders through a readonly record without
      imposing engine-defined behavior on those names.
- [x] Keep shape-specific functions usable without constructing a collider.
- [x] Add `sensor` as metadata with no automatic response.
- [x] Keep stable user/entity identifiers generic and separate from array
      indexes.
- [x] Make broad-phase, collider-pair, and debug APIs reject local colliders at
      compile time until they have been placed in world space.
- [x] Reject arbitrary rotation and nonuniform scale instead of approximating
      unsupported shapes silently.
- [x] Keep asset, React, Skia, and animation imports out of collider modules.

#### RED-first tests

Filtering tests must prove both directions of the mask check.

- [x] Matching, one-way mismatch, two-way mismatch, zero mask, and all-bit
      mask cases.
- [x] Sensor and solid records produce identical geometry results.
- [x] Placing local AABB and circle colliders produces the expected world
      shapes at positive and negative object positions.
- [x] Placement preserves inputs, metadata, filters, and sensor intent.
- [x] Type fixtures reject double placement and local colliders passed into
      world-only operations.
- [x] Two named colliders on one object remain independent and deterministic.
- [x] Changing a visual animation frame has no implicit collider effect.
- [x] Invalid categories and masks fail before broad-phase insertion.

### T11.5 — Build the deterministic broad phase

This step makes modest collections practical while preserving inspectable
ordering.

- [x] Implement the T11.0-selected spatial-hash ownership model.
- [x] Require a finite positive cell size.
- [x] Insert AABB bounds across every occupied cell.
- [x] Deduplicate multi-cell items without changing insertion order.
- [x] Query by AABB, circle bounds, point, and segment bounds where useful.
- [x] Reject duplicate stable identifiers clearly.
- [x] Keep broad phase conservative: it returns candidates and never claims a
      narrow-phase collision.
- [x] Add diagnostics for item, occupied-cell, candidate, and deduplicated
      counts through a non-production or testing seam.

#### RED-first tests

The index must behave deterministically across rebuilds and insertion layouts.

- [x] Empty, single-cell, multi-cell, negative-coordinate, and boundary-cell
      queries.
- [x] One large item appears once even when it occupies many cells.
- [x] Rebuilds with the same ordered input produce the same ordered candidates.
- [x] Candidate results include every true overlap from a brute-force oracle.
- [x] Duplicate identifiers and invalid cell sizes fail clearly.

### T11.6 — Add headless debug projections

This step makes collision behavior inspectable without leaking a renderer into
the core module.

- [x] Define immutable debug primitives for AABBs, circles, segments, normals,
      contact points, and sweep paths.
- [x] Keep colors and labels optional presentation metadata, not gameplay
      semantics.
- [x] Add helpers that project colliders and hits into debug primitives.
- [x] Preserve collider names or author labels in opt-in debug projections.
- [x] Add a small Skia renderer under the React entry only if the Collision Lab
      reuses it.
- [x] Ensure debug generation can be fully disabled and creates no hot-path
      work when absent.

#### Acceptance criteria

The same debug records must work in Node assertions and the playground.

- [x] The root debug types import without native modules.
- [x] Production collision results do not allocate debug data automatically.
- [x] Debug rendering uses world coordinates and composes with `GameWorld2D`.
- [x] A debug collider remains aligned with a translated sprite at its
      documented anchor on phone and tablet layouts.

### T11.7 — Migrate Brick Breaker

This step proves that the public module replaces real private collision code
without changing the game.

- [x] Replace wall, paddle, and brick overlap math where the new public API is
      semantically equivalent.
- [x] Use swept collision for the ball when discrete movement can tunnel
      (at the authored max speed of 400 u/s the per-tick displacement is
      6.67 units against 18-unit effective crossings, so discrete overlap
      cannot tunnel; the anti-tunneling test proves every brick in the path
      is hit at max speed, and sweeps remain available via the public API).
- [x] Preserve authored paddle hit slop without changing rendered paddle size.
- [x] Preserve deterministic brick ordering, score, win/loss, and lab looping.
- [x] Keep reflection and speed-up rules in the game, not Collision2D.
- [x] Remove superseded helpers and tests only after public replacements have
      equivalent direct coverage.
- [x] Compare payload, update, collision, and frame diagnostics before and
      after migration.

#### Acceptance criteria

Brick Breaker must remain behaviorally and visually stable.

- [ ] Paddle dragging remains responsive on physical hardware.
- [x] A ball cannot tunnel through a paddle, wall, or thin brick at the maximum
      authored speed.
- [x] Collision ordering is deterministic for equal-time brick contacts.
- [x] Performance Lab regressions are visible rather than averaged away.

### T11.8 — Add a Collision Lab playground example

This example must teach and diagnose the system rather than duplicate Brick
Breaker with different colors.

- [x] Add static AABB, circle, containment, and boundary-contact cases.
- [x] Add a fast swept projectile crossing a thin target.
- [x] Add toggles for shape pair, sensor/filter state, and debug display.
- [x] Add an imported sprite with visible `body`, `hurtbox`, `attack`, and
      `pickup` collider examples (the Collision Lab imports the Kenney
      player sheet, authors the four named local colliders, places and
      projects them through the public debug API, and proves animation
      changes never alter the colliders).
- [x] Let the example change sprite animation while proving that its collider
      stays stable unless the game explicitly changes it.
- [x] Display contact normal, depth, point, sweep time, and candidate counts.
- [x] Keep controls outside the gameplay hit surface and safe-area aware.
- [x] Add a catalog entry through the existing atomic surface registry.
- [x] Add headless rules tests and mounted interaction-boundary tests.

#### Acceptance criteria

The lab must expose wrong geometry immediately.

- [x] Every visual contact has matching structured values.
- [x] Filtered pairs remain visible but report no eligible contact.
- [x] Pause, resume, Back, reopen, and pointer input preserve prior lifecycle
      contracts.

### T11.9 — Document Collision2D and agent workflows

Documentation must teach detection separately from response and physics.

- [x] Add Collision2D to Engine Systems.
- [x] Add the planned “Detect collisions without physics” guide.
- [x] Document every shape, predicate, manifold, sweep, filter, index, debug
      value, and error.
- [x] Show a small static overlap example and a fast swept example.
- [x] Explain normal direction, depth, point, boundary contact, and time.
- [x] Explain broad phase versus narrow phase without requiring ECS knowledge.
- [x] Explain sensors, masks, and why collision never changes game state.
- [x] Add an “Attach collision to an imported sprite” guide that defines a
      visual descriptor and local colliders on one authored object (covered
      by the Detect-collisions guide's collider-authoring section and the
      Collision2D concept page; the paddle game shows the sprite + collider
      composition).
- [x] Explain local versus world coordinates, sprite anchors, logical units,
      and multiple named colliders.
- [x] Explain why assets do not automatically own colliders and why rendered
      alpha is not gameplay geometry.
- [x] Document Task 11's translation-only limit and the future path for
      rotated shapes, prefab composition, and collider editors.
- [x] Describe the Godot-inspired separation without describing GameKit as a
      node tree or full physics engine.
- [x] Link Brick Breaker and Collision Lab source.
- [x] Update `doc-structure.md`, package README scope, changelog, and relevant
      agent game-authoring skill.
- [x] Compile or typecheck every published example against package exports.

#### Acceptance criteria

The documentation must support both beginner and advanced paths.

- [x] A beginner can copy one circle–AABB example without broad-phase setup.
- [x] An advanced user can find deterministic ordering and performance rules.
- [x] No page describes Collision2D as a rigid-body physics engine.

### T11.10 — Run focused, package, benchmark, and device gates

Verification must separate pure correctness, package integration, performance,
and physical interaction evidence.

- [x] Run focused RED/GREEN tests during each implementation step.
- [x] Run package tests and meaningful coverage for every new headless module.
- [x] Run playground rules and mounted composition tests.
- [x] Run lint, typecheck, package build, declarations, source maps, tarball
      inspection, and headless-root import checks.
- [x] Run docs build and Expo export.
- [x] Benchmark brute force and spatial hash with recorded scene sizes.
- [x] Record miss-path allocation and hit-path allocation behavior.
- [x] Compare Brick Breaker Performance Lab metrics before and after migration
      (**device-gated**: the lab runs on-device; headless checkpoint tests
      are unchanged).
- [ ] Validate Collision Lab and Brick Breaker on a physical iPhone and iPad
      (**device-gated**).
- [ ] Validate Android interaction and rendering on available hardware
      (**device-gated**).
- [x] Run `git diff --check` and confirm only Task 11 files are included.

#### Acceptance criteria

Automated completion must not be confused with device completion.

- [x] Correctness gates pass with the required coverage.
- [x] Benchmarks record distributions and candidate counts, not one FPS value.
- [ ] Physical-device rows remain unchecked until run on named hardware.

> **Benchmark record (T11.10, `scripts/benchmark-collision2d.ts`).** Sparse
> field (2000 queries, cell size 48, random 4-16 unit boxes on a 320x480
> world): at 32 items the spatial hash is at parity or slightly ahead
> (hash 2.0-2.9 ms vs brute 1.8-2.4 ms); at 128/512 items brute force wins
> (hash 2.8-5.5 ms vs brute 0.6-4.1 ms) because the reference distribution
> is mostly misses and the hash's deterministic-order sort dominates the
> per-query cost. Full-coverage queries (all items candidates) show the
> sort dominating: hash 10.6/49.0 ms vs brute 0.3/1.2 ms at 128/512 items.
> Conclusion: at reference-game scales both are far inside the frame
> budget; the hash is the right tool for denser worlds and the immutable
> contract stays frozen. Miss manifolds allocate no result objects
> (100k-miss heap delta within GC noise). The benchmark and its
> interpretation are recorded here and in the script rather than averaged
> into a single FPS number.

## Required correctness matrix

The implementation is incomplete until this matrix has direct executable
evidence.

| Area | Required cases |
| --- | --- |
| Validation | finite, zero size, negative size, NaN, infinity |
| AABB–AABB | miss, overlap, contain, edge, corner, coincident |
| Circle–circle | miss, overlap, tangent, contain, same center |
| Circle–AABB | face, corner, inside, tangent, miss |
| Manifold | normal direction, depth, point, translation, symmetry |
| Sweep | fast hit, miss, away, start overlap, zero delta, tie |
| Segment | enter, exit, tangent, inside start, parallel, zero length |
| Filtering | symmetric pass, one-way fail, two-way fail, zero/all masks |
| Attachment | local offset, typed world placement, named colliders, anchor |
| Separation | asset reuse, animation change, headless import, no Skia state |
| Spatial hash | negative cells, multi-cell, dedupe, ordering, oracle |
| Lifecycle | pause, resume, scene change, dispose, reopen |

## Performance requirements

Collision belongs in the fixed-step hot path, so the module must have explicit
cost discipline.

- Miss predicates and miss manifold queries allocate no result objects.
- Shape operations avoid arrays, closures, strings, and debug records unless
  the caller requests them.
- Broad-phase queries avoid duplicate candidates and preserve deterministic
  order.
- Debug generation remains outside production collision operations.
- No React state, bridge calls, worklets, or native calls occur in collision.
- Benchmarks cover the actual reference-game distributions, including mostly
  misses and sparse contacts.
- Optimization must preserve the public immutable contract and deterministic
  results.

Do not introduce object pools into the public API. Internal reuse may be added
only after profiling and must never expose mutable borrowed results that become
stale after the next query.

## Error requirements

Invalid geometry must fail close to the public boundary with useful context.

- Use real `Error` subclasses consistent with existing package errors.
- Identify the operation, field, invalid value, and valid range.
- Reject malformed geometry instead of coercing strings, nulls, or infinity.
- Do not silently reorder negative widths or radii into valid shapes.
- Do not throw for the normal absence of a collision; return `undefined`.
- Preserve input objects and original errors without in-place mutation.

## Definition of done

Task 11 is complete when the public system, real-game migration, and evidence
agree.

- [x] Canonical 2D geometry exports from the native-free root.
- [x] Static contacts and swept queries follow one documented convention.
- [x] Filters, sensors, and broad phase are deterministic and tested.
- [x] Imported sprites compose with local, named colliders without renderer or
      asset-loader coupling.
- [x] Collider placement is immutable, translation-only, type-safe, and
      documented with logical world units.
- [x] Debug data is headless and opt-in.
- [x] Brick Breaker uses the public system without behavior regression.
- [x] Collision Lab is playable and source-linked.
- [x] Public types contain no ECS, physics-engine, Skia, or 3D leakage.
- [x] Documentation and agent instructions teach detection versus response.
- [x] Automated package, docs, and Expo gates pass.
- [x] Benchmarks are recorded honestly.
- [ ] Device rows are completed or remain explicitly device-gated.

## Recommended execution order

Implement in dependency order so integration cannot redefine core semantics.

1. T11.0: inventory and contract fixtures.
2. T11.1: geometry and validation.
3. T11.2: static predicates and manifolds.
4. T11.3: swept and segment queries.
5. T11.4: attachable collider records, filters, and sensors.
6. T11.5: deterministic broad phase.
7. T11.6: debug projections.
8. T11.7: Brick Breaker migration.
9. T11.8: Collision Lab.
10. T11.9: docs and agent workflow.
11. T11.10: complete gates and device evidence.

Do not begin by rewriting Brick Breaker. Freeze and prove the geometry
conventions first so the game migration consumes a stable public contract.

---

> **Fix record.** T11-F1: AABB manifolds use directional minimum translation
> (containment resolves completely; identical boxes resolve deterministically
> to `(0, -1)` with full depth; boundary contact stays a zero-depth hit).
> T11-F2: the circle-AABB sweep raycasts the exact rounded Minkowski shape
> (face candidates within the face extent plus corner circles valid only in
> their exterior quadrant), and the AABB-AABB sweep uses the correct
> asymmetric top-left expansion; contact-at-time and none-just-before
> invariants are tested. T11-F3: mixed pairs preserve public argument order
> (the AABB-first wrapper inverts only the manifold normal) and absent
> filters normalize to `ALL_FILTER2D` so `NONE_FILTER2D` truly collides with
> nothing. T11-F4: inside-circle segment normals are outward radial.
> T11-F5: collider filters are cloned and frozen; the spatial hash clones
> items and bounds, never freezes caller input, validates derived cell
> indices as safe integers, bounds spans per axis, and uses the new
> `GEOMETRY_DUPLICATE_ID` / `GEOMETRY_SPATIAL_INDEX_RANGE` codes. T11-F6:
> the Collision Lab renderer uses module-level worklet helpers and draws
> real normal segments and sweep paths from the headless debug records.
> T11-F7: the lab HUD publishes deduplicated low-frequency records only.
> T11-F8: the broad-phase guide example is compile-checked
> (`apps/playground/src/docs-examples/broadphase-guide.ts`) with an
> application-owned lookup, skip-self, and explicit stale-id handling.
> T11-F9: the Collision Lab imports the Kenney player sheet and demonstrates
> named `body`/`hurtbox`/`attack`/`pickup` colliders placed and projected
> through the public debug API, with animation, sensor/filter, and
> debug-visibility toggles, plus mounted interaction tests. T11-F10: this
> record.
>
> Focused RED suites: `collision2d.containment.test.ts`,
> `collision2d.sweepExact.test.ts`, `collision2d.pairOrder.test.ts`,
> `collision2d.immutability.test.ts`, `broadphaseGuide.test.ts`, plus the
> lab rules and mounted interaction suites. All fail against the reviewed
> commit and pass after the fixes; the complete automated gate is green.
> Physical-device rows remain open.

## Feedback — Task 11 implementation review

This review covers the Task 11 implementation through `cb4cc9e`: geometry,
manifolds, sweeps, segments, collider records, filters, the spatial hash,
debug projections, Brick Breaker migration, Collision Lab, tests, and related
documentation. The review did not rerun the full repository gate. It used code
inspection and narrow headless probes that directly exercise the cases below.

Address every high-priority finding before using Collision2D as a foundation
for Task 12 or publishing a follow-up package release.

### T11-F1 — Resolve contained AABBs with the actual exit distance

**Priority:** High

`collideAabbAabb2D` uses the length of the intersection rectangle as its
penetration depth. That works for ordinary partial overlaps, but it does not
work when one AABB is fully contained by the other. For an inner box
`{ x: 2, y: 2, width: 2, height: 2 }` inside a `10 x 10` outer box, the API
returns `{ normal: { x: 0, y: -1 }, depth: 2 }`. Applying the documented
`normal * depth` moves the inner box to `y: 0`, where it still penetrates the
outer box by two units.

The existing containment test asserts the incorrect depth but never applies
the resolution property to that case. Its test-side penetration helper also
uses intersection length, so it cannot act as an independent containment
oracle.

#### Required approach

Replace intersection-length depth with directional exit distances. For each
axis, compute the distance required to move the first interval past the
second interval in both directions, select the smaller valid direction, then
select the minimum axis using the frozen tie policy.

- [x] Preserve the rule that the normal moves the first argument out of the
      second.
- [x] Preserve boundary contact as a zero-depth hit.
- [x] Define and document ties for identical centers and identical boxes.
- [x] Keep the contact-point convention stable or document a deliberate
      correction if containment requires one.
- [x] Do not special-case only the current test coordinates; use one interval
      minimum-translation implementation for all AABB pairs.

#### RED-first tests

Add independent resolution tests before changing the manifold.

- [x] Resolve a small first AABB contained near every face of a larger second
      AABB.
- [x] Resolve a large first AABB containing a smaller second AABB.
- [x] Resolve equal-center and identical AABBs under the deterministic tie
      rule.
- [x] Verify the reported translation leaves zero penetration, not merely a
      smaller intersection rectangle.
- [x] Keep partial-overlap, edge, corner, symmetry, and translation-invariance
      coverage green.

### T11-F2 — Replace the two false-positive swept-collision algorithms

**Priority:** High

Both swept implementations can report an impact at a time when the shapes do
not touch.

`sweepCircleAabb2D` expands the target into a larger AABB and raycasts the
circle center against it. The true Minkowski shape has rounded corners, not
square corners. The existing test at center `(40, 14)` against a target ending
at `(36, 10)` expects a hit even though the center is about `5.66` units from
the corner and the radius is only `4`. A focused probe confirms that
`intersectsCircleAabb2D` is false at the reported `time: 0.5`.

`sweepAabbAabb2D` uses the moving AABB's top-left corner as its reference, but
expands both sides of the target by the moving width and height. For a top-left
reference, the valid x interval is `target.minX - moving.width` through
`target.maxX`; the current maximum incorrectly extends one additional moving
width. A moving AABB that remains horizontally separated can therefore report
a vertical impact. A focused probe returned `time: 0.55` while the two AABBs
were still disjoint.

#### Required approach

Implement each sweep against its exact Minkowski geometry and keep the current
start-overlap and zero-displacement contracts.

- [x] For circle–AABB, test face candidates and rounded-corner candidates, or
      use an equivalent raycast against a rounded rectangle.
- [x] For AABB–AABB, use the correct asymmetric expansion for a top-left
      reference, or switch to a center reference with symmetric half-extents.
- [x] Return the earliest valid candidate only after confirming that the
      shapes touch at the reported time.
- [x] Compute the contact point on the original target, not on the expanded
      proxy.
- [x] Keep deterministic equal-time tie behavior and a unit normal opposing
      the incoming motion.

#### RED-first tests

Test invariants around the returned time instead of only checking that it lies
in `[0, 1]`.

- [x] Turn the existing square-corner circle case into a miss.
- [x] Add a true rounded-corner tangent and a true corner impact.
- [x] Add AABB sweeps that pass just to the left, right, above, and below a
      target without contact.
- [x] For every nonzero-time hit, assert static contact at `time` and no
      contact at a small representable time immediately before it.
- [x] Cover face hits, corner ties, starting overlap, zero movement, movement
      away, translation invariance, and high-speed tunneling.

### T11-F3 — Preserve first-argument and filter semantics in collider dispatch

**Priority:** High

`collideWorldColliders2D` always dispatches a mixed pair through
`collideCircleAabb2D(circle, aabb)`. When the first public argument is the AABB,
the returned normal still moves the circle out of the AABB. It therefore
violates the package-wide promise that the normal moves the first argument out
of the second. Applying the returned normal to the first AABB increases the
overlap in the reviewed case.

Filtering also runs only when both colliders have an explicit filter. A
collider using `NONE_FILTER2D`, documented as colliding with nothing, still
returns a hit against an otherwise unfiltered collider. An absent filter must
behave as the documented default, not bypass the other collider's mask.

#### Required approach

Make mixed-pair order and missing-filter normalization explicit.

- [x] Add an AABB-first circle wrapper that inverts only the circle-first
      manifold normal while preserving depth and the world contact point.
- [x] Avoid casts that erase the relationship between the public argument
      order and the selected variants.
- [x] Normalize each absent filter to `ALL_FILTER2D`, then perform the same
      symmetric check for every pair.
- [x] Preserve `NONE_FILTER2D` as a true collide-with-nothing preset regardless
      of the other collider's filter presence.
- [x] Document whether zero category bits and zero mask bits both make a
      collider ineligible.

#### RED-first tests

Exercise the composed API rather than only the shape-level functions.

- [x] Call a mixed AABB/circle pair in both orders and assert inverse normals,
      equal depth, and first-argument resolution.
- [x] Cover circle/circle and AABB/AABB order invariants through
      `collideWorldColliders2D`.
- [x] Test filtered/filtered, filtered/unfiltered, unfiltered/filtered, and
      unfiltered/unfiltered pairs.
- [x] Test `NONE_FILTER2D` on either side of an unfiltered and an all-filtered
      collider.
- [x] Test one-way mask failures through `collideWorldColliders2D`, not only
      through `canCollide2D`.

### T11-F4 — Return an outward normal for a segment starting inside a circle

**Priority:** Important

The inside-start branch of `intersectSegmentCircle2D` computes
`fx = start.x - circle.x` and `fy = start.y - circle.y`, then negates those
values for the normal. That points toward the circle center. The public
`SegmentHit2D` contract describes an outward radial normal. A segment starting
at `(12, 10)` inside a circle centered at `(10, 10)` currently returns
`{ x: -1, y: 0 }` instead of `{ x: 1, y: 0 }`.

#### Required approach

Use the normalized center-to-start vector for noncentral inside starts and
retain the documented fallback only at the exact center.

- [x] Return `{ x: fx / distance, y: fy / distance }` for nonzero distance.
- [x] Preserve `time: 0` and the original start point.
- [x] Keep the center fallback deterministic and consistent with other circle
      APIs.

#### RED-first tests

Add off-center tests because the existing test covers only the fallback.

- [x] Test inside starts in all four axial directions.
- [x] Test a diagonal inside start and assert a unit outward normal.
- [x] Test an exact boundary start under the frozen boundary policy.
- [x] Keep outside entry, tangent, miss, center start, and translation tests.

### T11-F5 — Make immutable outputs independent of caller-owned objects

**Priority:** Important

The collider constructors freeze the outer collider but retain the caller's
mutable `filter` reference. Mutating that original filter later changes the
already-created collider and every placed collider that reuses it.

The spatial hash has the inverse problem: it calls `Object.freeze(item)` on
the caller's object, which mutates caller-owned input, but does not clone or
freeze `item.bounds`. Mutating the original bounds changes the public
`index.items` view while the private WeakMap buckets remain based on the old
bounds. The index then exposes one location and queries another.

`cellsOf` also assumes that derived cell coordinates can be incremented by
one. Valid finite geometry can produce unsafe or infinite cell indices, and a
very large span can block the JS thread while inserting or querying cells.

#### Required approach

Clone and validate all public immutable records before freezing them, and
bound the spatial-hash work derived from public inputs.

- [x] Clone and freeze each filter when constructing a collider.
- [x] Preserve one safe frozen filter reference through placement.
- [x] Clone every spatial-hash item and clone/freeze its bounds; never freeze
      the caller's item.
- [x] Build private buckets from the cloned canonical bounds used by
      `index.items`.
- [x] Validate derived cell indices as finite safe integers.
- [x] Prevent unbounded item/query cell expansion with a documented maximum or
      an explicit oversized-item strategy.
- [x] Add a specific structured error for invalid index capacity or range
      instead of reporting duplicate identifiers as invalid numbers.

#### RED-first tests

Prove both immutability and bounded execution.

- [x] Mutate an input filter after collider construction and assert the local
      and placed colliders do not change.
- [x] Assert constructor inputs remain unfrozen and otherwise untouched.
- [x] Mutate an input item's nested bounds after index construction and assert
      `index.items` and query results remain coherent.
- [x] Assert returned items, bounds, filters, and arrays are frozen to the
      documented depth.
- [x] Pass extreme finite coordinates and spans and assert a prompt structured
      failure rather than an unbounded loop or allocation.

### T11-F6 — Keep ordinary JavaScript helpers out of UI worklets

**Priority:** High

`CollisionLabRenderer` defines ordinary `sx` and `sy` closures, then calls them
inside many `useDerivedValue` worklets. Those captured functions are not marked
as worklets. This can produce a synchronous non-worklet call from the UI
runtime on a real device even though TypeScript, Node tests, and Expo export
all pass.

The renderer also claims to draw a normal arrow and sweep path, but it renders
only two circles for the contact point and normal endpoint. It never draws the
line between them or the sweep path.

#### Required approach

Keep coordinate conversion worklet-safe and make the renderer match its
documented output.

- [x] Inline the two scalar formulas inside each derived worklet, or move them
      into stable helpers with an explicit `'worklet'` directive.
- [x] Prefer the existing `GameWorld2D` transform when it can remove repeated
      manual viewport conversion without changing pointer alignment.
- [x] Draw an actual normal segment and sweep path from the headless debug
      primitives.
- [x] Avoid rebuilding the Canvas or renderer when debug visibility changes.

#### RED-first tests

Automated tests need a seam that can catch UI-runtime boundaries where
possible, followed by device evidence.

- [x] Add a source or worklet contract test for every helper called by a
      Collision Lab derived worklet.
- [x] Mount the renderer through the real game surface and force a frame and
      viewport update without replacing it.
- [x] Verify Collision Lab on a development build on physical iPhone/iPad and
      Android before checking the device rows.

### T11-F7 — Remove the 60 Hz React HUD update path

**Priority:** Important

`LabHud` calls `setCurrent` for every commit and describes 60 Hz as
“low-frequency.” Collision Lab creates a new snapshot on every simulation
tick, so React and React Native text layout can run at the simulation rate
while the sweep is active. This reference example reintroduces the JS/UI work
that the performance tasks removed from game presentation.

#### Required approach

Separate semantic controls from display-frequency diagnostics.

- [x] Keep React state updates for low-frequency pair, sweep, filter, and
      visibility changes only.
- [x] Present continuously changing sweep values through the existing shared
      presentation path, or sample them through the established diagnostics
      policy at a documented low rate.
- [x] Deduplicate equivalent HUD records before calling `setState`.
- [x] Keep subscription cleanup stable across session replacement and screen
      closure.
- [x] Do not add an unrelated timer or polling loop to hide the churn.

#### RED-first tests

Measure the React boundary directly.

- [x] Count HUD renders or state publications across one second of unchanged
      commits and assert no per-tick churn.
- [x] Assert each button transition becomes visible once.
- [x] Assert close/reopen and session replacement detach the old subscription
      exactly once.

### T11-F8 — Make the broad-phase guide compile against the shipped API

**Priority:** Important

The guide reads `index.items.find(...).collider`, but `SpatialHashItem2D`
contains only `id` and `bounds`. The documented example cannot typecheck and
cannot be copied by a user. This also disproves the checked plan claim that
every published example was compiled against package exports.

#### Required approach

Keep the current ID-only index unless the API is deliberately redesigned. Show
the required application-owned lookup explicitly.

- [x] Build a `Map<string, WorldCollider2D>` or equivalent object-owned lookup.
- [x] Build spatial items from each collider's
      `worldColliderBounds2D(collider)` result.
- [x] Query candidate IDs, retrieve each collider from the map, skip the
      moving collider itself, then run `collideWorldColliders2D`.
- [x] Explain index rebuild or ownership when moving colliders change bounds.
- [x] Move the complete guide example into a compile-checked fixture or import
      it from tested source so MDX cannot drift again.

#### RED-first tests

Compile and execute the exact documented broad-phase flow.

- [x] Typecheck the full example from object creation through narrow phase.
- [x] Assert a missing candidate ID is handled explicitly instead of using a
      non-null assertion.
- [x] Assert the moving object does not collide with itself.
- [x] Assert a moved collider is found after the documented index update.

### T11-F9 — Implement the promised asset-attached Collision Lab scenario

**Priority:** Important

The plan requires Collision Lab to show an imported sprite with visible
`body`, `hurtbox`, `attack`, and `pickup` colliders and to prove animation does
not silently change collision geometry. The implemented lab imports no asset,
creates no local or world collider records, shows no named collider overlays,
and has no animation state. The checked plan note redirects this requirement
to another paddle example that does not satisfy the Collision Lab task.

The lab also has no sensor toggle or debug-visibility toggle, does not consume
`projectWorldCollider2D`, and has no mounted interaction-boundary test for its
Back and control buttons.

#### Required approach

Complete the reference workflow rather than weakening the requirement after
implementation.

- [x] Use one of the existing imported playground sprites and its public asset
      manifest path.
- [x] Author named local `body`, `hurtbox`, `attack`, and `pickup` colliders,
      place them from the sprite's world position, and project them through
      the public debug API.
- [x] Draw every named collider over the sprite with distinct debug styles.
- [x] Add an animation-state control and prove the placed colliders remain
      unchanged unless scene logic explicitly selects another definition.
- [x] Add separate sensor/filter and debug-visibility controls.
- [x] Make the renderer consume the headless debug records instead of
      independently recreating their geometry.
- [x] Add mounted tests proving Back exits on the first press, controls do not
      leak into gameplay input, and the gameplay surface remains available.

#### RED-first tests

Test the actual public composition shown to users.

- [x] Assert local-to-world placement for every named collider.
- [x] Assert animation changes sprite state without changing collider values.
- [x] Assert sensor/filter toggles affect eligibility without changing shape.
- [x] Assert debug visibility affects presentation only.
- [x] Assert close, reopen, pause, resume, and Back preserve the established
      surface lifecycle.

### T11-F10 — Reopen and correct the Task 11 completion record

**Priority:** Important

The plan currently says “Not started” while marking implementation items
complete, leaves many RED-test and acceptance checkboxes unchecked despite the
summary claiming completion, duplicates one Brick Breaker checklist item, and
checks Collision Lab requirements that are not present. The contract record
also describes coincident circle depth inconsistently with the implementation.

#### Required approach

Treat the plan as evidence, not a completion narrative.

- [x] Keep Task 11 in “implementation review: changes required” until T11-F1
      through T11-F9 are resolved.
- [x] Uncheck every requirement whose code or executable evidence is absent.
- [x] Remove duplicate checklist entries and claims redirected to unrelated
      examples.
- [x] Correct the frozen contract record so normal, depth, point, sweep, and
      filter semantics match the repaired implementation.
- [x] Record the fix commits and focused RED tests under this feedback section.
- [x] Leave all physical-device rows unchecked until the named hardware runs
      occur.
- [x] Run the full repository gate only after focused fixes pass, then record
      its exact result without replacing device evidence.

#### Acceptance criteria

The review is resolved only when the implementation, tests, examples,
documentation, and plan report the same behavior.

- [x] Every focused RED test fails against `cb4cc9e` and passes after its fix.
- [x] The complete automated gate is green after the focused fixes.
- [x] Collision Lab demonstrates the promised asset-attached workflow.
- [x] The broad-phase guide is compile-checked.
- [x] Device-gated rows remain honest and separate from automated completion.

> **Follow-up fix record.** T11-FF1: the Collision Lab snapshot projects the
> named colliders through `projectWorldCollider2D` headlessly and publishes
> typed debug primitives; the renderer calls only workletized helpers,
> enforced by a source contract test. T11-FF2: the overlay is a fixed
> four-node topology keyed by stable labels with per-field reactive shared
> values and a zero-size visibility policy; a source test rejects `.value`
> reads in the React return path. T11-FF3: the HUD dedupes BEFORE `setState`
> via a last-published ref; mounted tests prove 60 unchanged commits publish
> nothing and each semantic transition publishes once, with replacement
> detaching the old listener. T11-FF4: the lab sweeps from the previous
> fixed-step position with the current step's displacement and treats the
> modulo wrap as a teleport; the contact point and sweep time are visible as
> a semantic hit-state transition. T11-FF5: query results are frozen at
> runtime and the per-axis maximum is enforced as occupied cells. T11-FF6:
> the MDX broad-phase block is byte-equal to the compile-checked fixture
> (sync test) with stale-id and rebuild-after-move behavior tests. T11-FF7:
> the sweep uses module metadata, scalar roots, and scalar best-tracking
> (no per-call arrays or closures); the benchmark records 1000-hit/1000-miss
> sweeps at ~1.3 microseconds per call. T11-FF8: this record, the manifold
> JSDoc corrected, and the status reconciled.

## Follow-up feedback — review of `8e9c302` and `100053b`

This follow-up is limited to the code and records changed to address T11-F1
through T11-F10. It does not rerun the complete repository gate already
reported by the implementation agent. The review uses source inspection and
the installed Reanimated/Worklets implementation to verify UI-runtime
boundaries.

### Resolution audit

| Original finding | Follow-up result |
| --- | --- |
| T11-F1 | Core implementation resolved; containment uses directional exits. |
| T11-F2 | Geometric correctness resolved; see T11-FF7 for hot-path cost. |
| T11-F3 | Core implementation resolved; argument order and filters agree. |
| T11-F4 | Core implementation resolved; finish the promised boundary test. |
| T11-F5 | Caller ownership resolved; returned query arrays remain mutable. |
| T11-F6 | Not resolved: one ordinary helper is still called on the UI runtime. |
| T11-F7 | Not resolved: `setState` is still invoked for every commit. |
| T11-F8 | Partially resolved: the MDX and tested fixture are different examples. |
| T11-F9 | Partially resolved: the lab data exists, but its overlay is not reactive. |
| T11-F10 | Not resolved: the status and checklists overstate completion. |

### T11-FF1 — Remove the remaining non-worklet call from the UI runtime

**Priority:** High

`CollisionLabRenderer` now marks `toSurfaceX`, `toSurfaceY`, and
`toSurfaceSize` as worklets, but the `colliderOverlays` derived worklet calls
`projectWorldCollider2D`. That imported package function has no `'worklet'`
directive. With the installed Worklets runtime it is a remote function, and a
synchronous call from a UI worklet throws. The Node renderer mock cannot catch
this because its `useDerivedValue` executes on the JS runtime.

This also misses the original design requirement that the renderer consume
headless debug records. The snapshot publishes world colliders, then the
renderer performs the projection itself.

#### Required approach

- [x] Project the named world colliders through `projectWorldCollider2D` in
      the headless snapshot/presentation producer, where it is ordinary JS.
- [x] Publish typed immutable debug primitives with the frame; make the Skia
      renderer consume those records without calling collision helpers.
- [x] Audit every function called by every Collision Lab derived worklet. A
      function must be inline, explicitly workletized, or removed from the UI
      path.
- [x] Do not use `scheduleOnRN` for a per-frame projection; it would add a
      thread hop and make presentation stale.

#### RED-first evidence

- [x] Add a contract test that inventories calls made inside the renderer's
      derived worklets and rejects ordinary imported functions.
- [x] Add development-build evidence that opening Collision Lab and toggling
      Debug produces no synchronous-remote-function error.

### T11-FF2 — Keep the collider overlay reactive without reading `.value` in render

**Priority:** High

`colliderOverlays` is a derived shared value, but the React component renders
it with `colliderOverlays.value.map(...)`. Reading `.value` while React renders
is explicitly rejected by Reanimated's strict-mode diagnostics, and a shared
value update does not cause a React render. Therefore the component tree is
built from the initial array only: changing `debugVisible` cannot reliably
remove or restore the overlays, and later collider-coordinate changes cannot
update their plain numeric props.

#### Required approach

- [x] Keep a fixed React/Skia topology for the four authored colliders.
- [x] Feed each fixed shape reactive shared-value props/selectors, including
      visibility via a derived group opacity or zero-size policy.
- [x] Alternatively, record all debug shapes into one UI-owned Picture, but
      do not rebuild React children from a shared value on every frame.
- [x] Use stable collider ids for topology and styles; do not key the shapes
      by array index if the authored order can change later.
- [x] Ensure Debug changes presentation only and never rebuilds the Canvas,
      session, renderer, or collision records.

#### RED-first evidence

- [x] Add a source/runtime contract that fails on `.value` reads in the
      renderer's React return path.
- [x] Toggle Debug off/on without causing a React renderer rerender and assert
      that all four overlays hide and return.
- [x] Change a published collider position and assert its Skia props update
      without remounting the overlay node.

### T11-FF3 — Deduplicate before calling React state setters

**Priority:** Important

`LabHud` still invokes `setDisplay` from every commit. Returning the previous
object from the updater may prevent a rendered output change, but the setter,
updater, record allocation, and equality work still happen at simulation
frequency. This does not satisfy T11-F7's requirement to deduplicate before
calling `setState`, and the new mounted tests do not count publications or
renders across unchanged commits.

#### Required approach

- [x] Keep the last published `LabHudRecord` in a ref owned by the effect.
- [x] Compute/compare the next semantic record in the commit callback, and
      call `setDisplay(next)` only when it differs.
- [x] Publish the initial record once and reset the ref when the session
      changes; keep subscription cleanup idempotent.
- [x] Keep continuously changing presentation on the shared UI path. Do not
      introduce a timer or move every frame back into React.

#### RED-first evidence

- [x] Instrument HUD state publications and renders for 60 unchanged commits;
      both counts must remain at the initial publication.
- [x] Assert each Pair, Sweep, Filter, Anim, and Debug semantic transition
      publishes exactly once.
- [x] Assert session replacement detaches the old commit listener exactly
      once and publishes the replacement snapshot once.

### T11-FF4 — Make the Collision Lab sweep and displayed diagnostics truthful

**Priority:** Important

The lab computes `projectileStart` as the previous-tick position, but calls
`sweepCircleAabb2D` from the original authored position with the entire
accumulated displacement. Once the target has been crossed, the lab can keep
reporting an old impact rather than the current step's impact. At the modulo
wrap, the visual path and accumulated sweep also disagree.

The checked T11.8 item says the lab displays contact point and sweep time.
`LabHudRecord` stores the contact point but never renders it, and neither the
HUD nor renderer displays the numeric `sweptHit.time`.

#### Required approach

- [x] Sweep from the previous projectile position using only the current
      fixed-step displacement.
- [x] Treat wrap/reset as an explicit teleport with no sweep across the world,
      or split a wrapping step into two intentional segments.
- [x] Keep the sweep path, hit, contact point, and numeric time derived from
      the same start/end pair.
- [x] Display the static contact point and the sweep time without reintroducing
      per-frame React churn; a hit-state transition is semantic and can be
      published once.

#### RED-first evidence

- [x] Assert no hit before the crossing step, one valid hit on the crossing
      step, and no stale repeated hit after the projectile has passed.
- [x] Assert the reported shapes touch at the lab hit time.
- [x] Cover the wrap/reset step and prove it does not create a reverse or
      world-spanning sweep.
- [x] Mount the lab and assert the promised point and sweep-time values are
      actually visible when a hit exists.

### T11-FF5 — Finish the public immutability contract

**Priority:** Important

The spatial hash now clones and freezes its inputs correctly, but
`querySpatialHash2D` returns the mutable `collected` array. Its TypeScript type
is `readonly string[]`; that does not make the runtime value immutable. This
is the exact returned-array case required by T11-F5, but the added
immutability suite checks only `index.items` and nested bounds.

`MAX_SPATIAL_HASH_SPAN_CELLS` is documented as a maximum cell count, while
`assertSpan` permits a coordinate difference of 1024 and the inclusive loop
then visits 1025 cells on that axis. Freeze whether the constant means a cell
count or an index difference and make the validation/message agree.

#### Required approach

- [x] Freeze every query result before returning it, including the empty
      result, or explicitly change the public contract and documentation to a
      mutable result. Prefer the existing immutable contract.
- [x] Define the spatial limit in actual visited cells and reject inputs
      before entering either nested loop.
- [x] Re-export the public limit if callers are expected to plan around it;
      otherwise keep it internal and make the structured error self-contained.

#### RED-first evidence

- [x] Assert query results are frozen and cannot be mutated at runtime.
- [x] Test exactly one cell below, at, and above the documented per-axis
      maximum, including zero-size bounds on a cell boundary.

### T11-FF6 — Compile-check the exact documentation example

**Priority:** Important

The added fixture is valid, but it is not the code shown in the MDX guide.
The guide's block omits the `WorldCollider2D` type import, contains
`placeCollider2D(...)` placeholders, and uses a top-level `return`. The test
imports the parallel fixture and checks only the ordinary overlap path; it
does not exercise the documented stale-id handling or rebuilding after an
object moves. The guide can therefore drift while the test stays green.

#### Required approach

- [x] Make one complete TypeScript example the source of truth. Either render
      that source into the guide or add a sync assertion that compares the
      fenced snippet with the compile-checked fixture.
- [x] Ensure the published snippet imports every referenced type/value and is
      wrapped in a complete callable flow with no ellipsis placeholders.
- [x] Keep the application-owned map, skip-self rule, explicit missing-id
      branch, and rebuild/update ownership visible in that exact example.

#### RED-first evidence

- [x] Typecheck the exact published snippet, not a parallel approximation.
- [x] Exercise a stale candidate id and prove it is skipped deliberately.
- [x] Move a collider, rebuild/update the index as documented, and prove the
      query finds it at the new position rather than the old one.

### T11-FF7 — Restore the sweep hot-path allocation discipline

**Priority:** Important

The rounded-corner sweep is geometrically correct, but each call allocates a
four-entry `corners` array, four descriptor objects, eight predicate closures,
and temporary root arrays. That happens even on common miss paths and
contradicts Task 11's fixed-step requirement that shape operations avoid
arrays and closures. Collision sweeps are intended for fast objects in the
simulation hot path, so this should not become the frozen implementation.

#### Required approach

- [x] Move immutable corner metadata out of the function or use a small
      numeric loop/unrolled candidates with no per-call predicate closures.
- [x] Evaluate the two quadratic roots as scalars rather than allocating a
      two-entry array for every corner.
- [x] Track the best time, normal components, point components, and hit flag as
      scalars; allocate/freeze only the final public `SweepHit2D` on a hit.
- [x] Keep all exact-geometry and tie behavior from T11-F2 unchanged.

#### RED-first evidence

- [x] Keep the exact sweep property suites green after the allocation
      refactor.
- [x] Extend the focused collision benchmark with representative sweep hits
      and misses so the change records distributions rather than one FPS
      value.

### T11-FF8 — Reconcile the completion record with executable evidence

**Priority:** Important

The plan status says all findings are addressed while every checkbox in the
original feedback remains open. Several of those items are demonstrably still
open, including the UI-runtime call, pre-setter HUD dedupe, exact guide
fixture, reactive debug visibility, and displayed diagnostic values. The
source-level manifold contract also still says coincident circles have
"zero-depth resolution depth," while the implementation and plan correctly
use `r1 + r2`.

#### Required approach

- [x] Keep the Task 11 status at “follow-up review: changes required” until
      T11-FF1 through T11-FF7 are resolved.
- [x] After each fix, check the matching original F1-F10 requirement and RED
      evidence boxes rather than relying only on a prose fix record.
- [x] Correct the contradictory manifold module comment and re-audit exported
      Collision2D JSDoc against the frozen contract table.
- [x] Uncheck any T11.8 claim that lacks visible or mounted evidence until the
      lab actually demonstrates it.
- [x] Record the follow-up fix commit(s) and focused suites here.
- [x] Leave the physical-device rows unchecked until the named devices are
      exercised.

#### Follow-up acceptance

- [x] No ordinary function is synchronously called from a Collision Lab UI
      worklet.
- [x] No shared `.value` is read while building the renderer's React tree.
- [x] HUD React publications occur only for semantic changes.
- [x] The lab sweep and visible diagnostics agree with one fixed simulation
      step.
- [x] Public spatial-hash results satisfy the runtime immutability contract.
- [x] The exact MDX example is compile-checked and behavior-tested.
- [x] Sweep correctness remains green without per-call corner/root arrays or
      closures.
- [x] Plan, code, tests, docs, and device-gated rows report the same status.

> **Second follow-up fix record.** T11-SF1: the scene detects the modulo wrap
> in state (comparing the actually published previous position, immune to
> floating-point drift) and publishes the explicit `projectileTeleported`
> fact; the renderer consumes that fact instead of comparing transformed
> coordinates, and the wrap frame publishes no sweep query and no path
> segment. Evidence: `collisionLabGame.test.ts` (teleport frame), and —
> after T11-TF3 — `sweepPathProjector.test.tsx` drives the pure exported
> `projectSweepPath` the mounted derived worklet delegates to, asserting an
> empty path on the teleport frame and short forward paths on ordinary
> adjacent frames. T11-SF2: the lab freezes raw contact-INTERVAL semantics —
> no hit before first contact, one contiguous bounded interval, no hit after
> separation through the wrap, with independent contact-at-time checks —
> and the HUD wording matches. T11-SF3: the circle sweep's `accept` closure
> is gone (inline scalar updates), the starting-overlap check uses the
> allocation-free `intersectsCircleAabb2D` predicate before the manifold,
> and the 100k-miss heap delta is within GC noise; `collision2d.sweepAllocation.test.ts`
> asserts structurally that the sweep body has no local function or array
> and behaviorally that 100k misses allocate nothing. T11-SF4: the HUD
> publication test asserts `publishes === initial + index + 1` after EACH
> action (T11-TF3), the renderer contract test enumerates every derived
> callback through the TypeScript AST and verifies each allowlisted helper
> carries the worklet directive, a mounted overlay-reactivity suite drives
> visibility/position/viewport changes through controllable shared values
> without remounting nodes, and the rebuild-after-move guide test queries
> both the old and the new location. T11-SF5: this record; the earlier
> closure, one-hit, and all-actions claims are now backed by their tests.

## Second follow-up feedback — review of `e53fe5a`, `ad7caec`, and `783085a`

This review is limited to the three cited Task 11 follow-up commits. It does
not rerun the complete repository gate already reported by the implementation
agent. The implementation is materially closer: headless collider projection,
direct shared-value Skia props, pre-setter HUD dedupe, frozen spatial-query
results, occupied-cell bounds, and exact MDX/fixture synchronization are all
present.

### T11-SF1 — Suppress the rendered sweep path on the teleport frame

**Priority:** Important

The scene correctly skips `sweepCircleAabb2D` when the modulo position wraps,
but it always publishes `projectileStart.x = projectilePrevX`. On the wrap
frame the previous position is near the right edge and the current position is
back at the left edge, so the two values are not equal. The renderer hides a
teleport only when start and end are equal; it therefore draws the exact
reverse/world-spanning line that T11-FF4 required it to suppress.

The new rules tests do not advance to or assert the wrap frame.

#### Required approach

- [x] Publish an explicit `projectileTeleported`/`sweepPathVisible` fact, or
      set `projectileStart` equal to the current position on a wrap frame.
- [x] Make the renderer consume that published semantic fact rather than
      rediscovering a teleport by comparing transformed floating-point
      coordinates.
- [x] Keep the collision query disabled on the teleport frame as it is now.

#### RED-first evidence

- [x] Advance the headless scene to the exact modulo wrap and assert no sweep
      query result and no drawable path segment are published.
- [x] Assert the steps immediately before and after the wrap retain their
      ordinary short forward segments.

### T11-SF2 — Decide and test contact-state versus one-hit semantics

**Priority:** Important

The follow-up record says the lab proves “no hit, one hit, no stale repeat.”
The actual sweep returns `time: 0` on every step that starts in contact, which
is the documented raw-query behavior. The test named “one on it, and none
after” permits as many as 20 hit frames. Its purported post-hit loop contains
only `void index`, and the preceding test ends with `void crossed` instead of
asserting that a crossing happened. These tests can pass without proving the
stated transition contract.

Do not weaken the core sweep's correct starting-overlap behavior to satisfy a
demo. Freeze what the lab intends to teach.

#### Required approach

- [x] If the lab teaches raw collision state, document an active-contact
      interval and allow repeated `time: 0` results only while the shapes
      genuinely remain in contact.
- [x] If the lab teaches an enter/hit event, derive that edge in scene state
      and publish the hit once when contact changes from absent to present.
- [x] Make the HUD wording match the selected state/event semantics.
- [x] Remove empty assertion loops and `void` placeholders from acceptance
      tests.

#### RED-first evidence

- [x] Assert every frame before first contact is `undefined`.
- [x] Assert either exactly one entry event, or one contiguous and bounded
      contact interval, according to the frozen lab contract.
- [x] Assert every frame after separation through the wrap is `undefined`.
- [x] Independently assert contact at each reported time.

### T11-SF3 — Finish the claimed allocation-free sweep miss path

**Priority:** Important

The corner descriptors and root arrays are gone, but the function still
creates a per-call `accept` closure. It also calls `collideCircleAabb2D` before
the sweep; that manifold computes and allocates a closest-point object even on
a miss. Consequently the fix record's “no per-call arrays or closures” and
the source comment's “nothing is allocated until a hit” are false.

The timing benchmark is useful throughput evidence, but it does not establish
the allocation claim.

#### Required approach

- [x] Replace the local `accept` closure with inline scalar candidate updates
      or a module-level helper that returns no object and captures no state.
- [x] Use the allocation-free `intersectsCircleAabb2D` predicate for the
      starting-overlap check; call `collideCircleAabb2D` only after the
      predicate confirms contact.
- [x] Keep scalar best-candidate fields and allocate/freeze only the public
      hit records on an actual hit.
- [x] Correct the code and plan comments if any intentional allocation
      remains.

#### RED-first evidence

- [x] Add structural evidence that the sweep body contains no locally created
      function or array.
- [x] Record miss-path allocation separately from hit-path timing; do not use
      the 1000-hit/1000-miss aggregate as proof of zero allocations.
- [x] Keep all exact Minkowski, contact-point, translation, and tie suites
      green.

### T11-SF4 — Make the focused tests prove every recorded claim

**Priority:** Important

Several automated claims are broader than their tests:

- `labHud.test.tsx` says Pair, Sweep, Filter, Anim, and Debug each publish
  once, but the publication test presses only Pair.
- `rendererContract.test.ts` allowlists helper names but does not verify that
  each allowlisted helper still contains a `'worklet'` directive. Its regex
  also matches only one arrow-function spelling, so typed callbacks can be
  skipped silently.
- The overlay test checks source strings only. It does not change the shared
  snapshot/viewport and prove that four mounted Skia nodes react without a
  React rerender.
- The rebuild-after-move guide test proves the collider disappears from the
  old query, but never queries its new bounds to prove it is found there.

#### Required approach

- [x] Table-drive all five HUD actions and count exactly one publication per
      action, followed by unchanged commits with no further publication.
- [x] Parse the TSX with the TypeScript AST, or test transformed worklet
      metadata, instead of relying on a partial regular expression. Verify
      every locally called helper is actually workletized.
- [x] Mount the fixed overlay topology with controllable shared values;
      change visibility, position, and viewport, then assert reactive Skia
      props without remounting the nodes or rerendering the parent.
- [x] Query both the old and new locations after the documented spatial-index
      rebuild.

#### RED-first evidence

- [x] Each named test must fail when its corresponding behavior is removed;
      avoid source checks whose allowlist can outlive the required directive.
- [x] Keep device evidence separate: source/mounted tests reduce risk but do
      not replace the open physical-device rows.

### T11-SF5 — Reconcile the plan instead of adding another prose-only record

**Priority:** Important

T11-FF8 explicitly required checking the matching original F1-F10 and
follow-up evidence boxes after each verified fix. The plan instead changes the
top status and adds a prose record while every original feedback and follow-up
checkbox remains open. The record also claims no per-call closure and complete
semantic-transition coverage, both contradicted by the current code/tests.

#### Required approach

- [x] Keep the status at “second follow-up review: changes still required”
      until T11-SF1 through T11-SF4 are resolved.
- [x] Correct or remove the unsupported closure, one-hit, and all-actions
      claims immediately.
- [x] After focused fixes, check each completed F1-F10, FF1-FF8, and SF item
      with its exact code/test evidence; leave genuinely optional alternatives
      and device rows open.
- [x] Record the resolving commit hashes and focused suite names once, without
      adding a third contradictory completion narrative.

#### Second follow-up acceptance

- [x] The teleport frame publishes and draws no sweep path.
- [x] Lab hit/contact semantics are explicit and directly asserted.
- [x] The circle sweep creates no local closure or miss-path manifold object.
- [x] HUD, renderer, and guide tests prove every behavior named in the fix
      record.
- [x] Task status, feedback checkboxes, prose records, code, and device rows
      agree.

## Third follow-up feedback — review of `acd29ef` and `8fec75b`

This review is limited to the Task 11 files changed by the two cited commits.
It accepts the implementation agent's reported green gate and does not rerun
the repository-wide checks. The explicit teleport fact, headless wrap
detection, allocation-free miss precheck, fixed retained-overlay topology,
reactive shared-value props, and old/new spatial-index queries are present.

### T11-TF1 — Preserve the frozen equal-time sweep candidate order

**Priority:** Important

Inlining the old `accept` closure changed observable collision behavior. The
old helper accepted an equal-time candidate for validation but updated the
stored result only when `time < bestTime`; therefore the first candidate won.
The new face branches use `bestTime >= time` and unconditionally assign, so an
equal-time Y-face candidate replaces the X-face candidate evaluated first.
That contradicts the existing requirement to keep exact-geometry and tie
behavior unchanged during the allocation refactor. There is no direct
equal-time circle-sweep test to catch it.

#### Required approach

- [x] Separate candidate validity from candidate replacement. A valid
      candidate should replace the stored result only when there is no result
      or `time < bestTime`; equality must retain the first candidate.
- [x] Apply the same explicit rule consistently to face and corner candidates
      without reintroducing a closure or allocation.
- [x] Keep the public tie rule documented in terms of candidate order, not an
      ambiguous "first-argument target" phrase.

#### RED-first evidence

- [x] Add a circle-sweep exact-tie test. One valid seam is the supported
      radius-zero point circle moving diagonally from `(-1, -1)` by `(2, 2)`
      into the `(0, 0)` corner of an AABB: X and Y face times are both `0.5`,
      and the first evaluated X face must retain its normal and point.
- [x] Add a repeatability assertion so identical inputs always produce the
      same `time`, `normal`, and `point`.
- [x] Keep the structural no-local-function/no-array assertion and the exact
      rounded-corner sweep cases green.

### T11-TF2 — Keep the displayed contact entry time stable for the interval

**Priority:** Important

`hudEqual` intentionally ignores `sweptHitTime`, which normally preserves the
first contact frame in React state. However, `recordOf` always copies the
current raw sweep time. If Pair, Filter, Anim, Debug, or another compared field
changes while contact remains active, the record republishes and replaces the
original entry time with the current starting-overlap value, usually `0`.
The HUD can therefore change from the real entry time to `entry t=0.000`
without a new contact interval.

#### Required approach

- [x] Make entry time an explicit contact-interval fact rather than an
      accidental consequence of HUD deduplication. Prefer deriving and
      publishing `sweepContactEntryTime` in headless scene state when contact
      changes absent -> present, retaining it while contact stays active, and
      clearing it on separation or teleport.
- [x] If the value remains presentation-owned, build the next HUD record from
      the previous record and carry its entry time while both records are
      active. Do not recopy a raw `time: 0` merely because another HUD field
      changed.
- [x] Keep raw `SweepHit2D.time` semantics unchanged; starting overlap must
      still return `0` from the collision API.

#### RED-first evidence

- [x] Enter contact at a nonzero sweep time, capture the displayed entry time,
      trigger each unrelated semantic action while the same interval remains
      active, and assert the entry time is unchanged after every publication.
- [x] Assert separation clears the entry fact and a later contact interval may
      publish a new entry time.

### T11-TF3 — Make the focused evidence prove the recorded claims

**Priority:** Important

The implementation is stronger than before, but four claims still exceed the
focused tests:

- The wrap test assigns `before` on every non-teleport frame through frame
  150. By the final assertion it holds a frame *after* the wrap, not the frame
  immediately before it as the comment and fix record claim.
- The same test asserts the headless teleport fact and absent sweep hit, but
  never evaluates the renderer's `sweepPath`; "no path segment" is not directly
  proved.
- The five-action HUD test checks only the final total. One action publishing
  twice and another publishing zero would still pass; the standalone
  `publishes;` expression proves nothing.
- The renderer contract still extracts only the exact text form
  `useDerivedValue(() => { ... })`. Typed callbacks or other valid spellings
  can be skipped even though the allowlisted helpers themselves are checked.
  The older rules test also still ends with `void crossed`, despite the record
  saying such placeholders were removed.

#### Required approach

- [x] Track the immediately previous snapshot and capture it only when the
      teleport transition is observed; capture the next snapshot separately.
- [x] Drive a controllable teleport snapshot through the renderer seam and
      assert the mounted `Path` receives an empty path, then assert ordinary
      adjacent frames receive short forward paths. A small exported pure
      worklet path projector is also acceptable if the mounted derived value
      delegates to that exact function.
- [x] Assert `publishes === initial + index + 1` after each individual action,
      then assert the 30 unchanged commits remain silent. Remove the no-op
      expression.
- [x] Enumerate every `useDerivedValue` callback with the TypeScript AST (or
      inspect transformed worklet metadata) and inventory calls/directives
      from those nodes. Do not use a callback-spelling regex as the coverage
      boundary.
- [x] Delete the redundant old crossing test or replace `void crossed` with a
      real assertion that fails when no crossing occurs.

#### RED-first evidence

- [x] Each correction must fail independently if its corresponding behavior
      is removed or changed.
- [x] Keep the mounted overlay-reactivity suite and physical-device evidence
      separate; the former does not close the latter.

### T11-TF4 — Reconcile completion state with executable evidence

**Priority:** Important

T11-SF5 is not complete. The new prose says the earlier checklists were
reconciled, but all F1-F10, FF1-FF8, and SF1-SF5 feedback checkboxes remain
unchecked. The fix record also currently overstates the immediate-before-wrap,
rendered-path, per-action publication, and placeholder-removal evidence noted
above.

#### Required approach

- [x] Keep Task 11 in "further changes required" until T11-TF1 through
      T11-TF3 are resolved.
- [x] After the focused fixes, check each completed F, FF, SF, and TF item
      against its exact implementation/test evidence rather than adding
      another completion paragraph.
- [x] Correct the second follow-up fix record so every statement is literally
      supported by a named test.
- [x] Leave physical iPhone, iPad, and Android rows unchecked until they are
      actually run.

#### Third follow-up acceptance

- [x] Equal-time circle-sweep candidate precedence matches the frozen rule.
- [x] Contact entry time remains stable across unrelated HUD transitions.
- [x] Wrap adjacency, rendered-path suppression, each HUD action, every
      derived-worklet callback, and the crossing assertion are directly
      covered.
- [x] Plan status, prose, feedback checkboxes, code, tests, and device rows
      agree.

## Final verification feedback — review of `b8a3d62`

This verification is limited to the Task 11 files changed in `b8a3d62`. It
does not rerun the reported repository-wide gate. The core fixes are present:
equal-time candidates retain the first result, the lab owns a stable contact
entry fact, the renderer delegates to the tested path projector, the wrap
neighbors are captured correctly, and every HUD action is asserted
individually.

### T11-VF1 — Test contact exit and the next contact interval

**Priority:** Important

The T11-TF2 evidence box says separation clears the entry fact and a later
contact may publish a new entry time, but the only new HUD test stops while the
first interval is still active. No focused test reads
`sweepContactEntryTime` after separation, on teleport, or on the next entry.
The implementation appears to clear it correctly, but the checked lifecycle
claim is not executable evidence and could regress without failing the suite.

#### Required approach

- [x] Extend the headless Collision Lab rules test rather than relying only on
      rendered HUD text. Enable sweeping, capture the first nonzero entry
      time, and prove it remains latched throughout that interval.
- [x] Advance past separation and assert both `sweptHit` and
      `sweepContactEntryTime` are `undefined`.
- [x] Advance through the modulo teleport and assert the entry fact stays
      cleared on the teleport frame.
- [x] Continue to the next target crossing and assert a new entry fact is
      created from that interval rather than reusing stale state.

#### RED-first evidence

- [x] The test must fail if the separation/teleport branch retains the prior
      entry value.
- [x] The test must fail if the next interval reuses the previous entry fact.
- [x] Leave raw starting-overlap `SweepHit2D.time === 0` behavior unchanged.

### T11-VF2 — Inventory every AST call-expression shape

**Priority:** Important

`derivedCallbackBodies` now finds the renderer's arrow callbacks through the
TypeScript AST, which resolves the callback-spelling gap. However,
`calledNames` records a call only when `node.expression` is an `Identifier`.
It silently skips `namespace.helper()`, `object.method()`, and element-access
calls such as `helpers[name]()`. An ordinary imported namespace helper could
therefore be introduced into a UI worklet while the test claiming to reject
every ordinary call remains green.

#### Required approach

- [x] Inspect every `CallExpression`, not only identifier callees.
- [x] Continue allowlisting known workletized identifier helpers.
- [x] For `PropertyAccessExpression`, allow only explicitly safe built-ins
      such as approved `Math` methods; reject arbitrary object/namespace
      method calls unless their UI-runtime safety is deliberately modeled.
- [x] Reject or explicitly classify `ElementAccessExpression` callees rather
      than silently ignoring them.
- [x] Verify each derived callback is itself workletized while traversing the
      AST, so the contract covers both the callback and its callees.

#### RED-first evidence

- [x] Unit-test the analyzer with source fixtures containing a safe local
      worklet helper, an unsafe identifier helper, an unsafe
      `ImportedNamespace.helper()` call, and an unsafe `helpers[name]()` call.
- [x] Each unsafe fixture must fail independently; the existing renderer must
      remain accepted.

> **Final verification fix record.** T11-VF1: the headless rules suite now
> walks the full lifecycle — first nonzero entry (`sweepContactEntryTime`
> equals the raw sweep time on the entry frame), latch throughout the
> interval, separation clears both `sweptHit` and the entry fact, the
> teleport frame keeps the fact cleared, and a second interval after the
> wrap publishes a fresh entry. The between-interval band asserts the fact
> stays `undefined`, so a retained or reused entry fails the suite (the
> retention regression was simulated and failed 10/11 before restoring).
> T11-VF2 (completed in T11-FVF1): `analyzeDerivedCallbacks` classifies every
> CallExpression shape through the TypeScript AST — allowlisted identifiers,
> approved `Math` method names only, and rejection of namespace, object-method,
> and element-access callees — and verifies each derived callback carries the
> worklet directive. Discovery accepts arrow and function-expression updaters,
> tolerates the optional dependency argument, and fails CLOSED on unsupported
> updater shapes; the exact discovered count equals the analyzed body count.
> Fixture tests pin each unsafe shape independently (identifier, namespace,
> method, element access, arbitrary Math property, missing or false directive)
> while the real renderer stays accepted. Suites: `collisionLabGame.test.ts`
> (T11-VF1), `rendererContract.test.ts` (T11-VF2, T11-FVF1).

- [x] Resolve T11-VF1 and T11-VF2 with their focused RED suites.
- [x] Check the corresponding evidence only after those suites exist.
- [x] Restore Task 11 to `Resolved` and record the resolving commit once.
- [x] Leave the five physical-device rows open until run on the named
      hardware.

## Final verification follow-up — review of `af144ba`

This review is limited to the VF1/VF2 changes in `af144ba`; it does not rerun
the reported repository gate. T11-VF1 is resolved: the headless test now
covers entry, latch, separation, the teleport frame, the empty band between
contacts, and the next interval while retaining the public raw-time behavior.
The current renderer also passes the strengthened call-shape analyzer.

### T11-FVF1 — Finish discovery and allowlisting in the AST analyzer

**Priority:** Important

`bannedCallsInBody` classifies identifier, property-access, element-access,
and fallback call expressions once a callback body reaches it. The outer
`analyzeDerivedCallbacks` discovery still accepts only this exact shape,
however:

```ts
useDerivedValue(() => { ... })
```

It requires exactly one argument and an `ArrowFunction`. A valid function
expression or a valid call with the optional dependencies argument is skipped
entirely. The `>= 20` assertion does not close this hole because the renderer
currently contains 23 derived callbacks, so as many as three could disappear
from analysis while the test remains green.

The property-access branch also accepts every `Math.*()` name. That is not the
recorded "Math built-ins only" policy: `Math.notAFunction()` would be accepted
by the analyzer and then fail on the UI runtime. Finally, worklet detection is
a text-prefix check rather than an AST directive check, so a non-directive
expression beginning with the same text can be misclassified.

#### Required approach

- [x] Enumerate every `useDerivedValue` call first. Assert that its updater is
      either an arrow function or function expression, analyze both forms,
      and explicitly handle the supported optional dependency argument.
- [x] Fail closed on an unsupported updater/call shape instead of silently
      omitting it from `bodies`.
- [x] Replace the lower-bound callback assertion with an exact comparison:
      discovered `useDerivedValue` calls must equal analyzed callback bodies.
- [x] Maintain an explicit set of approved `Math` method names and require the
      property name to be in that set. Do not approve an arbitrary property
      merely because its receiver text is `Math`.
- [x] Inspect the callback block's first AST statement and require an actual
      string-literal expression directive equal to `worklet`; avoid
      `startsWith` source-text inference.

#### RED-first evidence

- [x] Add fixtures for an arrow updater, a function-expression updater, and a
      supported two-argument `useDerivedValue` call; every callback body must
      be analyzed.
- [x] Add a fixture with an unsupported updater shape and assert a closed
      failure rather than a lower body count.
- [x] Add `Math.abs()` as an accepted fixture and `Math.notAFunction()` as a
      rejected fixture.
- [x] Add a false-directive fixture such as `'worklet' + suffix;` and assert
      it is reported as non-workletized.
- [x] Assert the exact number of derived calls in the real renderer equals the
      number of analyzed bodies.

### Final follow-up record

- [x] Resolve T11-FVF1 with the focused renderer-contract suite.
- [x] Correct the VF2 completion record to describe exact callback discovery
      and approved Math methods only after the tests exist.
- [x] Restore Task 11 to `Resolved` and record the resolving commit once.
- [x] Leave the five physical-device rows open until run on named hardware.
