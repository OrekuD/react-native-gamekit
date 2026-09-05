# Geometry primitives and helpers

## Purpose and verdict

Provide renderer-neutral points, vectors, AABBs, circles, and segments with small deterministic helpers. **Keep this module substantially as it is.** Its simplicity is valuable; there is no reason to introduce object-oriented vector classes, a transform hierarchy, or a generic math package.

Sources: [types](../../packages/gamekit/src/geometry/types.ts), [helpers](../../packages/gamekit/src/geometry/helpers.ts), [validation](../../packages/gamekit/src/geometry/validation.ts), [public entry](../../packages/gamekit/src/geometry.ts).

## What is already good

- Operations are explicit about inputs and create new output values.
- Negative dimensions and non-finite scalar fields fail through a structured error.
- Zero-vector normalization has defined behavior; `Math.hypot` avoids common length-calculation problems.
- Types are independent of Skia and the native runtime.

## GS-GEOMETRY-01 — P3: align error and numeric claims with the actual supported domain

**Evidence: source-confirmed low-priority boundary limitation.** Validators dereference fields without first checking the outer shape (`point.x`, `segment.start`). A raw `null` argument throws TypeError rather than the advertised GeometryError. Finite inputs can also overflow outputs: vector addition/scaling and AABB translation/union do not validate derived values. `normalizeVector2D` can return a zero vector for huge finite components whose true length overflows.

**Resolve:** decide whether the API guarantees structured errors for arbitrary untyped inputs and for derived overflow. If yes, add small shared outer-shape checks and a documented numeric range/result policy at public boundaries. If no, say validators require the declared structural shape and ordinary game-world magnitudes. Avoid adding repeated defensive traversal to each internal arithmetic call.

**Acceptance:** table-driven null/malformed/overflow cases match the chosen policy; ordinary helper outputs and zero normalization stay unchanged. Add property checks for translation composition and normal-vector length over the supported magnitude range only if changing math.

## Deletion and performance decisions

No production deletion is recommended here now. Small constructors and frozen records are understandable. Allocation-free internal scalar paths belong in measured hot consumers; they do not justify weakening public immutable value semantics or pooling objects returned to callers. Conversely, do not turn every miss predicate into a temporary frozen shape.

Preserve [geometry2d.test.ts](../../packages/gamekit/test/geometry2d.test.ts) and headless entry-isolation/type fixtures. Collision manifold immutability is a separate confirmed defect in [Collision2D](08-collision2d.md), not evidence that all geometry should be redesigned.
