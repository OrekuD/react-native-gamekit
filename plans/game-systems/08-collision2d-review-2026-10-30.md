# Collision2D implementation review — 2026-10-30

Collision2D answers contact, sweep, and candidate queries; scene rules own the
response. Keep the existing shape-pair functions, deterministic normals and tie
rules, and immutable public results. This slice follows
[system 08](08-collision2d.md) on main `f9100d5`, after Geometry PR #9 merged.
The next core system is **09 — Assets and loading**.

## Confirmed defects and fixes

| Trigger | Before | After |
| --- | --- | --- |
| Call public `closestPointOnAabb2D` with a malformed point or box | Nonfinite coordinates/negative dimensions could produce invalid output; valid output was mutable. | Validate both inputs and return a fresh frozen point. |
| Place a structurally typed local collider with a mutable filter | Frozen world collider retained the caller's filter; later caller edits changed collision eligibility. | Placement owns a frozen copy of filter bits. |
| Pass null options, offsets, filters, or debug hit records | Field access/destructuring could throw an incidental `TypeError`. | Shared record guards run before field access, with `GeometryError.code` and `.field`. |
| Pass a world collider to placement, or an unknown shape tag to a world operation | Untyped data could be translated twice or treated as a circle. | Validate local/world space and supported shape tags before dispatch. |
| Combine invalid world geometry with an excluding filter | Filter mismatch hid invalid geometry as an ordinary miss. | Validate both colliders before checking eligibility. |
| Build an index with invalid IDs or extended bounds records | Non-string IDs could escape through a `readonly string[]`; shallow bounds copies retained caller extensions. | Require string IDs and copy only the four canonical AABB fields. |
| Build many overlapping items, each within its own cell limit | A small set of cells could hold millions of references. | Preflight the complete build against a 262,144-reference budget before filling buckets. |

Constructors, placement, world views, and debug projection validate the consumed
geometry and declared metadata. Optional IDs/labels are strings, sensors are
booleans, and filters contain unsigned 32-bit bits. An absent optional field is
valid; `null` is not a substitute for an absent filter. Empty string IDs remain
valid. Invalid plain data is rejected without invoking object conversion hooks.
Caller-provided getters/proxy traps can still throw, as documented by Geometry.

Several findings in the original brief were already fixed on main: exterior
contact points were frozen, per-item/query total-cell limits existed, the order
map was retained directly, and sweep comments distinguished AABB allocations.
This review does not claim those earlier changes as new. Segment and sweep
arithmetic stays intact, including starting overlap, parallel boundary grazing,
rounded circle corners, and deterministic ties.

## Work bounds and performance

The old per-axis limit (1,024) and per-item/query limit (65,536) did not bound
aggregate references. A reproduced build with 1,024 overlapping items covering
1,024 cells each stored **1,048,576 references** despite satisfying both guards.
On the local desktop Node run it took approximately 58 ms to build and 12 ms to
query. These observations identify excessive work; they are not device timings.

The new fixed cap is **262,144 cell references**, counting every item-cell pair.
It allows four maximum-span items and substantial headroom above the existing
dense benchmark's 4,096 references. This is an engineering resource cap, not a
frame-time promise. The early item-count guard follows from every item occupying
at least one cell. Build preflight validates spans and sums references before
bucket insertion; it still performs bounded input validation and snapshot work.

The implementation removes per-cell generator/result objects and the copied
private cell map/entry arrays. Locally constructed bucket arrays are frozen and
retained by the private WeakMap; no caller can mutate them. Queries preserve
deduplication and insertion-order sorting. Circle/AABB manifolds compute scalar
closest coordinates, avoiding the temporary closest-point object on every miss
and the extra copy on hits. World collider dispatch passes compatible records
directly to the public manifolds, avoiding two temporary shape objects per pair.
Public validation and frozen output ownership remain in place.

The benchmark now reports deterministic cell/reference/candidate counts and
warmed build/query median and p95 values. Any heap delta is explicitly GC-noisy;
it is not an allocation count. The same harness ran against a saved pre-change
module and the new implementation, without concurrent workspace builds. Host:
Node 24.19.0, macOS arm64. Builds use 10 warmups/50 samples, queries use 25
warmups/200 samples. Times below are milliseconds; they are local observations,
not timing assertions in CI.

| Build workload | References | Before median / p95 | After median / p95 |
| --- | ---: | ---: | ---: |
| Sparse, 200 items | 375 | 0.0886 / 0.2558 | 0.0649 / 0.2655 |
| Dense, 32 × 32 items | 4,096 | 0.5032 / 0.9728 | 0.3175 / 1.0273 |
| 256 overlapping items | 65,536 | 3.1484 / 4.0481 | 2.0655 / 2.9460 |
| 1,024 overlapping items, at the new cap | 262,144 | 13.1618 / 16.7282 | 8.0588 / 10.5088 |

| Query workload | Cells / scanned references / candidates | Before median / p95 | After median / p95 |
| --- | ---: | ---: | ---: |
| Sparse, 640 × 480 bounds | 88 / 13 / 7 | 0.0053 / 0.0092 | 0.0030 / 0.0077 |
| Dense, full world | 1,089 / 4,096 / 1,024 | 0.1469 / 0.1837 | 0.1244 / 0.1654 |
| At the aggregate cap | 256 / 262,144 / 1,024 | 3.1066 / 3.3229 | 2.8713 / 3.2140 |

Sparse/dense build p95 is slightly worse despite lower medians; do not interpret
these results as a universal latency improvement. The former 1,048,576-reference
case built in 55.5079 ms median / 57.9986 ms p95 and is now rejected in a single
0.1405 ms observation during preflight. Even an accepted cap-sized build can
consume much of a frame budget, reinforcing that the limit is a resource guard.

Reproduce with `pnpm --filter rn-gamekit bench:spatialhash`; pass
`--module /absolute/path/to/baseline-spatialHash.ts` to run the identical fixtures
against a saved baseline whose relative imports have been resolved. The harness
checks candidate counts against an independent cell-overlap calculation. The
regressions also compare candidates against that rule for 120 deterministic
queries spanning negative and fractional coordinates.

## API decisions and before/after examples

Existing valid call signatures and root/subpath exports remain unchanged. The
runtime contract now matches the existing TypeScript types more closely:

```ts
const world = placeCollider2D(local, position);
// Before: a caller-created local.filter could still change world.filter.
// After: world owns its filter, just like factory-created collider data.

const point = closestPointOnAabb2D(pointer, bounds);
// Before: readonly typing concealed a mutable runtime object.
// After: a fresh frozen point, consistent with other geometry outputs.

const index = buildSpatialHash2D({ items, cellSize: 32 });
// Before: individually small spans could add up to unbounded references.
// After: oversized aggregate work throws GEOMETRY_SPATIAL_INDEX_RANGE.
```

Oversized worlds may need a different cell size or separate indexes for level
regions. Increasing cell size reduces references but can increase narrow-phase
candidates. Static bounds can reuse an index; moving indexed bounds require a
rebuild. Collision Lab's moving projectile therefore still triggers rebuilding.
An index is a process-local handle backed by private storage. JSON, structured
cloning, and spreading its visible fields do not preserve queryability; store
source items for replay and rebuild it outside render snapshots.

Two API improvements remain proposals, rather than new surface without a
consumer need:

| Before | Proposed after | Why / tradeoff |
| --- | --- | --- |
| `placeCollider2D(circleCollider2D(...), position)` returns the world union, requiring a `shape` check to access `radius`. | Shape-preserving overloads return `WorldCircleCollider2D` for a local circle and `WorldAabbCollider2D` for a local AABB; retain a union overload. | Removes redundant narrowing for known shapes without changing runtime behavior. Defer until a caller benefits. |
| The structurally typed `SpatialHashIndex2D` can describe a plain record that runtime queries reject. | Give the index type a private brand and require callers to retain the builder's handle. | Better compile-time guidance, but structural typing of stored/copied handles changes and TypeScript branding alone cannot prevent every clone operation. Runtime WeakMap checks remain necessary. |

Keep the resource limit fixed in this slice. A configurable budget would need
measured large-level requirements and an explicit maximum; an unchecked override
would reintroduce the work-bound problem.

## Ownership and validation

Queries execute synchronously in the headless simulation/runtime that calls
them. They add no React state, timers, subscriptions, UI crossings, or native
resources. The spatial handle belongs to that runtime; render snapshots contain
only projected presentation data. Existing Collision Lab and Brick Breaker
integration tests exercise game behavior and mounted UI contracts.

- Test-first reproductions failed before the fixes: four query-contract tests,
  nine collider/debug boundary tests, and five spatial budget/ownership tests.
  All pass after implementation. Exact-budget and one-reference-over tests
  cover overlap accounting; oversized item arrays reject before item access.
- `pnpm check` passed: lint, all workspace typechecks, **1,206 library tests**,
  **309 playground tests** (254 headless and 55 mounted), library/docs builds,
  and the iOS Hermes export. Dependency tooling adds 61 passing tests.
- Built public API fixtures passed. Signatures, export inventory, and native-free
  subpath isolation remain covered by the existing suite.
- The expanded coverage gate passed with all eight changed Collision2D modules
  included: **98.4–100% lines**, **87.5–97.8% branches**, and **100% functions**.
  As before, the gate enforces 80% lines for its listed modules, not a
  repository-wide branch/function threshold.
- Independent review found no confirmed correctness, security, ownership, or
  API blocker. The cap-sized workload remains potentially expensive, as
  documented above; accepted inputs are not promised to fit a frame budget.
- Registry audit reports the existing **52 advisories** (6 critical, 35 high,
  9 moderate, 2 low) on the unchanged dependency graph. No package versions or
  lock entries changed. Installed compatibility validation passes for RN
  0.86.3, Expo 57.0.25, Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, and
  Gesture Handler 3.1.0.

Native Hermes/UI/device frame pacing remains unmeasured. To assess FPS impact,
run the same sparse/dense/overlapping distributions in a release or
`debugOptimized` Collision Lab workload on representative 60 Hz Android and
120 Hz iOS devices; capture simulation/query time, allocations, candidates,
missed frames, and frame pacing. The Node benchmark is a reproducible algorithm
comparison, not a native performance acceptance gate.
