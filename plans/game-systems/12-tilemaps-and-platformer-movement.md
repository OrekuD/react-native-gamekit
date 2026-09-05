# Tilemaps, tile rendering, and platformer movement

## Purpose and verdict

Support finite orthogonal levels with inexpensive local queries, explicit solid/one-way movement, and Atlas drawing. **Keep this focused feature set. Do not expand the Tiled adapter, add general physics, or add streaming infrastructure as part of these fixes.**

Sources: [definitions](../../packages/gamekit/src/tilemap/definitions.ts), [queries](../../packages/gamekit/src/tilemap/queries.ts), [movement](../../packages/gamekit/src/tilemap/movement.ts), [Tiled adapter](../../packages/gamekit/src/tilemap/tiledAdapter.ts), [tile presentation](../../packages/gamekit/src/react/tilemap/tilePresentation.ts), [TileMapLayer2D](../../packages/gamekit/src/react/tilemap/TileMapLayer2D.tsx).

## GS-TILE-01 — P1: tile-window identity does not include its map/layer/source generation

**Evidence: source-confirmed.** `windowSV` survives prop changes. `windowCovers` only compares cell coordinates, so changing the map/layer/source to one with the same dimensions can reuse the old IDs and old `frameFlat` indefinitely. Queued `requestWindow` callbacks capture an old map but write the same shared window without a generation check. The worklet also accesses `layerData.width/height`, capturing an object that includes the full layer data despite comments promising a bounded transfer.

**Resolve:** give the presentation binding an identity derived from map, layer, frame table/source, and capacity-affecting configuration. Reset/hard-cut the window on identity changes and reject old requests before publishing. Extract width/height scalars before creating worklets; inspect the transformed closure to prove the full layer is absent. Keep one pending request per binding and clear it on failures/disposal.

**Acceptance:** replace same-size maps and sources while a request is delayed; no old tile or source rectangle survives. Delivered stale requests cannot overwrite the new window. Inspect actual worklet closure payloads. Test unmount and remount at identical coordinates.

## GS-TILE-02 — P2: one collision eligibility policy is needed

**Evidence: reproduced.** A layer declared `collidable: false` still blocks `movePlatformerBody2D` when included in `collisionLayers`; movement only examines tile collision kinds. The probe stopped at the decorative floor and reported a floor contact. The library validates and preserves a flag that has no effect here.

**Resolve:** choose one authority. Prefer intersecting explicitly selected collision layers with `layer.collidable`, or remove/deprecate the redundant flag if explicit selection is the intended sole authority. Align the adapter, types, docs, and examples. Unknown layer IDs should fail at a binding/public boundary or be explicitly documented as ignored. Do not allow decorative art to unexpectedly become solid.

**Acceptance:** decorative solid-looking tiles do not block under the chosen contract; selected solid and one-way layers still do. Tests cover omitted, duplicate, and unknown layer selections.

## GS-TILE-03 — P2: validate movement/query inputs and own returned contact data

**Evidence: source-confirmed, partly reproduced.** Movement validates only delta time; body geometry, velocity, snap distance, and drop-through values can be malformed/non-finite. Query functions similarly accept invalid bounds/overscan. Contacts and their normals are not frozen although the outer result is frozen; the probe found a mutable floor normal. If no movement occurs, `Object.freeze(body)` freezes the caller's original body. Initial overlap correction also changes the body without contributing to the reported `displacement`, which needs an explicit contract.

**Resolve:** validate author inputs once at public boundaries. Return owned immutable body/contact values in every branch. Define whether reported displacement means requested-motion resolution only or total motion including depenetration; expose/document a separate correction only if a caller needs it. Keep X-then-Y and one-way policies stable.

**Acceptance:** finite output for supported inputs; invalid geometry/velocity/options fail before iteration; no caller object becomes frozen; nested contacts cannot mutate; zero-delta and starting-overlap results follow the documented displacement policy. Fix drop-through so it suppresses one-way floors without unnecessarily disabling snap onto solid floors, if the existing option contract is retained.

## GS-TILE-04 — P2 design review: justify the duplicate dense/chunk representation

**Evidence: source-confirmed cost, no timing measured.** Each layer already retains a dense immutable array. Building a map scans it again into 16×16 typed-array chunks. Queries clamp to the finite map and a bounded local cell range; direct row-major indexing is also bounded and O(1) per cell. Presentation window building already uses dense `layer.data` directly. The chunk index adds a second representation and string lookups, with a benefit mainly for skipping empty chunks.

**Resolve:** compare direct dense-span traversal with current chunk traversal on the actual finite sparse/dense maps. If the index does not improve meaningful scenarios, delete it and update instrumentation/tests that currently require its implementation shape. If sparse skipping wins, keep it but document the tradeoff and cap total authored cells/layers: 8192×8192 per layer plus copies is a large allocation despite per-axis bounds. Do not replace this with a general streaming/chunk manager.

**Acceptance:** equivalent row-major results, identical movement, measured memory and query cost, and a total allocation/work limit if needed. Tests should gate bounded work/results, not mandate a particular data structure forever.

## GS-TILE-05 — P2: make query edge semantics exact and documented

**Evidence: source-confirmed.** `cellsInAabb` subtracts a fixed `1e-9` from the maximum corner. That approximates half-open cells at ordinary sizes but loses very small positive queries and behaves differently at large magnitudes. A zero-sized AABB at a cell boundary returns no cells, while Collision2D uses inclusive contact. Neither policy is inherently wrong, but “AABBs intersect” does not explain the difference.

**Resolve:** specify half-open tile-area versus point-query behavior and use arithmetic that matches it, such as ceil(max/cell)-1 for positive extents with explicit zero-size handling. Do not share a magic epsilon between cell indexing and physical contact tolerances. Recheck exact endpoint floor/wall contact in movement after the change.

**Acceptance:** exact boundaries, tiny positive extents, negative origin, zero sizes, large ordinary world coordinates, and endpoint movement produce the intended cells/contacts.

## Rendering and remaining scope

Keep visible windows, matching culling/parallax factors, and explicit minZoom capacity. Define width/height units relative to the resolved logical view and enforce a practical maximum capacity before allocating native buffers. “Bounded by viewport” is not enough when minZoom approaches zero. Verify [GS-REACT-03](03-react-presentation.md) for native slot publication. The adapter's deliberately rejected features should remain rejected; audit unsupported authored fields against the supported subset before promising broader Tiled compatibility.

Preserve `tilemap.core`, `tilemap.findings`, `tileMapView.contract`, and platformer reference-game tests. Native tests must exercise a fixed camera with tile/source replacement, window edges under RN stalls, non-square cells, rotation, zoom, and no-camera rendering.
