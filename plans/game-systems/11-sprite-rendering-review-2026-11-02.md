# Sprite rendering review — 2026-11-02

Baseline: `a5248d8` (Sprite animation PR #12 merged). Branch:
`fix/core-sprite-rendering-review`. Scope: system 11, retained sprites and Atlas
batches. Tilemap/platformer work remains system 12.

## Existing model and boundaries

The RN runtime owns React configuration and asset leases. Scene snapshots and
presentation alpha feed UI worklets; Skia draws borrowed images from retained
Atlas nodes. Sprite uses a single-entry Atlas with uniform scale in RSXform and
reflection in an outer Group. SpriteBatch uses one texture/frame table and
capacity-sized rect/RSXform buffers. Neither path disposes images or writes
per-frame React state. No clock, renderer switch, cache, pool, or new runtime is
introduced. Input and camera ownership remain unchanged; culling only affects
presentation.

The original GS-SPRITE-01/02/03 fixes already exist on this baseline: scale is in
RSXform, rotation/flip preserve the world anchor, dynamic frame dimensions feed
anchor placement, and full-image GameSprite waits for its scene's publication.
GS-SPRITE-04's unbounded overflow loop is also gone. GS-REACT-03 already added
explicit buffer notification after coherent writes. This pass retains those
contracts and addresses remaining lifecycle and API gaps.

Installed versions were inspected in this session and remain locked to RN
0.86.3, Expo 57.0.25, Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, and RNGH
3.1.0. Installed Skia `src/external/reanimated/buffers.ts` memoizes buffers by
capacity and runs modifier mappers; the existing preserve modifier leaves
batch ownership with the presentation writer. Native redraw is still a separate
device acceptance gate. No dependency or CI policy changes are required.

## Reproduced defects and changes

| Trigger | Before | After |
| --- | --- | --- |
| Batch's scene matches but current snapshot is unpublished | Selector received `undefined` despite its type | Hide/publish all slots without invoking selector |
| Selected array has a hole/undefined item or writer omits `set` | Old sprite remains visible | Clear active slots before callbacks so omitted writes are hidden |
| Selector, writer, frame lookup, bounds callback, or development overflow throws | Old/partial host-buffer contents could survive without a coherent publication | Clear all rects, publish both buffers, rethrow the error |
| Exported static frame resolver receives an inherited property name | Returned inherited function/object as a rectangle | Only own frame declarations resolve; fallback never returns inherited rectangles |
| Retained Group reflection reevaluates | Samples clip and captures frame/source/elapsed/scale/anchor despite using none of them | Reflection depends only on position, rotation, and flips; buffer callbacks still resolve actual frame dimensions |
| Direct clip arrives through `SharedValue<string \| undefined>` | Compile error encouraged casts/empty-string sentinels | Accepted like the existing frame prop; unpublished selection draws nothing |

Each correctness/API case had a failing runtime or compile fixture before the
implementation. Retained regressions observed three selection reads per buffer
cycle before and two afterward, with zero selection reads when only reflection
reevaluates. Transform algebra was not changed.

Batch clearing assumes working live native buffers. Recovery from throwing
native host setters or notification methods is not promised: those can prevent
clearing/publication itself. Independent review raised that limit without an
observed Skia reproduction; no speculative native error transport was added.
Keep asset leases alive while renderers borrow their handles.

## API before and after

### Unpublished clips and reflection inputs

Before, a shared frame could be absent but a shared clip could not express the
same state in TypeScript. After:

```tsx
const clip = useSharedValue<string | undefined>(undefined);
return <Sprite source={player} clip={clip} elapsedMs={elapsedMs} />;
```

An empty string remains an invalid clip. The existing `SpriteAnimatableString`
alias is now exported from `rn-gamekit/react`, matching number/boolean aliases;
it means `string | SharedValue<string>`, while props additionally accept the
undefined-carrying shape. No new runtime method is introduced.

Before, direct callers of `spriteGroupCorrection` had to supply scale, anchor,
and frame dimensions the helper ignored. After, the minimal call is:

```ts
spriteGroupCorrection({ x, y, rotation, flipX, flipY });
```

Existing full `SpriteTransformInput` arguments, including direct object literals,
remain accepted. RSXform still requires frame dimensions for pivot placement.

### Batch writer semantics

Before, skipped writes could accidentally retain a sprite. After, each update
rebuilds visible content. Writers that intentionally relied on retained old slots
must explicitly rewrite those slots. This avoids stale rendering on removed or
conditionally drawn items without a new writer API.

The indexed writer is retained: callbacks can write multiple active slots or
overwrite another callback's slot. Preclearing the whole active range before
callbacks preserves that expressiveness; clearing a slot immediately before its
individual callback would erase earlier cross-index writes. The inactive tail
is cleared afterward, preserving the existing policy for writes beyond active
count. Slot index is draw order, while callbacks run in selected-item order.
With culling, a culled item clears its own slot when visited; use the supplied
index for straightforward culling behavior.

A future one-slot mapper could return a transform record or `undefined`:
before, `write.set(index, frame, x, y, rotation, scale)` permits index mistakes;
after, a proposed `map(item) -> { frame, x, y, rotation, scale } | undefined`
would make output ownership automatic. It is **not implemented** here: it would
remove existing multi-slot expressiveness and add record allocation. No measured
need justifies a second API or a breaking replacement in this review.

### Corrected documentation

The public guide now gives `T(x,y) · R · S · T(-pivot)` with the local pivot
derived from frame dimensions. Both public renderers expose uniform scale;
the old non-uniform-scale claim was unsupported. Disposed native handles are a
lease-lifetime obligation, not universally detected development errors. The
animation walkthrough now passes playback state to `advanceSpriteAnimation`,
uses `playSpriteAnimation` for clip changes, and includes elapsed time and a
worklet directive in its renderer selector.

## Performance evidence

`pnpm --filter rn-gamekit bench:sprites` mounts the actual Sprite/SpriteBatch
components with structural Skia/Reanimated mocks, then invokes captured
callbacks without React rerenders. Use `--source-dir` to select a historical
source snapshot with matching package configuration and dependencies; its real
path must also be used for `TSX_TSCONFIG_PATH` (see benchmark header). Baseline
`a5248d8` and final code ran sequentially on Node 24.19.0, macOS arm64, with
50 warmup updates and 30 samples of 20 updates per case. The p95 is a percentile
of batch averages, not individual-update tail latency. Instrumented getters and
setters add overhead; native scheduling, host objects, and drawing are excluded.

One fixed final pair, microseconds per update:

| Scenario (active / capacity for batch) | Before median / p95 | After median / p95 |
| --- | ---: | ---: |
| Retained 100 | 49.427 / 221.560 | 38.150 / 83.535 |
| Retained 500 | 156.196 / 267.477 | 186.310 / 252.887 |
| Retained 1,000 | 279.344 / 595.988 | 202.054 / 576.487 |
| Batch 100 / 100 | 11.781 / 18.960 | 18.725 / 21.594 |
| Batch 500 / 500 | 55.396 / 67.292 | 25.927 / 74.954 |
| Batch 1,000 / 1,000 | 59.227 / 116.450 | 49.442 / 122.058 |
| Batch 100 / 1,000 | 11.698 / 12.400 | 8.331 / 8.471 |

Timing noise and nonmonotonic results prevent a universal throughput claim.
Observed counts are stronger evidence: retained selection/elapsed reads fall
from `3N` to `2N`, while rect and transform writes remain `N`. In the unculled,
fully written batch fixtures, rect writes increase from `capacity` to
`capacity + active`; transform writes remain `active`, selection runs once,
and two buffer publications occur per update. Output rect/transform checksums
match across all seven fixtures, with untimed rectangle and numerical RSXform
assertions. The benchmark has no timing threshold.

Active-slot preclearing is a correctness tradeoff, not a batch speedup claim.
Clearing still traverses allocated capacity, and culling still visits selected
items. No scalar writer, dirty-range tracker, or additional per-sprite derived
selection value was introduced without measured need. Device frame pacing must
be measured independently; these results do not establish FPS or memory plateau.

## Validation and native acceptance

`pnpm check` passed: workspace lint/typechecks, **1,341 library tests**, **309
playground tests** (254 headless and 55 mounted), **61 dependency-tooling tests**,
library/docs production builds, and iOS Hermes export. Built public API fixtures
passed, including shared optional clip values, the public string alias, minimal
and legacy full reflection inputs, and invalid-input compile failures. The
benchmark passed standalone strict TypeScript and lint checks.

The expanded coverage gate now includes Sprite and SpriteBatch themselves.
Line/branch/function coverage: Sprite **99.4/88.5/100%**, SpriteBatch
**97.3/87.3/100%**, transform helpers **98.9/88.6/93.8%**, selection helpers
**97.8/95.5/100%**. The gate enforces 80% line coverage for its listed modules;
branch/function percentages are reported separately. `git diff --check` passed.
Registry audit reports the same 65 existing advisories (6 critical, 40 high,
14 moderate, 5 low); dependency versions and the lockfile are unchanged.

Existing algebra, scale-zero, varying-frame-size, static/shared prop replacement,
culling, production overflow, and coherent notification tests remain in place.
New mounted suites cover unseeded snapshots, skipped/sparse entries, source
lookup, failure/recovery, cross-index writes, inactive tails, and retained
reflection dependencies. Independent review found no reproduced blocker in those
paths; native host failure limits are stated above.

On representative 60 Hz Android and 120 Hz iOS release or `debugOptimized` builds,
verify anchor/corner placement for noncentral anchors, scale 0/0.5/2, rotation,
and all flips. Exercise varying-size clips, source/scene replacement, omitted
writes, and callback failure/recovery. Compare retained/batch populations of
100/500/1,000 with both full and sparse capacity and culling; record CPU/GPU time,
missed frames, native notifications, and memory. The JS harness cannot establish
native mapper ordering, actual redraw, or FPS. No device run was performed here.
