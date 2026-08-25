# Task 18 / T18.0 — Physics2D backend evaluation and go/no-go record

Status: **Complete — documented NO-GO for shipping a v1 adapter.** Evaluation
date: 2026-08-24. Evidence gathered from the npm registry (publish metadata),
package manifests, and a reproducible headless transaction-strategy spike
(`packages/gamekit/scripts/spike-physics2d.mjs`). No backend was installed as a
production dependency; `planck@1.5.0` is pinned in devDependencies solely to
keep the spike reproducible.

This record satisfies the T18.0 acceptance alternative: *"the task records
no-go and stops without a production dependency."* Task 11 Collision2D remains
the default and only collision path.

## 1. Candidate registry evidence

Publish metadata pulled directly from `registry.npmjs.org` on 2026-08-24
(release recency window: trailing 18 months):

| Backend | Latest | Last publish | Releases (18 mo) | License | Ships TS types | Runtime | Static verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@dimforge/rapier2d-compat` | 0.20.0 | 2026-08-08 | 46 | Apache-2.0 | yes | WebAssembly (base64 embedded) | Fails Expo/Hermes gate |
| `planck` (planck.js) | 1.5.0 | 2026-04-07 | 3 | MIT | yes | Pure JS, zero deps | Passes static gates |
| `matter-js` | 0.20.0 | 2024-06-23 | 0 | MIT | **no bundled types** | Pure JS | Fails maintenance + TypeScript gates |
| `box2d-wasm` | 7.0.0 | 2021-11-28 | 0 | Zlib | yes | WebAssembly | Fails maintenance + Expo/Hermes gates |
| `p2.js` | 0.7.1 | 2015-11-21 | 0 | **none declared** | no | Pure JS | Fails maintenance + licensing gates |

### Gate analysis

**Expo/Hermes gate.** Hermes does not implement WebAssembly. Every
WASM-distributed backend (`rapier2d-compat`, `box2d-wasm`) therefore cannot run
in a stock Expo prebuild / Hermes app. Using them would require authoring and
maintaining custom JSI native modules plus cross-platform ABI builds — an
unreviewed binary-distribution surface the task explicitly rules out for v1.
Both are rejected on this gate regardless of their excellent maintenance
(Rapier's 46 releases in 18 months notwithstanding).

**Maintenance gate.** `p2.js` (last release 2015, no license field) and
`box2d-wasm` (none since 2021) are disqualified outright. `matter-js` has had
zero releases in the trailing 26 months and ships no TypeScript definitions;
both required-evidence bullets fail.

**TypeScript gate.** Only `planck.js` and the two WASM candidates ship types.
Combined with the other gates this leaves **planck.js 1.5.0** as the sole
surviving candidate.

## 2. Transaction strategy 2 — failure-tested prototype

Planck.js exposes no world snapshot/restore API, so strategy 3 is unavailable.
Strategy 1 (dedicated GameSession transaction phase) remains possible but
requires the session-core change reserved for an approved adapter effort. The
spike implements and FAILURE-TESTS **strategy 2**: keep an immutable prior
`PhysicsState2D` body projection; on any failed tick/commit, rebuild the
private world from that projection before the next accepted step.

### Projection contract exercised

Stable body/shape IDs, body type, full transform (x/y/angle), linear and
angular velocity, awake state, gravity scale, fixed rotation, and per-shape
geometry plus live-read fixture material (density, friction, restitution,
sensor). Bodies are rebuilt in original creation order via private ordering
metadata; publication sorts by game-owned ID.

### Equivalence protocol (all Node-only)

Two identically seeded worlds advance through an identical command stream to a
committed state (240 steps). The candidate takes one further commanded tick,
then SIMULATES A FAILURE: its stepped state is discarded and it is rebuilt from
the saved prior projection. Requirements:

1. **Exact restoration** — rebuilt projection must equal the untouched
   control's projection field-for-field (passes).
2. **Bounded continuation** — both worlds then advance through identical
   subsequent commands; per-step positional/velocity divergence is measured and
   reported. Measured transient max ≈ 0.55 world units in this deliberately
   chaotic regime (128 tumbling stacked boxes, impulses every step). Root
   cause is understood and documented: a rebuild cannot carry solver WARM-START
   contact impulses, so the restored world re-acquires contacts with fresh
   solver state and individual contact begin/end events reshuffle during the
   transient window. An adapter must therefore suppress contact-event
   publication on the restore step.
3. **No lasting effect (convergence)** — with commands stopped, both worlds
   settle to the SAME resting configuration: max final position delta
   ≤ 0.05 units (measured ≈ 0.017–0.019) with matching sleep states
   (passes). This is the property the release gate actually requires: the
   backend is never ahead of committed state, and the failed tick leaves no
   permanent divergence.
4. **Negative controls** — omitting `angularVelocity` or fixture
   `restitution` from the projection makes the equivalence fail immediately
   and correctly (both verified).

An additional settled-snapshot variant (900 quiet steps → snapshot → restore)
and a settling-continuation variant both pass identically.

### Timings (Node v24.19.0 — NOT device evidence)

Rebuild-from-projection over warmup + 40 samples per size:

| Bodies | Rebuild p50 | p95 | p99 |
| --- | --- | --- | --- |
| 32 | 0.049 ms | 0.065 ms | 0.089 ms |
| 128 | 0.146 ms | 0.189 ms | 2.4 ms |
| 512 | 0.517 ms | 6.95 ms | 7.7 ms |

Step cost with enforced activity counters (minimum awake count reported;
contact-begin totals recorded so "contact-heavy" is measurable):

| World | Bodies | Step p50 | p95 | p99 | min awake | contact begins |
| --- | --- | --- | --- | --- | --- | --- |
| Contact-heavy | 32 | 0.081 ms | 0.113 ms | 0.170 ms | 33 | 1135 |
| Contact-heavy | 128 | 0.347 ms | 0.411 ms | 1.102 ms | 129 | 367 |
| Contact-heavy | 512 | 1.454 ms | 1.682 ms | 1.983 ms | 513 | 609 |

Strategy 2 is proven viable headlessly: state-exact restore, bounded transient,
convergent outcomes, sub-millisecond-to-low-ms failure-path cost at v1 scale —
with the warm-start artifact documented as an adapter obligation (suppress
contact events on the restore step). Device performance remains unproven and
is covered by the frozen budgets below.

## 3. Frozen v1 budgets (device-measured, for any future reopening)

Any future go decision requires ALL of these, measured on release-like builds
on named iPhone/iPad/Android hardware against `planck.js@1.5.x`:

- Initialization/startup: ≤ 150 ms added cold start.
- Bundle delta: ≤ 120 KB min+gzip JavaScript; zero native binary delta (pure-JS
  backend).
- Fixed-step cost: p95 ≤ 4 ms @ 128 bodies; p95 ≤ 10 ms @ 512 bodies
  (contact-heavy scene), leaving ≥ 40 % frame headroom at 60 Hz.
- Restore cost (strategy 2): ≤ 8 ms @ 512 bodies per failed tick.
- Memory: ≤ 30 MB retained for a 512-body world after 10-minute soak; teardown
  returns allocations with zero retained handles across Fast Refresh,
  backgrounding, replacement, and disposal.
- Presentation: stable 60 Hz simulation alongside 60/120 Hz presentation.

## 4. Go/no-go decision

**NO-GO for shipping a v1 Physics2D adapter.** Rationale:

1. Four of five evaluated backends fail hard gates (Hermes/WASM, maintenance,
   licensing, TypeScript). Only `planck.js 1.5.0` survives static evaluation.
2. The task makes the physical-device release-like performance matrix a
   mandatory gate for any GO. That matrix requires iPhone/iPad/Android
   hardware that this repository's current environment does not have; per the
   repo-wide honest-device-gating policy these rows cannot be claimed.
3. Node-only spike numbers (above) are promising but explicitly non-transferable
   to Hermes/device performance; citing them as a GO would violate the frozen
   budget process.

Consequences applied by this record:

- No `rn-gamekit/physics2d` subpath is shipped; no production dependency is
  added; Collision2D remains the sole collision system.
- `planck@1.5.0` stays pinned in `packages/gamekit` devDependencies only so
  `scripts/spike-physics2d.mjs` remains reproducible; nothing in `src/`,
  the export map, or any shipped barrel imports it.
- Reopen trigger: physical-device access becomes available AND the Section 3
  budgets are met by `planck.js` (or a future backend passing the same gates).
  At that point T18.1–T18.6 proceed with planck.js as the designated candidate,
  subject to re-running this entire evaluation.
