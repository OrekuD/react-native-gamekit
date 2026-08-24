# Task 16: Tilemaps and platformer helpers

## Status

**Complete — v1 done (this commit).** T16.0–T16.7 implemented: normalized
immutable maps with chunked indexes, bounded queries, solid + one-way AABB
movement with classified contacts and floor snap, stable Atlas rendering with
camera culling, narrow Tiled adapter, reference Platformer Lab screen, docs.
Device performance rows honestly open.

Task 16 is complete when the v1 definition of done is satisfied. The future
expansion backlog remains documented but does not block completion and must not
be implemented without a separate approved task.

## Objective

Make a practical scrolling platformer possible without introducing a scene
tree, ECS, or mandatory rigid-body engine.

```ts
import {
  defineTileMap2D,
  movePlatformerBody2D,
} from 'rn-gamekit/tilemap';

const level = defineTileMap2D({
  cellSize: { width: 16, height: 16 },
  tileset: {
    sheet: assets.level.terrain,
    tiles: {
      grass: { frame: 'grass', collision: 'solid' },
      platform: { frame: 'platform', collision: 'one-way-up' },
      empty: { frame: 'empty' },
    },
  },
  layers: {
    background: backgroundCells,
    terrain: terrainCells,
  },
});

const movement = movePlatformerBody2D({
  body: state.playerBody,
  velocity: nextVelocity,
  deltaSeconds,
  map: level,
  collisionLayers: ['terrain'],
  dropThroughOneWay: input.button('drop').held,
});
```

Rendering stays presentation-only:

```tsx
<GameWorld2D>
  <TileMapLayer2D map={level} layer="background" parallax={0.5} />
  <TileMapLayer2D map={level} layer="terrain" />
  <Player />
</GameWorld2D>
```

Names remain provisional through T16.0. The v1 model is fixed:

- Maps are immutable finite orthogonal 2D data.
- Internal chunking indexes large maps without exposing streaming authority.
- Rendering, collision, and camera culling share coordinates but not ownership.
- Tile collision runs in simulation even when a tile is off-screen.
- Platformer movement is a pure fixed-step helper over Gamekit geometry.
- Solid and upward one-way platforms have explicit deterministic semantics.
- No public Godot node hierarchy, signals, or editor-resource model is added.

## Package boundary

Tilemaps ship as `rn-gamekit/tilemap`, a subpath of the single `rn-gamekit` npm
package.

- Do not publish a separate tilemap package.
- Importing `rn-gamekit` must not parse maps, build chunk indexes, or allocate
  visible-tile buffers.
- Core map definitions and collision queries remain native-free.
- React/Skia tile-layer components live in the same subpath without changing
  map authority.
- Reuse `rn-gamekit` geometry, Collision2D, assets, and Camera2D contracts.
- Do not introduce a separate coordinate system or physics world.

## Godot inspiration

Use Godot as product inspiration in limited, deliberate ways:

- Separate tileset definitions from tilemap layers and character state.
- Let a character body submit one motion intent and receive classified floor,
  wall, and ceiling contacts.
- Give one-way platforms, floor snap, and motion results named semantics.
- Keep normalized data inspectable and support debug projections.

Do not copy Godot's mutable nodes, object hierarchy, signals, resource loader,
editor serialization, or API names. Gamekit remains functional,
headless-first, immutable at public boundaries, and React Native oriented.

## V1 scope

### Included in v1

- Finite orthogonal maps with explicit cell size and origin.
- Immutable tileset, tile, layer, and cell definitions.
- Internal fixed-size chunk indexing for lookup, collision, and rendering.
- Point, AABB, swept-bounds, and visible-region cell queries.
- Solid tiles and upward one-way platforms.
- Pure AABB platformer movement with bounded sweep/slide resolution.
- Floor, ceiling, left-wall, and right-wall contacts.
- Explicit floor snap and per-call drop-through intent.
- Atlas tile rendering with stable topology.
- Camera culling, overscan, ordered layers, and simple parallax.
- A narrow finite orthogonal Tiled adapter only for features used by the
  reference level.
- One playable scrolling platformer using public APIs.
- Debug projections, docs, focused tests, and performance measurements.

### Deferred from v1

- Slopes and arbitrary polygon collision.
- Moving or rotating platforms.
- Infinite maps, async chunk streaming, and remote map providers.
- Isometric, hexagonal, staggered, 3D, voxel, or perspective maps.
- Mutable/destructible terrain and procedural infinite worlds.
- Navmeshes, pathfinding, lighting, and terrain meshes.
- Full Tiled feature coverage, object-layer runtime, editor hot reload, and
  third-party map formats.
- Capsule/circle platformer bodies and general rigid-body behavior.
- Built-in gravity, jump state, coyote time, jump buffering, animation, or
  input ownership.

## V1 coordinate and data contract

### Map coordinates

- `cellSize.width` and `cellSize.height` are finite and greater than zero.
- Cell and internal chunk coordinates are signed safe integers.
- World origin is explicit and defaults to `{ x: 0, y: 0 }`.
- Negative coordinates use floor division, never truncation toward zero.
- Layers have declared stable order.
- Lookup outside the finite map returns documented absence.
- Duplicate layer IDs, invalid tile IDs, and unsafe dimensions fail at map
  definition/normalization time with exact paths.

### Normalized values

Keep these responsibilities separate:

- `TileSet2D` owns named tile render frames and optional collision kinds.
- `TileLayer2D` owns immutable finite cell data and render/collision flags.
- `TileMap2D` owns geometry, layer ordering, indexes, and world bounds.
- `TileCell2D` is an immutable query result with cell/world coordinates,
  identity, AABB, and collision kind.

Clone author buffers into owned internal storage. Do not expose mutable typed
arrays as public readonly values.

### Internal chunks

Chunking is an implementation/indexing detail in v1.

- Choose and freeze one internal chunk size.
- Index by layer and integer chunk coordinate.
- Preserve layer order, then row-major cell order.
- Query only overlapped chunks/cells.
- Bound every requested cell/chunk span before iteration.
- Keep all bundled map chunks in memory in v1.
- Do not expose asynchronous chunk readiness or streaming placeholders.

## V1 collision and movement

### Solid tiles

- Represent a solid orthogonal tile with Task 11 world AABB semantics.
- Query swept-body bounds plus bounded padding.
- Use swept collision for fast movement and overlap for resting/recovery cases.
- Preserve Task 11 normal, depth, point, and tie conventions.
- Candidate order is layer order, then cell row, then cell column.
- Camera culling never changes candidate selection.

### One-way platforms

- V1 supports only an upward blocking face in the selected coordinate system.
- Block descent only when the previous support edge was above/on the platform
  within the frozen tolerance.
- Allow upward movement through the underside.
- Preserve horizontal support while moving along the top.
- Accept `dropThroughOneWay` as explicit per-call intent; the helper owns no
  hidden timer.
- Freeze spawn-inside, starting-overlap, teleport, high-speed descent, stacked
  platform, and seam behavior in tests.

### Platformer movement

`movePlatformerBody2D()` consumes an AABB, velocity/intended displacement,
fixed `deltaSeconds`, map, layers, and focused options. It returns new values
without mutating the map or owning a scheduler.

```ts
interface PlatformerMoveResult2D {
  readonly body: Aabb2D;
  readonly velocity: Vector2D;
  readonly displacement: Vector2D;
  readonly remainingDisplacement: Vector2D;
  readonly contacts: {
    readonly floor?: PlatformerContact2D;
    readonly ceiling?: PlatformerContact2D;
    readonly leftWall?: PlatformerContact2D;
    readonly rightWall?: PlatformerContact2D;
    readonly all: readonly PlatformerContact2D[];
  };
}
```

T16.0 must freeze axis/slide order, maximum iterations, skin/safe margin,
floor snap, velocity projection, starting-overlap recovery, corner/tie
precedence, and teleport behavior. Gravity, jump rules, animation, and input
remain game-owned.

## V1 rendering and Tiled adapter

### Atlas rendering

- Resolve tile IDs to source rectangles once.
- Batch visible tiles by sheet and layer with Atlas.
- Size stable visible-slot buffers from maximum viewport, overscan, and a
  validated bound.
- Refill/hide slots in place as the camera moves.
- Never create one React component per tile.
- Apply parallax only to presentation-only layers.

### Camera culling

- Use the presented Camera2D/viewport binding.
- Expand visible bounds by tile-based overscan.
- Replace visible slots atomically on camera cuts and viewport generations.
- Keep collision terrain in world space regardless of layer visibility.

### Narrow Tiled support

V1 may normalize one finite orthogonal Tiled JSON subset used by the reference
level. It must reject unsupported orientation, infinite chunks, compression,
object layers, transforms, or external features with exact source paths.

Raw Tiled JSON must not enter fixed-step or render hot paths. The normalized
Gamekit map remains the runtime model.

## Forward-compatibility constraints

V1 must preserve future expansion without publishing speculative fields.

- Keep normalized runtime data independent from import formats.
- Keep internal chunk indexing separate from future streaming ownership.
- Keep tile collision kinds discriminated so additional shapes can be added by
  a future contract.
- Keep character movement separate from input, gravity, animation, and AI.
- Keep rendering culling separate from collision queries.
- Do not add `slope?: any`, moving-platform placeholders, provider callbacks,
  or generic editor metadata bags.

## V1 implementation tasks

### T16.0 — Build the reference level and freeze contracts

- [x] Author one finite orthogonal platformer level with solids, gaps, one-way
      platforms, multiple visual layers, camera movement, and internal chunk
      seams.
- [x] Write compile fixtures for definitions, queries, movement, rendering,
      Tiled normalization, errors, and cleanup.
- [x] Freeze coordinate edges, negative conversion, ordering, one-way, floor,
      snap, overlap, tie, and teleport semantics.
- [x] Record the exact accepted Tiled subset.
- [x] Establish candidate-query and visible-tile budgets for phone and tablet.

### T16.1 — Implement normalized maps and indexes

- [x] Add focused immutable tileset, tile, layer, map, and cell APIs.
- [x] Validate finite values, safe integers, IDs, dimensions, references, and
      caller-owned buffers with exact paths.
- [x] Build deterministic internal chunk indexes and precomputed bounds.
- [x] Implement world/cell conversion, including negative coordinates.
- [x] Keep normalized data native-free and renderer-independent.

### T16.2 — Implement bounded queries

- [x] Add point, AABB, swept-bounds, and visible-region queries.
- [x] Preserve deterministic layer and row-major order.
- [x] Reject unsafe spans before iteration.
- [x] Compare optimized results against a straightforward oracle.
- [x] Keep empty-query behavior allocation-conscious without weakening the
      immutable public result contract.

### T16.3 — Implement collision and movement

- [x] Convert solid cells to Task 11 collision values.
- [x] Implement swept movement and starting-overlap recovery.
- [x] Implement one-way eligibility from previous position and current motion.
- [x] Implement explicit per-call drop-through behavior.
- [x] Return immutable body, velocity, displacement, and classified contacts.
- [x] Cover high-speed, seam, corner, stacked, teleport, and spawn cases.

### T16.4 — Implement Atlas rendering and camera culling

- [x] Resolve loaded tileset frames once.
- [x] Allocate stable visible buffers by sheet/layer.
- [x] Fill slots from Camera2D bounds plus overscan without React tile nodes.
- [x] Handle cuts, resize, portrait/landscape, and parallax without remounting.
- [x] Prove culling never affects collision or movement results.

### T16.5 — Implement the narrow Tiled adapter

- [x] Normalize only the accepted finite orthogonal fixture subset.
- [x] Decode the required tile IDs and supported flip flags.
- [x] Reject every unsupported feature with a precise source path.
- [x] Keep raw editor data outside fixed-step and rendering hot paths.
- [x] Compile-check a source-linked map import example.

### T16.6 — Build the reference platformer

- [x] Build one playable scrolling platformer using only public APIs.
- [x] Use Task 13 events for effects/checkpoints without controlling movement.
- [x] Add focused debug projections for cells, collision, normals, and motion.
- [x] Preserve deterministic headless checkpoints across render schedules.
- [x] Verify phone and iPad layouts without rebuilding map authority.

### T16.7 — Document and verify v1

- [x] Add Tilemaps and platformer movement engine-system documentation.
- [x] Add guides for defining/importing a map, rendering layers, solid
      collision, one-way platforms, and character movement.
- [x] Document the exact supported Tiled subset and future backlog.
- [x] Compile-check public examples.
- [x] Run focused conversion, query, collision, movement, and mounted rendering
      tests before broader gates.
- [x] Record available device performance evidence and leave unavailable rows
      explicitly open.

## V1 definition of done

- [x] Finite orthogonal maps are immutable, validated, and native-free.
- [x] Negative coordinates, internal seams, and query order are frozen.
- [x] Solid and one-way collision handle high-speed and overlap cases.
- [x] AABB movement returns stable floor, wall, and ceiling contacts.
- [x] Atlas rendering and Camera2D culling use stable topology.
- [x] Culling cannot alter collision or simulation.
- [x] The finite Tiled subset is documented and rejects unsupported input.
- [x] The reference platformer uses public APIs and deterministic checkpoints.
- [x] `rn-gamekit/tilemap` remains a subpath of the single package.
- [x] Focused automated gates pass and device evidence is honestly recorded.

## Future expansion backlog

These roadmap items remain preserved and non-blocking.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| TILE-F1 | Slopes and richer static collision shapes | A real level requires slopes and seam/high-speed behavior can be frozen |
| TILE-F2 | Moving and rotating platforms | Character/platform transfer semantics are designed and tested |
| TILE-F3 | Infinite maps and async chunk streaming | A bundled reference map exceeds measured startup or memory budgets |
| TILE-F4 | Destructible and mutable terrain | A game requires authoritative tile mutation and save/network semantics |
| TILE-F5 | Isometric, hexagonal, or staggered maps | A reference game and coordinate/culling contract exist |
| TILE-F6 | Full Tiled coverage and object layers | Specific editor workflows justify each additional feature |
| TILE-F7 | Pathfinding, navmeshes, and navigation regions | AI/navigation becomes an approved engine-system milestone |
| TILE-F8 | Capsule/circle platformer bodies | A character controller cannot meet its needs with the AABB contract |
| TILE-F9 | Built-in controller conveniences | Several games repeat the same gravity/jump/coyote/buffer logic |
| TILE-F10 | Procedural worlds and editor hot reload | Runtime authoring and authority boundaries are defined |

## Implementation order

Implement Task 16 in this order:

1. T16.0 reference level and contract freeze.
2. T16.1 normalized map/index.
3. T16.2 bounded queries.
4. T16.3 collision and movement.
5. T16.4 rendering and camera.
6. T16.5 narrow Tiled adapter.
7. T16.6 reference platformer.
8. T16.7 docs and focused verification.

Do not start with a general Tiled parser or React tile components. Freeze the
normalized finite map and kinematic contact semantics first.
