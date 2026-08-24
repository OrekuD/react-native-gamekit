# Task 16: Tilemaps and platformer helpers

## Status

**All findings resolved — re-review pending.** T16-F1 through T16-VF1 are
now addressed as described below. Device performance rows remain open until
they run on named hardware.

### Fifth follow-up resolution summary (VF1)

- **T16-VF1** — Extracted `GameSurface` to
  `apps/playground/src/shell/GameSurface.tsx` so the real loading gate
  can be mounted without the full `PlaygroundShell`. Added
  `apps/playground/src/shell/GameSurface.test.tsx` (4 tests) mounting
  the real `GameSurface` with spy `Content` and fake sessions: loading
  slot proves overlay present, `Content` not mounted, placeholder input
  receives no gameplay action, and Back remains usable; rerender to ready
  proves the gate disappears and `Content` mounts exactly once with the
  ready session and exact asset lease; error state proves Retry calls the
  exact active request's retry once while `Content` stays absent and
  Back/close remain safe; a stale asset state/request ID proves it cannot
  supply error/retry/ready to the current surface. The test fails against
  the pre-`cb74f81` composition that mounted `Content` for both loading
  and ready slots.

### Fourth follow-up resolution summary (TF1-TF2)

- **T16-TF1** — Overscan is now a consistent per-axis cell count derived
  from the same scalar `padWorld = overscan * max(cellWidth, cellHeight)`
  used by both `writeLayerVisibleBounds` and buffer sizing:
  `slotsAxis = ceil((diagonal/minZoom + 2*padWorld)/cellAxis)+1`. This
  keeps capacity and bounds in lockstep for non-square cells (e.g. 8×64
  and 64×8). The `-2` preflight remains fail-closed. New fully-occupied
  rotated tests cover 8×64 and 64×8 on phone (320×480) and tablet
  (1024×768) at `zoom === minZoom = 0.5`, plus a non-rotated non-square
  case to isolate overscan math from rotation math.
- **T16-TF2** — Extracted `AssetGateOverlay` to
  `src/shell/AssetGateOverlay.tsx` so it can be tested without the full
  shell. Added `src/shell/assetGate.test.tsx` (3 tests: loading spinner,
  error+retry, back) and extended `platformerLabContent.test.tsx` to
  invoke the real duplicate sequence `onPressIn → onTouchEnd →
  onPressOut` and assert exactly one release edge plus a second press
  proving the held state was cleared. `GameSurface` now gates `Content`
  behind `slot.status === 'loading'` (verified by the overlay's blocking
  pointerEvents and by existing `surfaceController` loading/ready tests).

### Third follow-up resolution summary (SF1-SF3)

- **T16-SF1** — `TileMapLayer2D` now keeps window acquisition and capacity
  diagnostics on separate state: `pendingSV` guards only `requestWindow`,
  while `capacityWarnPendingSV` guards the one-shot `onBeyondCapacity`
  warning. `onBeyondCapacity` is RN-owned and clears only its own pending
  guard; it never touches `pendingSV`. A mounted lifecycle test fills one
  window, enters a below-capacity zoom, moves the camera beyond the window,
  returns to a valid zoom, and proves a new `scheduleOnRN(requestWindow)`
  fills the new cells.
- **T16-SF2** — Fixed buffers are now sized for the worst rotated AABB at
  `minZoom` using the viewport diagonal per cell axis plus overscan, so a
  45-degree view at `minZoom` never exceeds capacity when `zoom >=
  minZoom`. `width`, `height`, `overscan`, and both parallax values are
  validated at the public boundary with exact errors before any buffers
  allocate. `fillTileSlots` preflights the span against capacity and
  returns `-2` for insufficient capacity (hiding the whole layer) distinct
  from `-1` for a missing window; the worklet never claims partial success.
  Portrait and tablet tests at 45 degrees with every visible cell occupied
  assert the complete span is present.
- **T16-SF3** — `GameSurface` no longer mounts gameplay content with the
  placeholder session: while `slot.status === 'loading'` it renders a
  blocking `AssetGateOverlay` (loading spinner or error + retry/back) that
  prevents every gameplay control from receiving touches. Content mounts
  only with the ready session and lease, preserving request-ID and
  retirement rules. `PlatformerLabContent.release` now dispatches only when
  `heldActions.delete` returns true, so duplicate `onTouchEnd` +
  `onPressOut` edges collapse to one. Tests cover loading-gate blocking,
  ready handoff, error-retry, close-while-error, and duplicate-release
  suppression.

Task 16 is complete when the v1 definition of done is satisfied. The future
expansion backlog remains documented but does not block completion and must not
be implemented without a separate approved task.

### Follow-up resolution summary (RF1-RF4)

- **T16-RF1** — `TileMapLayer2D` now imports `scheduleOnRN` from
  `react-native-worklets`; `runOnJS` appears nowhere in the tile renderer.
  `requestWindow` stays RN-owned and stable (`useCallback`, captures only the
  map/layer ids and frame table). The structural contract rejects the token
  `runOnJS`, requires `scheduleOnRN`, and verifies `writeLayerVisibleBounds`
  and `fillTileSlots` carry worklet directives. The mounted window-request
  test drives uncovered window -> scheduleOnRN delivery -> bounded snapshot
  -> filled slots end to end.
- **T16-RF2** — One coherent parallax contract: `TileMapLayer2D` applies the
  visual correction itself via `layerParallaxTransform2D` and derives culling
  from the same factor; Platformer Lab no longer wraps its cloud layer in an
  outer `GameLayer2D`. Without a presented camera, bounds derive from
  `viewport.visibleLogicalBounds` (the viewport-only world path renders and
  fills). New `minZoom` prop sizes capacity for zoomed-out cameras; a camera
  beyond the declared capacity hides every slot and fires a one-shot RN-side
  warning instead of under-filling. `writeLayerVisibleBounds` writes into a
  caller-owned scratch object (one stable allocation) and fill params are
  frozen per binding — no per-frame objects. Mounted assertions cover
  viewport-only rendering, parallax 0/0.5/1, camera motion, zoom above and
  below the bound, rotation, and a window transition, asserting both selected
  cells and final transforms.
- **T16-RF3** — The shell's asset boundary is generic: catalog entries
  declare `assets: { manifest, groups }` (sprite-field, collision-lab,
  platformer-lab), one `GameAssetAcquirer` mounts per request keyed by the
  request id, leases pass through unchanged, stale readiness never wins, and
  the loading slot retires cleanly on close-while-loading. Camera Lab drops
  its bogus asset-backed flag. Jump releases on `onPressOut`/
  `onTouchEnd`/`onTouchCancel`, and screen unmount releases every held
  control. Tests: controller flow open -> loading -> asset-ready -> playable
  for Platformer Lab, close-while-loading, superseded-ready; mounted
  two-jump-press test asserting two distinct press edges plus cancel release.
- **T16-RF4** — `forEachCellInSpan` fetches intersecting chunk references
  once per chunk-Y band, then iterates GLOBAL rows visiting chunk-X segments
  left to right: true global row-major order with one lookup per chunk. An
  oracle test plants interleaved cells across three horizontal chunks and
  five rows and asserts exact returned identity order. The visit counters
  moved to `src/tilemap/chunkStats.ts`, re-exported only through
  `rn-gamekit/testing`; the public tilemap entry exports no double-underscore
  seams (enforced by a test).

### Resolution summary

- **T16-F1** — `defineTileLayer2D` freezes its owned `data` copy;
  `defineTileMap2D` freezes `origin`, layers, and lookup records; nested tile
  defs and name/id tables are frozen; the chunk index moved to a
  module-private `WeakMap<TileMap2D, ChunkIndex>` (no `__chunks` key on the
  public value); `collidable` and all other inputs are validated at runtime.
  Mutation tests cover origin, layer data, tile defs, layer lookups, and the
  private-index boundary (`tilemap.findings.test.ts`).
- **T16-F5** — starting-overlap recovery tracks the winning tile, face, sign,
  and depth together with the frozen upward tie at NEGATIVE y (the old
  comparison preferred +y, i.e. down). X/Y sweeps now resolve each axis
  against the NEAREST blocking plane in a first phase and emit contacts only
  for tiles touching that winning plane in a second phase; farther crossed
  rows/columns are never reported. The committed `console.error`, no-op
  `try/catch`, and `tmdbg.test.ts` scratch file are gone. New tests: exact
  left/up tie resolves up, winning-plane multi-tile overlap, two-row
  high-speed fall touches only the nearest plane, reverse-horizontal wall
  normals, contact-AABB touch invariant, seam determinism.
- **T16-F6** — every runtime read (`tileAt`, point/AABB/swept/visible, and
  therefore all movement candidates) flows through the private chunk index;
  queries iterate overlapped 16x16 chunk regions once via
  `forEachCellInSpan`, preserving global row-major order. A test-only visit
  counter proves a sparse query on a 512x512 map visits <= 4 chunk regions.
  Oracle-equivalence tests kept. The Tiled adapter validates root, options,
  gid map, and every layer object BEFORE property access, rejects EVERY
  non-tilelayer type (group/imagelayer/unknown) plus nonzero offsets with
  exact source paths; malformed-root/options/group/image/offset/sparse/seam
  tests added.
- **T16-F3/F4** — `TileMapLayer2D` rebuilt around a pure presentation module
  (`src/react/tilemap/tilePresentation.ts`). Visible bounds derive from the
  PRESENTED camera center/zoom/rotation with GameLayer2D parallax applied
  ONCE afterwards (`cameraLayerVisibleBounds`); overscan expands the cell
  span. Unrotated tiles place at their CELL TOP-LEFT (the old half-cell shift
  is fixed); frame dimensions must equal cell dimensions at bind time or an
  exact error names both sizes. The UI runtime receives ONLY bounded window
  snapshots: a flat numeric frame table built once at bind and a viewport-
  sized ids array transferred via shared value whenever the visible cell
  span outgrows the current window (one-shot request guard; camera motion
  inside the window is allocation-free scalar math). No `Map.get`, no
  `layer.data`, and no map closure exist in any worklet body — enforced by a
  structural call-graph test plus a transferred-records bound test
  (20x20 window over a 512x512 map).
- **T16-F2** — Platformer Lab rebuilt as a real reference game:
  `platformerLabGame.ts` runs body/velocity/gravity/`movePlatformerBody2D`
  inside the scene's FIXED-STEP update (no second clock); three
  deterministic checkpoints emit exactly one typed Task 13 `checkpoint`
  event each; the renderer presents committed snapshots via shared values,
  draws a half-speed parallax cloud layer plus the terrain layer through
  stable Atlas batches, checkpoint markers, and a grounded debug dot; the
  presented Camera2D binding follows the clamped player center with a spawn
  cut; a real generated tilesheet loads through the Gamekit asset APIs.
  Headless tests prove schedule-independent determinism (identical states
  across 1x/3x/7x render batches), ordered checkpoint events, plank support
  and drop-through, and level immutability. Mounted content tests cover
  controls, back exit, cadence-bounded HUD publications, and layout
  topology.

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

## Feedback

The review is limited to the Task 16 implementation in `b1f4caf`. Resolve these
items before marking the task complete again.

### T16-F1 — Normalized maps aren't immutable at runtime (High)

`defineTileLayer2D()` freezes the layer object but leaves its public `data`
array mutable. `defineTileMap2D()` also publishes a mutable `origin` object and
attaches a mutable `Map` as `__chunks`. A consumer can therefore change tile
authority after definition despite the public immutable-map contract.

Required approach:

- Clone and freeze every public nested value, including layer data and origin.
  Mutation attempts through the returned map must either throw or have no
  effect.
- Keep the chunk index outside the public map value. Use module-private storage,
  such as a `WeakMap<TileMap2D, ChunkIndex>`, so consumers can't mutate it or
  depend on `__chunks`.
- Validate `collidable` and all other runtime inputs instead of relying only on
  TypeScript types.
- Add mutation tests for `map.origin`, `layer.data`, nested tile definitions,
  layer lookup values, and the private index boundary.

### T16-F2 — Platformer Lab isn't a valid reference implementation (High)

`PlatformerLabScreen` drives movement from its own `requestAnimationFrame()`
and `Date.now()` loop instead of the session's fixed-step simulation. It renders
the player from an approximately 8 Hz React HUD snapshot, ignores the supplied
player coordinates in `GroupWorldAdapter`, supplies no presented camera, and
passes a placeholder object as the Atlas image. The result isn't deterministic,
doesn't scroll, and isn't a runnable proof of the public rendering path. The
completed Task 13 events, debug projections, deterministic checkpoints,
multiple visual layers, and phone/iPad layout claims are also absent.

Required approach:

- Move body, velocity, gravity, and `movePlatformerBody2D()` into a real game
  scene update driven by the session's fixed step. Don't create a second clock
  or scheduler in the screen.
- Publish player presentation from committed session frames or shared values;
  reserve React state for low-frequency HUD diagnostics.
- Load a real bundled tilesheet through the Gamekit asset APIs and pass the
  decoded `SkImage` and frame metadata to `TileMapLayer2D`.
- Use the existing presented Camera2D binding to follow the player, and add at
  least one distinct parallax/background layer.
- Produce Task 13 events for the promised effect or checkpoint facts, render
  the promised collision/debug data, and add deterministic headless checkpoint
  tests that compare different render schedules.
- Add focused mounted tests for controls, pause, back, asset readiness, camera
  movement, and the phone/tablet layout contract. Keep physical verification
  rows open until they run on named hardware.

### T16-F3 — Tile camera culling and Atlas placement are incorrect (High)

`TileMapLayer2D` derives its visible window from
`viewport.visibleLogicalBounds`; it uses the camera only for parallax
correction. A normal layer with parallax `1` therefore doesn't change its tile
window when the camera moves, zooms, or rotates. It also writes each unrotated
Atlas transform at `cellTopLeft - halfCell`, shifting every tile up and left,
and it doesn't define how a source frame whose size differs from the map cell
is scaled.

Required approach:

- Derive conservative world-visible bounds from the presented camera center,
  zoom, rotation, viewport, and overscan using the existing Camera2D helpers.
- Apply the `GameLayer2D` parallax model once, after the base camera bounds are
  correct. Test parallax `1`, partial parallax, camera cuts, zoom, 90-degree
  rotation, resize, and off-map views.
- Place unrotated tiles at their cell top-left. If v1 requires frame dimensions
  to equal cell dimensions, validate that at bind time with an exact error. If
  scaling is supported, implement and test the declared anchor and scale
  contract explicitly.
- Inspect actual rect and RSXform buffer values in mounted tests; counting one
  Atlas node alone doesn't prove correct pixels or camera behavior.

### T16-F4 — The renderer transfers the whole map into a UI worklet (High)

The derived worklet closes over `map`, the complete `layerData.data` array, and
a JavaScript `Map` whose `get()` method resolves frames. A large finite map can
therefore be serialized into the UI runtime even though the visible topology is
bounded, and the ordinary `Map.get()` call isn't an explicit worklet-safe
boundary. The current topology test doesn't detect either problem.

Required approach:

- Introduce a tile presentation binding that exposes only bounded visible
  chunk/window data to the UI runtime. Keep full map authority on the
  simulation side.
- Pre-resolve frame rectangles into a worklet-safe numeric lookup or populate
  UI-owned buffers at the controlled binding boundary. Don't invoke ordinary
  collection methods from the derived worklet.
- Transfer a new bounded snapshot only when the visible cell window or source
  binding changes; camera interpolation inside the overscan window must remain
  allocation-free.
- Add a structural worklet call-graph test and a large-map test that measures
  transferred cell/frame records, not only React node count. The transferred
  amount must be bounded by viewport capacity rather than map dimensions.

### T16-F5 — Movement reports incorrect ties and non-contact tiles (High)

Starting-overlap recovery says ties prefer upward motion, but the comparison
selects `sign === 1`, which is downward in the y-down coordinate system. It then
reports `overlapping[0]` even when a different tile supplied the winning face.
The X and Y sweeps append a contact for every crossed candidate while clamping
to only the nearest blocking plane, so `contacts.all` and the classified contact
can describe a tile the final body never touches. The hot path also contains a
committed `console.error()` for every Y candidate and a no-op `try/catch`.

Required approach:

- Track the winning tile, face, distance/time, and normal together. Freeze the
  upward tie as negative Y and preserve deterministic layer/row/column order
  only when physical candidates are otherwise equal.
- Resolve each axis against the nearest blocking plane, then emit contacts only
  for tiles touching that winning plane. Preserve seam contacts deterministically
  without reporting farther crossed rows or columns.
- Add exact symmetric-overlap, multi-tile overlap, multi-row high-speed, reverse
  horizontal, seam, and contact-AABB assertions.
- Remove the candidate logging, redundant `try/catch`, and the committed
  `tmdbg.test.ts` reproduction file.

### T16-F6 — Chunking and adapter completion claims aren't proven (Important)

The definition eagerly builds a chunk index, but `tileAt()` and every query read
`layer.data` directly; no runtime path consumes the chunks. This adds memory and
startup work without providing the claimed chunk-backed lookup. The Tiled
adapter also casts the root before validating it, silently skips unsupported
layer types other than object groups, and doesn't reject unsupported layer
offsets. Those inputs can escape the promised structured-error boundary or be
normalized incorrectly.

Required approach:

- Route point, AABB, swept, visible, and movement candidate reads through the
  private chunk index while preserving layer-then-row-major result order.
- Add query instrumentation or a test-only visit counter proving a sparse query
  visits only overlapped chunks/cells. Keep the oracle-equivalence tests.
- Validate the Tiled root, options, layer objects, and nested arrays before
  property access. Reject every unsupported layer type and unsupported offset
  or transform field with its exact source path; don't silently ignore data.
- Add malformed-root, malformed-options, group/image layer, nonzero offset,
  sparse large-map, and chunk-seam tests.

## Follow-up feedback

The re-review is limited to the repairs in `ccb931e`. Keep the resolved work
above and address these remaining issues.

### T16-RF1 — The UI worklet uses the removed runtime bridge (High)

`TileMapLayer2D` imports `runOnJS` from Reanimated and calls it when the camera
outgrows the transferred tile window. Gamekit targets Reanimated 4 and
`react-native-worklets`; UI-to-React-Native delivery must use `scheduleOnRN`.
The current path can fail exactly when camera motion requests the next window,
leaving the Atlas stale or blank.

Required approach:

- Replace `runOnJS(requestWindow)(...)` with the supported
  `scheduleOnRN(requestWindow, ...)` API from `react-native-worklets`.
- Keep `requestWindow` stable and RN-owned. Don't capture the map or build a
  snapshot inside the worklet.
- Add a focused source/call-graph contract that rejects `runOnJS` in the tile
  renderer and verifies every UI-runtime helper carries a `worklet` directive.
- Add a mounted request test that starts with an uncovered camera window,
  delivers the RN callback, publishes the bounded snapshot, and then fills the
  expected Atlas slots.

### T16-RF2 — Parallax and camera-less rendering remain incorrect (High)

The `parallax` prop changes only the culling bounds; `TileMapLayer2D` never
applies the corresponding `GameLayer2D` transform to its Atlas. Platformer Lab
wraps the cloud layer in `GameLayer2D` but doesn't pass the same factor to
`TileMapLayer2D`, so its visual transform and selected tile window disagree.
Also, `cameraLayerVisibleBounds()` returns no bounds when a camera is absent,
although `GameWorld2D` explicitly supports a viewport-only path and the public
docs show that usage. Finally, capacity is based on the unzoomed surface, so
zooming below `1` can expose more cells than the Atlas owns and silently drop
tiles.

Required approach:

- Make `TileMapLayer2D` own one coherent parallax contract: apply the visual
  correction and derive culling from the same factor. Avoid requiring callers
  to duplicate the factor in an outer `GameLayer2D`.
- When no presented camera exists, derive bounds from
  `viewport.visibleLogicalBounds` and render the viewport-only world normally.
- Define a bounded zoom-out contract. Either size capacity from a validated
  minimum zoom or reject camera states that exceed the declared capacity; don't
  return a partially filled visible region as if it were complete.
- Remove per-frame object creation from `cameraLayerVisibleBounds()` and the
  inline `FillParams` value if the implementation continues to claim an
  allocation-free camera path.
- Add mounted buffer assertions for viewport-only rendering, parallax `0`,
  `0.5`, and `1`, camera motion, zoom below and above `1`, rotation, and a
  window transition. Assert both selected cells and final transforms.

### T16-RF3 — Platformer Lab never receives its tilesheet (High)

The catalog marks Platformer Lab as `assetBacked`, so `SurfaceController`
publishes a loading slot and waits for `assetReady()`. `PlaygroundShell` mounts
an asset controller only for Sprite Field; no code acquires
`platformerLabAssets` or completes the Platformer Lab request. The rebuilt game
therefore can't reach its real session or renderer. Separately, the **Jump**
button presses the action on `onPressIn` but never releases it, so a successful
load would still leave jump held and prevent later press edges.

Required approach:

- Generalize the shell's asset acquisition boundary so every asset-backed
  catalog entry declares its manifest and groups. Don't add another game-ID
  special case.
- Key acquisition by request ID, forward ready/error state only to the matching
  request, preserve the lease through retirement, and ignore stale completion
  using the existing controller rules.
- Release `jump` on `onPressOut` and `onTouchCancel`, or expose and use an
  explicit one-tick pulse API. Ensure unmount releases every held control.
- Drive a focused shell/controller test through open → loading → asset-ready →
  playable for Platformer Lab, plus close-while-loading and stale-ready cases.
  Add a mounted test that performs two separate jump presses and observes two
  distinct press edges.

### T16-RF4 — Chunk traversal breaks global row-major order (Important)

`forEachCellInSpan()` iterates chunk X before local rows. For a query spanning
two horizontal chunks, it emits every row from the left chunk before returning
to the first row of the right chunk. That is chunk-major order, not the frozen
global row-major order promised by every public query. Existing seam tests
don't cover a multi-row, multi-column chunk span. The `__chunkReadCount` and
`__resetChunkReadStats` seams are also re-exported through
`rn-gamekit/tilemap`, despite being documented as test-only.

Required approach:

- For each chunk-Y band, fetch the intersecting chunk references once, then
  iterate global rows and visit the chunk-X segments from left to right for
  each row. Preserve the bounded one-lookup-per-chunk property.
- Add an oracle test whose non-empty cells interleave across at least two
  horizontal chunks and several rows. Assert the exact returned identity order,
  not a sorted comparison.
- Move visit-count instrumentation behind an internal injection or the existing
  testing subpath. Don't publish double-underscore diagnostics from the public
  tilemap entry point.

## Second follow-up feedback

The isolated review covers only the four repairs in `2ec017d`. RF1 and RF4 are
resolved as implemented. Address the remaining lifecycle, capacity, and loading
issues below.

### T16-SF1 — Invalid zoom permanently blocks later window requests (High)

`TileMapLayer2D` reuses `pendingSV` for two unrelated jobs: an in-flight tile
window request and the one-shot below-`minZoom` warning. When the camera zooms
below `minZoom`, the worklet sets `pendingSV.value = true` before scheduling
`onBeyondCapacity`. That callback sets the warning flag but never clears
`pendingSV`. After the camera returns to a valid zoom, an uncovered tile window
can no longer schedule `requestWindow`, leaving the layer stale or blank.

Required approach:

- Give window acquisition and capacity diagnostics separate state. A warning
  must never modify the in-flight window-request guard.
- Keep the one-shot warning state RN-owned, or use a dedicated UI scheduling
  guard that the RN callback clears after delivery.
- Reset only the state that belongs to the completed operation. Don't clear a
  real window request when delivering a warning, and don't let a warning block
  future camera windows.
- Add a mounted lifecycle test that fills one window, enters a below-capacity
  zoom, moves the camera beyond the current window, returns to a valid zoom,
  and proves a new `scheduleOnRN(requestWindow, ...)` call fills the new cells.

### T16-SF2 — Rotated cameras can still produce a partial Atlas (High)

Slot capacity uses the unrotated `width / minZoom` and `height / minZoom` cell
counts. A rectangular viewport rotated near 45 degrees has a conservative AABB
whose width and height can both approach the viewport diagonal. That span can
contain more cells than `capacity` even when `zoom >= minZoom`. In that case,
`fillTileSlots()` returns as soon as `slot >= capacity`, presenting a partial
visible region despite the documented never-partial contract. The current
rotation test checks that some tiles render, not that the complete visible span
fits.

Required approach:

- Size fixed buffers for the worst supported rotated AABB at `minZoom`, using
  the viewport diagonal and each cell axis, plus overscan. Alternatively,
  preflight the actual visible cell span and hide the whole layer when it
  exceeds capacity; never stop halfway and report success.
- Validate `width`, `height`, `overscan`, and both parallax values at the public
  boundary. Reject non-finite, negative, or otherwise unsupported values with
  exact errors before allocating buffers.
- Make `fillTileSlots()` distinguish a complete fill from insufficient
  capacity. An early capacity exit must not look like a valid filled count.
- Add portrait and tablet tests at 45-degree rotation and `minZoom`, with every
  visible cell occupied. Assert either every expected tile is present or every
  slot is hidden according to the chosen contract.

### T16-SF3 — Loading content dispatches into the placeholder session (High)

The generic asset acquirer now starts Platformer Lab correctly, but
`GameSurface` mounts the game content for both loading and ready slots. During
loading, `PlatformerLabContent` receives `slot.session`, which is the idle
placeholder, and renders active movement controls. Pressing one calls
`placeholder.input.press('left' | 'jump' | ...)`, so the loading UI can dispatch
unknown actions or mutate the wrong session. Platformer Lab also ignores the
loading/error/retry `assetState`. In addition, **Jump** binds both `onTouchEnd`
and `onPressOut`; a normal touch can invoke both and dispatch duplicate release
edges because `release()` doesn't check whether the action was still held.

Required approach:

- Put loading and error behavior at the generic asset boundary. Don't mount
  gameplay content with the placeholder session, or render a generic blocking
  loading/error overlay that prevents every gameplay control from receiving
  touches and exposes retry/back behavior.
- Publish gameplay content only with the ready session and matching asset
  lease. Preserve the existing request-ID and retirement rules.
- Make `release(action)` dispatch only when `heldActions.delete(action)` returns
  true. Apply the same cancel-safe lifecycle consistently to every held
  control.
- Add a mounted shell test that opens Platformer Lab, presses where a control
  would be while loading, and proves no placeholder input is dispatched. Then
  deliver ready assets and prove the same control reaches the gameplay session.
- Add loading-error-retry and close-while-error coverage, plus a touch sequence
  that invokes both `onTouchEnd` and `onPressOut` but produces one release edge.

## Third follow-up feedback

This isolated review covers only the repairs in `cb74f81`. The split warning
and window-request guards in T16-SF1 are correct. Keep that implementation and
address the two remaining findings below.

### T16-TF1 — Rotated capacity is still wrong for non-square cells (High)

`TileMap2D` intentionally supports independent `cellSize.width` and
`cellSize.height`, but the new capacity formula adds only
`overscan * 2` slots to each axis while `writeLayerVisibleBounds()` expands
both axes by `overscan * max(cellWidth, cellHeight)` world units. Those two
contracts agree only for square cells.

For example, with 8x64 cells, a 320x480 viewport, `minZoom={1}`,
`overscan={1}`, and a 45-degree camera, the X bounds gain 64 world units on
each side—eight X cells per side—but the X buffer reserves only one overscan
cell per side. `fillTileSlots()` then returns `-2` and hides the whole layer at
a valid zoom. The never-partial guard is safe, but a supported map can become
blank even though the documented capacity contract says it fits.

Required approach:

- Freeze overscan as a number of cells per axis, not one scalar world distance
  based on the larger cell dimension.
- Prefer extending the bounds writer to accept independent X/Y padding and
  pass `overscan * cellWidth` and `overscan * cellHeight`. If the scalar
  padding contract is retained, size each axis from that exact scalar padding:
  `ceil((diagonal / minZoom + 2 * paddingWorld) / cellAxis) + 1`.
- Derive buffer capacity and visible bounds from one shared formula/contract so
  they cannot drift again.
- Preserve the `-2` preflight as a defensive fail-closed path; do not weaken it
  or return a partial Atlas.
- Add fully occupied rotated-camera tests using both 8x64 and 64x8 cells on
  phone and tablet viewports at `zoom === minZoom`. Assert the complete visible
  span renders rather than merely asserting a positive fill count.
- Include a non-rotated non-square case so the tests distinguish overscan math
  from rotation math.

### T16-TF2 — The claimed T16-SF3 regression tests do not exist (Important)

The implementation now selects `AssetGateOverlay` while the slot is loading,
and `release()` correctly checks `heldActions.delete(action)`. However, the
commit adds no mounted shell test for the loading gate, ready handoff,
error/retry, or close-while-error flows. The existing Platformer Lab control
test also invokes `onTouchCancel` and `onPressOut` separately; it never invokes
the real duplicate sequence of `onTouchEnd` followed by `onPressOut`.

The Task 16 resolution summary currently says all of those behaviors are
covered, so the completion record is ahead of the evidence.

Required approach:

- Add a focused mounted test around the real `GameSurface`/asset-gate
  composition, extracting that internal component into a focused module if
  necessary to avoid mocking the entire application.
- Mount a loading slot and prove gameplay `Content` is not mounted, the
  placeholder input receives no control action, and Back remains usable.
- Publish an error state and prove the error UI renders, Retry calls the exact
  active request's retry function once, and Back/close remains safe.
- Publish the matching ready slot and prove the gate unmounts and `Content`
  receives the real session and matching lease. Include a stale request state
  that must not open gameplay content.
- Extend the existing Platformer Lab mounted control test to call
  `onPressIn`, then both `onTouchEnd` and `onPressOut`, and assert exactly one
  release edge. Repeat a second press to prove the held state was cleared.
- Update the third follow-up resolution summary only after these named tests
  exist and fail against the pre-fix behavior.

## Fourth follow-up feedback

This isolated review covers only `a31c6db`. T16-TF1's capacity math and its
non-square complete-span tests are consistent with the chosen scalar-padding
contract. The real duplicate `onTouchEnd` plus `onPressOut` sequence is also
covered. One verification gap remains.

### T16-VF1 — The real GameSurface gate is still not mounted-tested (Important)

`assetGate.test.tsx` mounts `AssetGateOverlay` by itself, proving only that the
overlay displays a spinner/error and invokes its callbacks. The existing
`surfaceController` tests prove that the controller publishes loading and ready
slots, but they never render `GameSurface`.

No test currently exercises the conditional in `PlaygroundShell.tsx` that must
choose the overlay instead of `Content` while loading and then hand the real
session/lease to `Content` when ready. Removing or reversing that conditional
would allow the original placeholder-session bug to return while both test
suites remained green. The resolution summary's claim that this composition is
verified is therefore not yet supported.

Required approach:

- Extract `GameSurface` into a focused internal module, or export a test-only
  internal seam that mounts the real component without mounting the entire
  playground application. Do not replace the component decision with a test
  replica.
- Mount a real loading `SurfaceSlot` with a spy `Content`. Assert the overlay
  is present, `Content` is not mounted, and the placeholder session receives no
  gameplay input.
- Rerender the same mounted surface with the matching ready slot. Assert the
  overlay disappears and `Content` mounts exactly once with the ready session
  and exact asset lease.
- Rerender with an error state for the active request and prove Retry and Back
  reach the active callbacks while gameplay content remains absent.
- Include a stale asset state/request ID and prove it cannot supply error,
  retry, or ready data to the current surface.
- Make the test fail against the original loading-and-content composition from
  before `cb74f81`; do not rely only on source-text assertions.
- Correct the fourth follow-up resolution summary only after this mounted
  composition test exists.

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
