# Collision2D: predicates, contacts, sweeps, and broad phase

## Purpose and verdict

Answer geometry queries with deterministic semantics; leave gameplay response to the caller. **Keep the separation between predicates, manifolds, continuous sweeps, and a static broad phase.** A rigid-body engine is neither implemented nor required for these repairs; [T18 evaluation](../task-18.md) records a no-go, not an unfinished shipping collision feature.

Sources: [predicates](../../packages/gamekit/src/collision2d/intersections.ts), [manifolds](../../packages/gamekit/src/collision2d/manifolds.ts), [sweeps](../../packages/gamekit/src/collision2d/sweeps.ts), [colliders](../../packages/gamekit/src/collision2d/colliders.ts), [spatial hash](../../packages/gamekit/src/collision2d/spatialHash.ts), [debug projection](../../packages/gamekit/src/collision2d/debug.ts).

## What is already good

Contact normals consistently resolve the first argument. Containment, exact circle/rounded-corner sweeps, filter symmetry, and deterministic ties have dedicated regression tests. Spatial-hash buckets are private and candidates retain insertion order. Debug data is presentation-only. Keep these semantics and the substantial existing collision test suite.

## GS-COLLISION-01 — P2: exterior circle/AABB contact points remain mutable

**Evidence: reproduced.** `collideCircleAabb2D({x:-1,y:5,radius:2}, {x:0,y:0,width:10,height:10})` returns a frozen hit with an **unfrozen `point`**. `closestPointOnAabb2D` returns a mutable object; the exterior manifold reuses it directly. Starting-overlap sweep results can expose the same point through `hitFromManifold`.

**Resolve:** freeze/copy the point at the public result construction boundary. Prefer one local fix that covers the exterior branch and all wrappers; do not deep-freeze every collision input or allocate objects for predicate misses. Audit all public hit/debug outputs for the same nested ownership promise.

**Acceptance:** exterior, interior, tangent, mixed collider wrapper, and starting-overlap sweep results have immutable nested points/normals and do not freeze caller-owned objects. Add this case to [collision2d.immutability.test.ts](../../packages/gamekit/test/collision2d.immutability.test.ts).

## GS-COLLISION-02 — P2 performance guard: the spatial span limit permits very large work

**Evidence: source-confirmed complexity, no device timing measured.** A 1024-cell cap applies independently to each axis, allowing over one million cell visits for one item/query. There is no total cell-reference budget across items. Each visit creates a generator result/cell object and string key; a build duplicates maps again to freeze buckets. Query deduplication then sorts candidates by insertion order.

**Resolve:** measure realistic sparse/dense levels first. Add a total occupied-cell/work budget if public inputs can reach impractical spans; a per-axis bound alone is not a mobile latency bound. Prefer choosing an appropriate cell size and reusing static indexes. Avoid rebuilding an immutable index for every dynamic body each tick. Remove the redundant `new Map(order)` copy if it has no ownership purpose after verifying `order` never escapes or changes.

**Acceptance:** construction and query fail clearly before oversized total work; tests preserve boundary inclusion and deterministic order. Benchmarks include cell visits, total references, candidates, allocations, and p95 cost for static sparse and dense worlds. Do not claim a speedup based only on fewer candidate IDs.

## GS-COLLISION-03 — P3: correct blanket allocation claims

**Evidence: source-confirmed.** Circle sweep misses avoid candidate object construction, but `sweepAabbAabb2D` allocates an expanded box, segment endpoints, and the segment helper's axis array even on misses. “Misses allocate nothing” in the module header therefore does not cover both APIs.

**Resolve:** narrow the comment immediately in the implementation task. Only replace the AABB path with scalar slab arithmetic if a representative miss-heavy benchmark makes this material. Keep grazing, starting-overlap, zero-displacement, and tie rules intact; do not copy circle sweep complexity into the AABB path unnecessarily.

## Scope boundaries

The index is an opaque process-local handle backed by a WeakMap; cloning/serializing it does not preserve queryability. Document this if exposing it to workers/replay tooling. Do not move it into renderer snapshots. Broader untyped/overflow input policy belongs to [geometry](07-geometry.md); do not repeat that work independently here.
