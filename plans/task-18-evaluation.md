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

## 2. Transaction strategy 2 — prototyped and REJECTED

Planck.js exposes no world snapshot/restore API, so strategy 3 is unavailable.
Strategy 1 (a dedicated GameSession transaction phase able to commit or restore
backend state atomically) remains possible in principle but requires a separate
approved session-core design and is UNPROVEN. The spike implemented and
failure-tested **strategy 2** (rebuild the private world from an immutable
prior projection on tick failure) — and it is **REJECTED**:

> Strategy 2 reconstructs every projected public field exactly, but it FAILS
> authoritative continuation equivalence because planck's private solver /
> warm-start contact state cannot be projected or rebuilt. Under identical
> subsequent commands the restored world diverges by ~0.55 world units
> (> the 0.25-unit budget at continuation step 1) and produces reordered
> contact begin/end records from step 0. Those are gameplay-observable
> differences after a tick that was supposed to have no effect.

### Projection contract exercised

Stable body/shape IDs, body type, full transform (x/y/angle), linear and
angular velocity, awake state, gravity scale, fixed rotation, and per-shape
geometry plus live-read fixture material (density, friction, restitution,
sensor); bodies rebuilt in original creation order via private ordering
metadata. This is everything the proposed v1 public model can express — and it
is demonstrably NOT the backend's complete transaction state.

### Trial protocol and measured outcome (Node v24.19.0 only)

Two identically seeded worlds (128 stacked dynamic boxes on static ground)
advance through an identical command stream for 240 steps. The candidate takes
one further commanded tick, then simulates a later failure: its stepped state
is discarded and it is rebuilt from the saved prior projection. Requirements:

1. **Exact restoration** — PASS: the rebuilt projection equals the untouched
   control's projection field-for-field.
2. **Authoritative continuation equivalence** — FAIL: with identical subsequent
   commands, ordered transforms/velocities diverge beyond the frozen
   0.25-unit budget at continuation step 1 (max observed 0.5544), and the
   ordered contact begin/end record sequences diverge from step 0 (the
   restored world re-acquires ground contacts while the control is mid-stack).
   Root cause: warm-start solver impulses live in private contact constraints,
   outside any expressible public projection.
3. **Eventual settling** (diagnostics ONLY): both worlds eventually settle
   within ~0.02 units with matching sleep states. This does NOT establish
   transaction equivalence — event consumers observe the divergence window
   (damage, effects, authoritative state changes), so a failed tick is not
   unobservable.
4. **Negative controls** — omitting `angularVelocity` or fixture
   `restitution` from the projection fails restoration immediately and
   correctly, proving the harness discriminates.

### Timings retained as construction/rebuild diagnostics (NOT device evidence)

Rebuild-from-projection (warmup + 40 samples): p50 0.042 / 0.149 / 0.579 ms and
p95 0.059 / 0.217 / 7.9 ms at 32 / 128 / 512 bodies. Active-phase step cost
with enforced awake/contact counters: p95 0.113 / 0.388 / 1.691 ms at
32 / 128 / 512 bodies (min awake = all bodies; contact-begin totals recorded).

### Consequence for the go/no-go decision

With strategy 2 rejected and strategy 3 unavailable in the sole surviving
backend, NO transaction strategy meets the release gate without new session-core
work (strategy 1). Combined with the open physical-device matrix, this confirms
the overall NO-GO: no adapter ships, no production dependency exists, and
Collision2D remains the sole collision system. If strategy 2 is ever
reconsidered, the acceptance bar is strict: restored vs untouched worlds must
produce the same bounded sequence of normalized transforms/velocities/sleeping
state AND ordered contact begin/stay/end records under identical commands —
numeric tolerance may cover floating-point noise only, never different contacts
or half-body-scale motion.

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
