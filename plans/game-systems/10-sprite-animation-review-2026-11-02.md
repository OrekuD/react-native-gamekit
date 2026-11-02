# Sprite animation review — 2026-11-02

Baseline: `78f0ad8` (Assets PR #11 merged). Branch:
`fix/core-sprite-animation-review`. This implements system 10. Sprite transform
algebra, batch rendering, and other system 11 work remain separate.

## Ownership and scope

Animation selects texture frames from explicit game time. The fixed-step scene
owns immutable playback records on the RN runtime. The UI runtime samples the
presented clip/time, using the existing retained Sprite/Atlas path. No clock,
React frame state, gameplay event transport, decode ownership, or allocation
pool is introduced. A renderer borrows its loaded image for the asset lease's
lifetime; it never releases it. Input and camera ownership are unchanged.

The original GS-ANIMATION-01/02 report predates fixes already on this baseline:
there is one sampler, playback helpers already run on the simulation runtime,
and ordinary string clip keys already infer correctly. This review verifies
those behaviors and repairs remaining boundaries rather than repeating them.

Installed versions match the lockfile/catalog: RN 0.86.3, Expo 57.0.25,
Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, Gesture Handler 3.1.0.
No dependency graph, lockfile, native configuration, or CI policy changes.

## Findings and fixes

All defects below were reproduced with failing tests before their fixes.

| Trigger | Before | After |
| --- | --- | --- |
| Loop sample with finite elapsed divided by a subnormal duration | Division overflow produced `NaN` index / empty name | Reduce by the finite timeline before dividing, matching playback's modulo policy |
| Huge finite quotient, e.g. four 0.1 ms frames at `1e16` ms | Lost integer precision selected index 0 | Reduction selects index 2; a second regression covers precision loss just below the safe-integer threshold |
| Tiny negative elapsed divided by a large duration | Division underflow produced negative zero and selected the first frame | Keep the last-frame selection for negative nonzero remainders; exact periods still select frame zero |
| Multiple frames with individually finite durations whose total overflows | Accepted declaration with an infinite timeline | `ASSET_INVALID_DURATION` at declaration with the full field path; raw sampler/duration helper also reject |
| Raw malformed mode/frame array or missing sampled name | Invalid mode treated as once, duration helper accepted invalid clips, name silently became empty | Constant-time raw metadata checks and explicit selected-name failure |
| `toString`, `constructor`, or `__proto__` lookup without an own declaration | Inherited values accepted as clips/rectangles, or incidental TypeError | Unknown clip/frame error; explicitly declared names and null-prototype tables still work |
| Invalid external playback elapsed/speed or unrepresentable advance | Could publish `NaN` or silently complete one-shot playback | Validate time/speed; reject unrepresentable arithmetic with `RangeError` |
| Huge delta with tiny speed and representable final product | Intermediate milliseconds conversion overflowed | Rare fallback changes multiplication order; genuinely unrepresentable results still reject |
| Full-image GameSprite with another scene or an unseeded commit | Image visible at default origin | Hidden until that scene publishes a selection |
| Zero delta, exact full loop, clamped rewind, reset at origin | Allocated equivalent state records | Reuse existing record when no field changes |
| Sprite rect callback materializes selection | Three conditional object spreads duplicate adaptation logic | Use the existing materializer shared by other sprite callbacks |

Loop sampling now follows the represented finite total duration even for enormous
times; fractional durations can round differently from dividing unbounded time
first. This aligns raw sampling with playback's existing modulo timeline. It
does not promise arbitrary-precision interpretation of fractional durations.

The sampler remains constant-time. It validates clip shape, duration, mode, and
the selected name without rescanning the whole frame list. `spriteSheet` is the
authoring boundary that validates all frame references. These helpers do not
promise arbitrary-precision time or support untrusted executable getters.

## API before and after

### Numeric clip keys

Before, `SpriteClipNames` dropped numeric declaration keys even though JavaScript
stores them as strings. After, the alias includes their string forms:

```ts
const sheet = spriteSheet(1, {
  frames: { idle: { x: 0, y: 0, width: 16, height: 16 } },
  animations: {
    0: { frames: ['idle'], frameDurationMs: 100, mode: 'loop' },
  },
});
const state = startSpriteAnimation(sheet, '0');
advanceSpriteAnimation(sheet, state, 1 / 60);
```

Unknown names and numeric arguments still fail compilation. Tests import the
built `rn-gamekit/assets` and `rn-gamekit/sprites` entry points and include a
manifest-branded sheet. No additional public API is needed.

### Time, restart, errors, and identity

Before, invalid arithmetic could escape as broken playback, and docs suggested
all finite large deltas were safe. After, finite input and representable output
are explicit constraints. Extreme callers should keep elapsed time bounded or
handle `RangeError`; there is no silent saturation policy.

`playSpriteAnimation(sheet, state, state.clip)` remains a no-op; use
`resetSpriteAnimation(state)` to restart a completed/current clip. Both preserve
pause and speed. Negative deltas rewind active state to a minimum of zero;
completed states stay completed. Raw presentation sampling deliberately wraps
negative loop times and clamps negative one-shot times.

Unchanged transitions may now preserve object identity. Consumers should read
the resulting fields rather than use a fresh object as a clock signal. Inputs
remain immutable. No completion event API is added: scene update compares
completion and owns gameplay effects.

Simulation unknown-clip errors are structured `GameAssetError`; the UI sampler
uses plain actionable errors so its failure paths require no RN-only class.
Unknown names throw; absent sheet selection draws nothing. Explicit frame
selection still overrides a clip. The public guide now states these boundaries.

## Measured performance

`pnpm --filter rn-gamekit bench:animation` benchmarks the actual exported helpers;
`--module /absolute/path/to/baseline/src/sprites.ts` selects a historical snapshot.
Preserve its package module type and resolvable imports to compare the same tsx
transformation. Baseline `78f0ad8` and final code ran sequentially on Node 24.19.0,
macOS arm64. Each scenario uses 1,000 sprites, 100 warmup batches, and 40 measured
samples of 100 batches. The p95 is of batch averages, not per-call tail latency.
Timed work includes iteration, assignment, and checksum/reference bookkeeping.

The final arithmetic was measured in three sequential baseline/current pairs.
The machine showed substantial timing variability despite no concurrent project
checks. Final pair, microseconds per batch of 1,000 sprites:

| Operation | Before median / p95 | After median / p95 | New output references before → after |
| --- | ---: | ---: | ---: |
| Active loop advance | 30.930 / 71.739 | 45.792 / 118.350 | 1,000 → 1,000 |
| Zero delta | 29.452 / 64.160 | 31.450 / 75.445 | 1,000 → 0 |
| Exact full loop | 30.024 / 56.762 | 27.967 / 47.613 | 1,000 → 0 |
| Reset at origin | 29.069 / 45.220 | 18.891 / 43.408 | 1,000 → 0 |
| Loop frame sampling | 2.707 / 7.324 | 7.887 / 12.837 | No playback record |

Across the three pairs, active baseline medians ranged 30.930–43.456 µs and
current medians 34.946–45.792 µs. Zero-delta medians were 29.452–29.765 before and
31.450–47.867 after; full-loop medians were 29.879–30.024 before and 27.057–43.702
after. These measurements do not establish a stable active or no-op throughput
improvement. Active playback now checks external state and clip metadata; those
checks are retained for correctness.

Reset medians consistently decreased (28.050–29.069 → 17.782–19.169 µs), while
sampling consistently increased (2.615–2.707 → 7.867–8.135 µs). Corrected remainder
arithmetic costs roughly 5.2–5.5 additional µs per 1,000 samples here. Reset and
no-op paths demonstrably avoid equivalent output objects, even where CPU timings
do not improve. Reference changes are not total allocation or retained-memory
measurements. Earlier exploratory runs with different sampler arithmetic or
module transformations are excluded from these results.
The materializer cleanup is source-level simplification, not a separately measured
UI speedup. These results make no device FPS, Hermes, GPU, or memory-plateau claim.

## Validation and remaining acceptance

Runtime, type, mounted-callback, and independent review checks cover the behavior
above. The mounted tests execute actual Sprite and GameSprite callbacks against
changing shared inputs without React rerendering, including negative time,
boundaries, loop/once completion, absent selection, frame precedence, unknown
names, and scene publication.

The installed Worklets 0.10.3 Babel plugin compiles the sampler; an isolated JS
context executes its emitted code and recursively transferred function closures
for success and failure paths. A negative control removes a reachable helper's
directive and is rejected. This is stronger than searching for directives but
does not validate native UI execution or Reanimated mapper ordering. Playback
serialization tests are now named accurately instead of claiming UI compatibility.

Closing validation passed workspace lint/typechecks, **1,328 library tests**,
**309 playground tests** (254 headless and 55 mounted), and **61 dependency
tooling tests**. Library build, built public API fixtures, iOS Hermes export,
and docs production build passed. The docs build initially hit the sandbox's
local-port restriction and passed when rerun through the normal approval process.
The new worklet harness's module-lowering order was corrected before its passing
full test/coverage runs.

The coverage gate passed: sampler 97.8% lines / 96.2% branches / 100% functions;
playback 98.1 / 93.8 / 100; selection 99.3 / 95.2 / 100; declaration validation
96.9 / 95.2 / 94.1. The gate enforces 80% lines for its listed modules; these
branch/function figures are reported separately. Independent review reproduced
the numeric edges, reviewed their fixes and the worklet harness, and reported no
remaining correctness, API, or security blocker. `git diff --check` passed.

Registry audit currently reports 65 advisories (6 critical, 40 high, 14 moderate,
5 low) on the unchanged dependency graph.

Native acceptance remains: on representative 60 Hz Android and 120 Hz iOS release
or `debugOptimized` builds, compare the same loop/once timeline at display-rate
boundaries, pause/resume, restart, and scene replacement; verify no full-image
flash before publication and actionable worklet failures. Profile active and
stationary populations and check frame pacing with real loaded textures. No
native device run was performed for this review. Sprite rendering is next.
