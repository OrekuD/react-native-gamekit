# Performance review comparison: task 5 vs task 6

**Date:** 2026-08-08
**Purpose:** reconcile the two independent performance reviews of the same code
so implementation can proceed from one agreed position.

## Attribution note

The request framed task 5 as mine and task 6 as another agent's. That is
inverted, and it matters for reading the two documents:

| Document | Author | Provenance |
| --- | --- | --- |
| `plans/task-5.md` | **another agent** | committed in `67d573f`, predates this session |
| `plans/task-6.md` | **me (opus)** | untracked, written this session |

Verified with `git log -- plans/task-5.md` (returns `67d573f`) and
`git status` (task 6 shows as `??`). Task 6 was explicitly written as a
second-opinion review *of* task 5, so it inherits task 5's framing and argues
against it in specific places. This comparison keeps that direction of
argument, and corrects two places where task 6 was **unfair to task 5**.

---

## Headline: the two reviews agree on architecture and disagree on ranking

Both documents independently reached the same structural diagnosis: **the frame
pipeline conflates two frequencies** — 60 Hz simulation commits and display-rate
presentation travel down one channel, and interpolation `alpha` is JS-owned when
it should be UI-owned. Both prescribe the same fix.

Every real disagreement is about **which cost dominates** and therefore **what
order to fix things in**. There is no architectural conflict. That is a good
outcome: two independent passes converging on the same target architecture is
stronger evidence than either document alone.

---

## Common ground

### Architecture and root cause

1. **Two frequencies must be split.** Publish a commit envelope only when
   simulation state advances; make `alpha` a UI-owned scalar advanced by a UI
   frame callback. (task 5 P2; task 6 Finding 2)
2. **Zero-tick display callbacks must do nothing** beyond scheduling their
   successor — no publish, no listener fan-out, no allocation.
3. **Catch-up publishes once**, carrying the final *adjacent* snapshot pair, not
   pre-catch-up vs. final.
4. **Never extrapolate.** Clamp `alpha` at 1 when JS is late.
5. **Preserve hard cuts** across scene transitions; never interpolate between
   two scene snapshot types.
6. **Pointer moves must be coalesced** on the UI runtime to at most one sample
   per fixed step, while `down`/`up`/`cancel` stay immediate ordered edges and
   the final up position ships with its terminal edge. (task 5 P1; task 6
   Finding 5)
7. **Ownership stays where it is:** authoritative simulation on the JS runtime,
   presentation on the UI runtime, React for low-frequency overlays only.
8. **The mapper graph is too wide.** 138 derived values, ~134 dirtied per
   publish, with 128 of them recomputing *static* brick geometry. Collapse via
   one parent Group transform, `Fill` for the background, and commit-frequency
   liveness. (task 5 P3; task 6 Finding 4)
9. **The reference game must model structural sharing** — static geometry
   hoisted, liveness copied lazily on first hit, snapshots carrying only moving
   values. (task 5 P6; task 6 Finding 6)
10. **HUD work belongs at commit frequency**, held behind a ref so unchanged
    values enqueue nothing. (task 5 P7; task 6 Finding 7)
11. **Audio/haptics must be driven by discrete semantic events**, never by
    render frames or raw pointer moves.

### Method and discipline

12. **Phase 0 benchmark harness gates device claims.** Both documents insist a
    reproducible release-build baseline on physical devices precedes
    architectural change.
13. **Release builds only** for performance conclusions; dev mode locates
    problems but cannot approve a gate.
14. **No worker runtime.** Nothing measured justifies another runtime's
    synchronization cost.
15. **No native feature-flag tuning** without a trace naming the bottleneck.
16. **Don't escalate to `Atlas`/`Picture` prematurely.** 32 rectangles is not
    evidence; build the shared-texture scaling scene first.
17. **Don't make deep-freezing dev-only** as a silent optimisation — it changes
    observable API semantics.
18. **Preserve the immutability contract** and update-scope safety (a retained
    transition controller must still throw outside its owning update).

### What is already correct and must not regress

Both agree on: fixed step with bounded catch-up, determinism across 30/60/120 Hz,
atomic transitions with honest failure semantics, generation tokens killing the
stale-callback race, pointer terminal-edge preservation, one viewport for drawing
and hit-testing, and a headless core free of native imports.

---

## Where they differ

### Difference 1 — Which cost dominates the JS step

| | Position |
| --- | --- |
| **task 5** | `deepFreeze` is **P5, "High, impact unmeasured"**, listed below two transport findings and scheduled in **Phase 4** |
| **task 6** | `deepFreeze` is **Critical**, the single largest JS cost, and belongs in **Phase 1** |

**Evidence task 6 added** (Node 22 microbenchmark of the exact algorithm, 32-brick
snapshot):

| Stage | ns/tick | Share |
| --- | ---: | ---: |
| Collision array copy (no hit) | 63 | 0.8% |
| Snapshot construction | 154 | 2.0% |
| **`deepFreeze`** | **7,641** | **97.2%** |

`deepFreeze` measured ~50× the combined cost of everything else in the stage, and
a trusted-subtree cache tested 13.7× faster while preserving immutability.
Scaling is the sharper argument: at 1,000 entities it reaches ~14 ms/sec of JS
time, ~29 ms/sec at 2,000 — before any gameplay runs, on V8, with Hermes slower.

**Resolution: task 6's ranking is better supported.** Task 5 correctly identified
the cost and — importantly — **already proposed the right fix**, including the
session-owned trusted cache, the separate per-traversal visiting set, and the
warning against `Object.isFrozen`. The disagreement is purely about **priority and
phase**, not mechanism.

**Fairness correction:** task 6's phrasing ("task 5 lists collision copying and
input sampling alongside it") understates how specific task 5's P5 remedy already
was. Task 5's error was ordering, not analysis.

---

### Difference 2 — The cost of the JS→UI transport

| | Position |
| --- | --- |
| **task 5** | every publish re-enters "the generic shareable graph"; framed as a dominant per-frame cost |
| **task 6** | Worklets caches by object identity; a zero-tick publish is ~7 JSI calls, not ~400 — task 5 overstates it ~50× |

**Evidence task 6 added**, from reading `react-native-worklets@0.10.1`
(`memory/serializable.native.js:41-47` + `serializableMappingCache.native.js` — a
`WeakMap` keyed on identity that returns early **without recursing**):

| Publish kind | JSI `createSerializable()` calls |
| --- | ---: |
| First (cold cache) | 407 |
| After a committed tick | 207 |
| **Zero-tick callback** | **7** |

**Resolution: task 6 is right on the number, but task 5 was not as wrong as task
6 claims.** Task 5's P2 point 2 explicitly hedges: *"Worklets **may cache**
unchanged nested object identities, but every new snapshot still enters the
generic shareable graph and the root assignment still propagates."* That
sentence anticipates the caching and correctly identifies the residual cost —
**the root assignment propagating to consumers**, which is exactly the mapper
fan-out both documents rank highly.

**Fairness correction: task 6's "overstates by ~50×" is too strong.** Task 5
flagged the uncertainty and named the real mechanism. Task 6 supplied the missing
number and shifted the *emphasis* from serialisation volume to fan-out. Both
reach the same fix.

The genuinely new and useful detail from task 6: primitives are **never** cached
(every number is a fresh `createSerializableNumber`), so payload cost scales with
**primitive leaf count**, not object count. That is a better argument for compact
numeric channels later than either document's original framing.

---

### Difference 3 — The `Canvas onSize` frame callback

| | Position |
| --- | --- |
| **task 5** | **P9, "Low"** — duplicate surface-size writers, "happens on layout changes, not every frame" |
| **task 6** | **High** — `onSize` activates a permanent UI frame callback calling native `measure()` every display frame |

**Evidence task 6 added**, from Skia's shipped source
(`renderer/Canvas.js:63-95`):

```js
const useReanimatedFrame = !HAS_REANIMATED_3 ? () => {} : Rea.useFrameCallback;
useReanimatedFrame(() => {
  "worklet";
  if (onSize && measure) { const result = measure(viewRef); /* write if changed */ }
}, !!onSize);                                   // autostart whenever onSize is set
```

Passing `onSize` starts a Reanimated frame callback that polls native `measure()`
**120×/sec on an iPad Pro**, for the session's entire life, purely to detect
layout changes `onLayout` already reports. Verified **still present in Skia
2.11.0**, so upgrading does not fix it.

**Resolution: task 6 is correct and this is the clearest factual win.** Task 5
analysed the *write* frequency (genuinely layout-rate) and missed the *poll*
frequency. The distinction is decisive because the poll lands on the UI thread —
the one reported as worst affected. This is also the cheapest fix in either
document: stop passing `onSize`, use `Fill` for the background.

---

### Difference 4 — Severity of pointer-move traffic

| | Position |
| --- | --- |
| **task 5** | **P1, Critical** — listed first in the findings table |
| **task 6** | **High** — real, but bounded |

**task 6's argument:** the simulation samples input once per fixed tick, so every
move beyond the first per 16.67 ms window is *already* discarded by
`samplePointer`. The waste is bounded by touch rate and occurs **only while a
finger is down**, unlike `deepFreeze`, the display-rate publish, and the
`measure()` poll, which burn budget continuously.

**Resolution: task 6's downgrade is defensible, but this is a judgement call, not
a measurement.** Neither document traced input latency on a device. Task 5's
Critical rating is reasonable if input-to-visible latency proves to be the
user-visible complaint; task 6's High is reasonable on continuous-cost grounds.
**Phase 0 should settle it.** Both prescribe an identical fix, so the ordering
dispute has low practical stakes.

---

### Difference 5 — Dependency upgrades

| | Position |
| --- | --- |
| **task 5** | not considered (predates the releases) |
| **task 6** | **Finding 9** — Skia 2.11.0's `select()` is a direct enabler |

Task 6 verified from the packed 2.11.0 tarball that `select()` registers the
**group** shared value rather than one per prop
(`Recorder.js:41-42`, `ReanimatedRecorder.js:25-26`), and that Skia starts **one
mapper** over collected values (`Container.native.js:67`). Projected effect on our
renderer:

| | Registrations | Worklet runs/sec @120 Hz |
| --- | ---: | ---: |
| Current (`useDerivedValue` per prop) | 138 | 16,080 |
| `select` + Group + `Fill` | **4** | **480** |

That clears task 5's own ≥75% reduction target for P3 by *deleting* renderer code
instead of hand-rolling a batching layer.

**Resolution: additive, no conflict.** Task 5 planned a hand-rolled equivalent
because the release did not exist yet. Task 6 also flagged the constraint task 5
could not have known: **Expo SDK 57 pins exactly our current versions**, so the
upgrade is a deliberate off-matrix deviation requiring its own validation. Task 6
recommends holding Gesture Handler at 2.32.0 — a 3.x migration during a
pointer-pipeline refactor would confound Phase 0's measurements.

---

### Difference 6 — Correctness defects found

| | Position |
| --- | --- |
| **task 5** | performance-focused; two minor cleanups (P9/P10) |
| **task 6** | **Finding 8** — seven cleanups, several correctness rather than speed |

Task 6 additions, all verified by line: dead `sceneElapsedSeconds` field (written
`:463`, never read); two no-op `try { } catch (e) { throw e }` blocks (`:148-153`,
`:518-522`); `GameSession.viewport` handing out an unfrozen caller object that can
desynchronise `ViewportBinding`; `assets: []` required but unimplemented;
`pointerBinding.ts:61` formatting defect; redundant non-null assertions; and a
dead `won` field in `selectHud` that is structurally always `undefined`.

**Resolution: additive.** Different scope, no conflict. Most are safe to land
before Phase 0 since they remove provably dead code or fix defects without
changing game semantics.

---

## Reconciled implementation order

Merging both documents, ordered by measured evidence and risk:

**Stage A — land now (no device trace required)**

1. Drop `Canvas onSize`; use Skia `Fill` for the background. *(task 6 Finding 3 —
   biggest confirmed waste on the worst-affected thread, smallest change)*
2. Finding 8 cleanups: dead field, no-op try/catch, freeze the viewport config,
   make `assets` optional, formatting, assertions, dead `won`.

**Stage B — Phase 0 harness** *(both documents' gate; unchanged)*

3. Build the benchmark/diagnostics harness and capture the baseline on a 60 Hz
   iPhone, a mid-range Android, and a 120 Hz iPad.

**Stage C — architecture, in this order**

4. Skia → 2.11.0 (+ Reanimated 4.5.3 / Worklets 0.10.3) as a **standalone commit
   with its own before/after capture**, so the upgrade stays attributable.
5. `deepFreeze` trusted cache + array fast path. *(promoted from task 5 Phase 4)*
6. Commit/alpha split with UI-owned interpolation. *(both documents' central fix)*
7. Static brick geometry + lazy liveness copy — multiplies #5.
8. Collapse the mapper graph using `select()` + one Group transform.
9. UI-side pointer coalescing.
10. Commit-frequency HUD + discrete semantic events.
11. Startup-fade A/B.

The one substantive reordering versus task 5: **`deepFreeze` moves from Phase 4
to Stage C**, and the `onSize` fix moves from "Low / later" to first. Everything
else preserves task 5's sequence.

---

## Open questions Phase 0 must settle

1. **Does UI or JS p95/p99 break first?** Determines whether the `measure()` poll
   and mapper fan-out (UI) or `deepFreeze` and publish (JS) dominate the reported
   drops.
2. **Is pointer latency user-visible?** Settles Difference 4 (Critical vs High).
3. **Does the startup fade cost real frames?** Both documents call it a
   hypothesis requiring an A/B.
4. **What does the Skia upgrade alone change?** Must be captured separately from
   the refactors.
5. **Does `onLayout` alone handle iPad split view and Stage Manager?** The one
   behavioural risk in Stage A step 1.

## Confidence

- **High, mechanism verified in source:** Differences 2, 3, 5 and all common
  ground. These were checked against installed dependency code, not docs.
- **High, measured but V8-not-Hermes:** Difference 1's ratios. Absolute
  milliseconds will differ on device; the ordering should hold.
- **Judgement, unmeasured:** Difference 4's severity, and every absolute budget
  claim in either document.

Neither review captured a device trace. **No claim about which finding causes the
observed frame drops is proven yet** — both documents are explicit about this, and
that caveat survives reconciliation.
