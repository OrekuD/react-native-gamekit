# Geometry implementation review — 2026-10-29

Geometry supplies renderer-neutral points, directions, and bounds for game rules.
Keep the small immutable helpers and their existing signatures. This slice fixes
normalization and structured input errors, removes duplicate scalar validation,
and publishes the numeric contract. It follows [system 07](07-geometry.md) from
main `4c53b13`, after viewport PR #7 and Camera2D PR #8 merged. Collision2D (08)
is next.

## Findings and fixes

| Trigger | Before | After |
| --- | --- | --- |
| Normalize `{ x: Number.MAX_VALUE, y: Number.MAX_VALUE }` | Length overflows; result is `{ x: 0, y: 0 }`, losing direction. | Rescale components before normalization when length overflows; result is approximately `{ x: 0.7071, y: 0.7071 }`. |
| Normalize `{ x: Number.MIN_VALUE, y: Number.MIN_VALUE }` | Rounded subnormal length produces `{ x: 1, y: 1 }`, whose length is about 1.414. | The same scaled fallback produces a unit direction. |
| Expand a valid box with `null` or `undefined` inset from untyped data | Field access throws incidental `TypeError`. | Validate inset shape first; throw `GeometryError` with `GEOMETRY_INVALID_SHAPE` at `inset`. |
| Use an array/function with numeric `x`/`y` as inset | Expansion accepts a shape other geometry operations reject. | Consistent record validation rejects it. |
| Invalid numeric component/scalar contains a null-prototype object or throwing conversion hook | Error formatting throws or runs caller code instead of constructing the intended error. | Shared diagnostics describe objects/functions without coercing them; code and field stay structured. |

Normalization retains the original `Math.hypot` and division path for normal
finite lengths. Only overflow or a positive length below `2 ** -1022` uses the
fallback. Scaling by the largest absolute component makes the scaled length lie
between one and the square root of two. Zero still produces a fresh frozen zero
vector. Tests check the normal/subnormal threshold neighbors, signed/asymmetric
vectors, mixed magnitudes, direction, unit length, and immutability.

The outer shape guards described in the original brief were already implemented
on main. This work completes the inset path and error formatting; it does not
claim to introduce all geometry validation.

## Numeric policy and API decisions

The input contract remains finite components and nonnegative sizes. General
arithmetic targets ordinary game-world magnitudes: finite operands alone do not
guarantee representable intermediate or final results. Addition, subtraction,
scaling, translation, center, union, length, and distance do not gain derived
overflow checks in this PR. `expandAabb2D` already validates its result because
shrinking may make dimensions negative; it also rejects nonfinite results.
Normalization is strengthened because a unit direction is representable even
when the original length is not.

This deliberately avoids new throwing behavior throughout existing arithmetic
callers. It also avoids changing union's operation order and ordinary rounding
to support extreme absolute edges. Callers should choose world units that leave
enough precision for their movements. The public [Geometry guide](../../apps/docs/content/docs/engine-systems/geometry.mdx)
now makes these distinctions explicit rather than leaving the policy in source
comments. The numerical review checked the language definitions for
[Math.hypot](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.hypot)
and [Number.MIN_VALUE](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.min_value);
the concrete failures above were reproduced locally.

### Before / after at call sites

```ts
const direction = normalizeVector2D({ x: Number.MAX_VALUE, y: Number.MAX_VALUE });
// Before: zero direction. After: a finite unit direction.

const hitArea = expandAabb2D(box, inset);
// Valid typed calls are unchanged. Invalid untyped insets now identify
// `inset` or its component in GeometryError instead of throwing TypeError.
```

For error handling, prefer the public `GeometryError.code` and `.field` to parsing
message strings. Human-readable diagnostics may change; object conversion hooks
are never needed to report invalid data. Caller-provided property getters and
proxy traps can still throw their own exceptions. This is a data-validation
contract, not an attempt to sandbox arbitrary JavaScript objects.

### Recommendation: retain names and signatures

The current consumers do not justify vector classes, overload growth, mutable
output buffers, or new constructors. Immutable results work with scene snapshots;
root and subpath exports stay identical. The API reference now lists the geometry
helpers, links their numeric limits, and distinguishes geometry from collision.

One possible future gap is validating imported `unknown` geometry without an
unchecked cast. A narrow proposal would be `parseVector2D(value: unknown): Vector2D`
(and matching shape parsers when a real importer needs them):

```ts
// Before, in a hypothetical JSON importer:
const vector = raw as Vector2D; // a cast does not validate

// Proposed, NOT implemented:
const vector = parseVector2D(raw); // validate and return an owned frozen copy
```

That would improve boundary typing while preserving the small arithmetic API.
Do not export the current internal validators wholesale or add this parser family
without a reference-game/importer use case; doing so would make another permanent
public surface without serving an existing caller.

## Performance and ownership

These are synchronous headless helpers, normally called on RN by scene rules or
preparation. They own no clocks, subscriptions, React state, or UI shared values.
They are not worklet APIs. Rendering/input/culling ownership does not change.

`expandAabb2D` previously validated the same scalar inset twice; it now checks it
once. Vector insets validate both fields and their outer shape. Duplicate finite
validation/error construction in expansion and scaling is replaced with the
shared validator. The normalization fallback uses scalar temporaries and still
allocates exactly one frozen result; ordinary lengths retain their prior math.

The only production arithmetic-helper consumer found is Brick Breaker's paddle
hit-slop expansion. Shared validators also serve camera, collision, and tilemap
code. No device trace identifies these helpers as an FPS bottleneck, so this
review makes **no FPS or latency claim**. It retains public frozen outputs and
does not add pooling, caching, worklet traversal, or per-result validation to
unrelated helpers. The scalar check count is a source-confirmed reduction, not
a measured whole-frame improvement.

## Validation and integration

- Test first: five numeric and four boundary regressions failed before their
  implementations. The combined focused suite now passes **24 tests**.
- Numeric tests span an 81-pair magnitude matrix, mixed signs, unequal tiny
  components, threshold neighbors, signed zero, frozen/fresh outputs, and
  unchanged inputs. Ordinary `(3, 4)` and zero results remain exact.
- Boundary tests cover null/undefined, scalar/array/function shapes, missing
  fields, nonfinite numbers, bigint/symbol/boxed-number values, hostile coercion
  hooks, and nested segment paths. Camera and collision entry calls demonstrate
  the shared validator fix beyond direct unit tests.
- Focused coverage: helpers **94.81% lines / 95.45% branches / 100% functions**;
  validation **96.43 / 95.92 / 100**. Helpers now join validation in the existing
  80% line coverage gate. Branch/function metrics are reported separately.
- Independent review found no correctness, security, API, or documentation
  blockers. Existing export inventory, entry isolation, and built public API
  fixtures protect unchanged signatures and native-free imports.
- `pnpm check` passed: workspace lint/typecheck, **1,181 library tests**, **309
  playground tests** (254 headless and 55 mounted), library/docs builds, and the iOS Hermes export. The built
  public API fixture command and expanded coverage gate also passed.

Full validation also exposed a merge integration issue: PR #7's viewport tests
lacked the `makeMutable` and `scheduleOnUI` mock exports introduced by PR #8.
All four mounted viewport tests failed before the two missing mock exports were
added, then passed. This is a test-only compatibility fix with no runtime or
workflow changes.

Registry audit reports the existing 52 advisories (6 critical, 35 high, 9 moderate,
2 low) on the unchanged dependency graph. No dependency versions or lock entries
change. Installed compatibility validation passes for RN 0.86.3, Expo 57.0.25,
Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, and RNGH 3.1.0.

## Follow-ups outside this slice

Collision2D still has consumer-local outer-shape paths to review, including null
filter/config/offset records before shared validation. Camera helpers also have
some local diagnostic formatting outside the shared validator (for example the
strict camera clone's zoom/rotation errors). This PR does not imply those paths
are covered by the new geometry guarantees.

Native Hermes behavior and device performance were not profiled. If future work
optimizes geometry in a hot loop, first capture a release/debugOptimized Brick
Breaker or representative bulk-query trace on 60 Hz Android and 120 Hz iOS with
simulation cost, allocations, and frame pacing. A Node arithmetic test is not a
device benchmark.
