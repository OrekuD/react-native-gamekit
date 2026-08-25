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

## 2. Transaction-strategy prototype (strategy 2)

Planck.js exposes no world snapshot/restore API, so strategy 3 is unavailable.
Strategy 1 (dedicated GameSession transaction phase) remains possible but
requires the session-core change reserved for an approved adapter effort. The
prototype implements and measures **strategy 2**: keep an immutable prior
`PhysicsState2D` body projection; on any failed tick/commit, fully rebuild the
private world from that projection before the next accepted step.

Headless measurements (`node v24.19.0`, stacked dynamic boxes on static ground,
600 samples after 10-step JIT warmup — active/unsettled stacks, not sleeping):
rebuild-from-projection restore cost is **0.5 ms (32 bodies), 0.7 ms (128),
1.1 ms (512)**. Strategy 2 is viable: the failure-path cost is sub-millisecond
at v1 scale in Node and is paid once per failed tick, never on the happy path.

Step-cost evidence from the same spike (Node-only — **not device evidence**):

| World | Bodies | Step p50 | p95 | p99 | 60 Hz headroom at p95 |
| --- | --- | --- | --- | --- | --- |
| Contact-heavy | 32 | 0.002 ms | 0.119 ms | 0.291 ms | ~140× |
| Contact-heavy | 128 | 0.010 ms | 0.416 ms | 1.010 ms | ~40× |
| Contact-heavy | 512 | 0.083 ms | 1.677 ms | 3.496 ms | ~10× |
| Mostly-sleeping | 128 | 0.007 ms | 0.009 ms | 0.010 ms | ~1850× |

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
