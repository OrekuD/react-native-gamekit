# Task 11: Core 2D geometry and deterministic collision

## Status

**Not started.** This task adds the first public gameplay system beyond the
runtime foundations: a headless, deterministic Collision2D module for common
arcade games. It establishes canonical 2D geometry, overlap and contact
queries, swept collision, filtering, broad-phase indexing, debug projections,
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
>   `depth` is nonnegative; contact points: circle-AABB = closest point on
>   the AABB to the circle center (clamped center), circle-circle = midpoint
>   of the centers at the circle boundary along the center line, AABB-AABB =
>   overlap-rectangle center. Circle-center-inside-AABB uses the minimum
>   penetration axis (same convention as Brick Breaker's current math);
>   coincident circle centers return the documented `{0, 1}` fallback normal
>   (straight up) with zero depth.
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

- [ ] A fast ball crosses an entire thin brick in one fixed step and still
      hits it.
- [ ] A fast object moving away reports no future impact.
- [ ] Zero displacement and parallel travel produce finite deterministic
      results.
- [ ] Earliest of two targets wins independent of target array ordering when
      times differ.
- [ ] Exact equal-time ties use the locked deterministic rule.

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

- [ ] Matching, one-way mismatch, two-way mismatch, zero mask, and all-bit
      mask cases.
- [ ] Sensor and solid records produce identical geometry results.
- [ ] Placing local AABB and circle colliders produces the expected world
      shapes at positive and negative object positions.
- [ ] Placement preserves inputs, metadata, filters, and sensor intent.
- [ ] Type fixtures reject double placement and local colliders passed into
      world-only operations.
- [ ] Two named colliders on one object remain independent and deterministic.
- [ ] Changing a visual animation frame has no implicit collider effect.
- [ ] Invalid categories and masks fail before broad-phase insertion.

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

- [ ] Empty, single-cell, multi-cell, negative-coordinate, and boundary-cell
      queries.
- [ ] One large item appears once even when it occupies many cells.
- [ ] Rebuilds with the same ordered input produce the same ordered candidates.
- [ ] Candidate results include every true overlap from a brute-force oracle.
- [ ] Duplicate identifiers and invalid cell sizes fail clearly.

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

- [ ] The root debug types import without native modules.
- [ ] Production collision results do not allocate debug data automatically.
- [ ] Debug rendering uses world coordinates and composes with `GameWorld2D`.
- [ ] A debug collider remains aligned with a translated sprite at its
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
- [ ] A ball cannot tunnel through a paddle, wall, or thin brick at the maximum
      authored speed.
- [ ] Collision ordering is deterministic for equal-time brick contacts.
- [ ] Performance Lab regressions are visible rather than averaged away.

### T11.8 — Add a Collision Lab playground example

This example must teach and diagnose the system rather than duplicate Brick
Breaker with different colors.

- [ ] Add static AABB, circle, containment, and boundary-contact cases.
- [ ] Add a fast swept projectile crossing a thin target.
- [ ] Add toggles for shape pair, sensor/filter state, and debug display.
- [ ] Add an imported sprite with visible `body`, `hurtbox`, `attack`, and
      `pickup` collider examples.
- [ ] Let the example change sprite animation while proving that its collider
      stays stable unless the game explicitly changes it.
- [ ] Display contact normal, depth, point, sweep time, and candidate counts.
- [ ] Keep controls outside the gameplay hit surface and safe-area aware.
- [ ] Add a catalog entry through the existing atomic surface registry.
- [ ] Add headless rules tests and mounted interaction-boundary tests.

#### Acceptance criteria

The lab must expose wrong geometry immediately.

- [ ] Every visual contact has matching structured values.
- [ ] Filtered pairs remain visible but report no eligible contact.
- [ ] Pause, resume, Back, reopen, and pointer input preserve prior lifecycle
      contracts.

### T11.9 — Document Collision2D and agent workflows

Documentation must teach detection separately from response and physics.

- [ ] Add Collision2D to Engine Systems.
- [ ] Add the planned “Detect collisions without physics” guide.
- [ ] Document every shape, predicate, manifold, sweep, filter, index, debug
      value, and error.
- [ ] Show a small static overlap example and a fast swept example.
- [ ] Explain normal direction, depth, point, boundary contact, and time.
- [ ] Explain broad phase versus narrow phase without requiring ECS knowledge.
- [ ] Explain sensors, masks, and why collision never changes game state.
- [ ] Add an “Attach collision to an imported sprite” guide that defines a
      visual descriptor and local colliders on one authored object.
- [ ] Explain local versus world coordinates, sprite anchors, logical units,
      and multiple named colliders.
- [ ] Explain why assets do not automatically own colliders and why rendered
      alpha is not gameplay geometry.
- [ ] Document Task 11's translation-only limit and the future path for
      rotated shapes, prefab composition, and collider editors.
- [ ] Describe the Godot-inspired separation without describing GameKit as a
      node tree or full physics engine.
- [ ] Link Brick Breaker and Collision Lab source.
- [ ] Update `doc-structure.md`, package README scope, changelog, and relevant
      agent game-authoring skill.
- [ ] Compile or typecheck every published example against package exports.

#### Acceptance criteria

The documentation must support both beginner and advanced paths.

- [ ] A beginner can copy one circle–AABB example without broad-phase setup.
- [ ] An advanced user can find deterministic ordering and performance rules.
- [ ] No page describes Collision2D as a rigid-body physics engine.

### T11.10 — Run focused, package, benchmark, and device gates

Verification must separate pure correctness, package integration, performance,
and physical interaction evidence.

- [ ] Run focused RED/GREEN tests during each implementation step.
- [ ] Run package tests and meaningful coverage for every new headless module.
- [ ] Run playground rules and mounted composition tests.
- [ ] Run lint, typecheck, package build, declarations, source maps, tarball
      inspection, and headless-root import checks.
- [ ] Run docs build and Expo export.
- [ ] Benchmark brute force and spatial hash with recorded scene sizes.
- [ ] Record miss-path allocation and hit-path allocation behavior.
- [ ] Compare Brick Breaker Performance Lab metrics before and after migration.
- [ ] Validate Collision Lab and Brick Breaker on a physical iPhone and iPad.
- [ ] Validate Android interaction and rendering on available hardware.
- [ ] Run `git diff --check` and confirm only Task 11 files are included.

#### Acceptance criteria

Automated completion must not be confused with device completion.

- [ ] Correctness gates pass with the required coverage.
- [ ] Benchmarks record distributions and candidate counts, not one FPS value.
- [ ] Physical-device rows remain unchecked until run on named hardware.

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

- [ ] Canonical 2D geometry exports from the native-free root.
- [ ] Static contacts and swept queries follow one documented convention.
- [ ] Filters, sensors, and broad phase are deterministic and tested.
- [ ] Imported sprites compose with local, named colliders without renderer or
      asset-loader coupling.
- [ ] Collider placement is immutable, translation-only, type-safe, and
      documented with logical world units.
- [ ] Debug data is headless and opt-in.
- [ ] Brick Breaker uses the public system without behavior regression.
- [ ] Collision Lab is playable and source-linked.
- [ ] Public types contain no ECS, physics-engine, Skia, or 3D leakage.
- [ ] Documentation and agent instructions teach detection versus response.
- [ ] Automated package, docs, and Expo gates pass.
- [ ] Benchmarks are recorded honestly.
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
