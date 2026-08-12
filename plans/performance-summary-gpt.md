# Performance Review Synthesis — Task 5 vs. Task 6

## Status and purpose

This document compares the performance review in
[`task-5.md`](./task-5.md) with the independent architecture and performance
review in [`task-6.md`](./task-6.md).

It records:

- the conclusions both reviews share;
- the arguments and rankings that differ;
- findings that Task 6 adds without contradicting Task 5;
- the recommended combined execution order.

This is a synthesis, not a third device-performance report. Neither review
captured a physical-device trace. Task 6 adds source inspection, arithmetic
counts, and Node/V8 microbenchmarks, but those do not prove which operation
caused the observed frame drops on Hermes or the native UI thread.

## Executive synthesis

The two reviews agree on the architecture and most of the required changes.
They disagree primarily about **which existing cost should be treated as most
urgent and why**.

The shared architectural diagnosis is:

1. Fixed-step simulation commits and display-rate presentation are incorrectly
   conflated in one `GameRenderFrame` publication channel.
2. Interpolation alpha belongs to the UI runtime, while authoritative game
   state belongs to the React Native JavaScript runtime.
3. The current renderer invalidates far too many UI-derived values for a scene
   containing only about 32 bricks.
4. Raw pointer movement crosses from UI to JavaScript more often than the
   simulation can consume it.
5. Static reference-game data is rebuilt, copied, and recursively frozen too
   often.
6. React HUD updates and future sound/haptic commands must follow commits or
   semantic events, not display frames.
7. Physical-device, release-like measurement is required before claiming that
   any one change fixed the reported jank.

Task 6 materially improves Task 5 in four areas:

- it identifies Skia `Canvas.onSize` as a permanent UI-frame polling cost,
  rather than a layout-frequency duplicate writer;
- it demonstrates that Worklets caches serialized objects by identity, making
  Task 5's zero-tick transport-volume explanation too pessimistic;
- it measures `deepFreeze` as the dominant part of the current snapshot stage
  and moves it earlier;
- it identifies Skia 2.11 `select()` as a possible native mechanism for
  collapsing animated-property registrations.

Task 5 remains stronger in one crucial respect: it requires a reproducible
performance harness and baseline **before performance-altering changes**, with
physical-device p50/p95/p99, crossing, allocation, latency, lifecycle, and
thermal evidence. That sequencing should remain authoritative.

## Common ground

### 1. The foundation is sound

Both reviews explicitly retain:

- deterministic fixed-step simulation;
- bounded catch-up and debt handling;
- atomic scene transitions and honest failure semantics;
- stale-frame generation protection;
- exact pointer ownership and terminal-edge behavior;
- shared viewport math for rendering and hit testing;
- a headless core with no React, Skia, Reanimated, or Gesture Handler types;
- React and Zustand only for low-frequency application/UI state;
- renderer neutrality for future 3D support;
- support for phone, Android, iPad, rotation, split view, and high refresh.

Neither review recommends replacing the engine foundation. Both describe a
frame-pipeline refinement.

### 2. Commit rate and presentation rate must be separated

Both reviews agree that publishing a complete `GameRenderFrame` after every JS
`requestAnimationFrame` callback is structurally wrong.

The shared target is:

- JavaScript publishes an immutable previous/current commit envelope only
  after simulation advances, a transition commits, or a restart occurs.
- A zero-step display callback publishes nothing and notifies no HUD or
  renderer listeners.
- Catch-up publishes once with the final adjacent snapshot pair.
- Interpolation alpha is a separate UI-owned scalar.
- UI alpha resets on a new commit, advances at display rate, clamps at `1`, and
  never extrapolates.
- Scene transitions hard-cut rather than interpolating incompatible snapshot
  types.
- `getRenderFrame()` remains available for headless inspection and calculates
  alpha on demand.

This is the central architectural conclusion of both reviews.

### 3. The renderer graph has excessive fan-out

Both reviews count approximately 138 derived values in Brick Breaker:

- 2 for the background;
- 4 for the paddle;
- 4 for the ball;
- 128 for 32 bricks.

They agree that most brick geometry is static and must not be recomputed at
display rate.

The shared renderer direction is:

- replace the background size-derived `Rect` with Skia `Fill`;
- apply viewport mapping once on a parent `Group`;
- author children in logical world coordinates;
- remove per-property derived values for static bricks;
- represent brick liveness as compact commit-frequency data;
- compute ball and paddle interpolation coherently;
- remove the object-returning interpolation performed twice for ball `x` and
  `y`;
- keep ordinary retained `Rect` nodes until a benchmark justifies batching;
- do not adopt `Atlas` for solid rectangles or `Picture` as a generic
  optimization.

Both require at least a 75% reduction in animated mapper/registration fan-out
without visual, viewport, input, or interpolation regressions.

### 4. Pointer movement should be coalesced on the UI runtime

Both reviews agree that every raw move currently schedules a UI-to-JS call,
even though the fixed-step simulation samples input only once per tick.

The shared design preserves:

- immediate, ordered down/up/cancel edges;
- the final pointer coordinate in the terminal packet;
- first-pointer ownership;
- letterbox rejection;
- layout-change cancellation;
- JavaScript authority over gameplay input;
- validation of non-finite data at the JS boundary.

Only the latest move should remain UI-owned and cross at a bounded sampling
frequency. Neither review supports synchronously reading a UI shared value from
JavaScript, because that can block on the UI runtime.

### 5. Immutable snapshots must remain immutable

Both reviews identify recursive freezing and short-lived fixed-step allocation
as scaling concerns. They recommend the same safe optimization:

- retain the public deeply immutable snapshot contract;
- maintain a session-owned trusted `WeakSet` for subtrees that GameKit has
  already completely frozen;
- maintain a separate traversal-local visiting set for cycle detection;
- add an object to the trusted cache only after successful full traversal;
- never treat `Object.isFrozen()` as proof that all children are immutable;
- preserve transition-controller scope and stale-reference safety.

Neither review supports silently disabling freeze in production.

### 6. Brick Breaker should teach structural sharing

Both reviews agree that the reference game unnecessarily:

- copies the entire brick array when no collision occurs;
- recreates static brick geometry in every snapshot;
- makes `deepFreeze` walk that recreated structure every tick.

The agreed fix is to hoist immutable geometry, keep only liveness in dynamic
state, clone liveness lazily on the first hit, preserve identity on no-hit
steps, and emit compact snapshots.

### 7. HUD, audio, and haptics belong to semantic frequency

Both reviews agree that the HUD selector and state-enqueue path should not run
at presentation frequency.

The combined rule is:

- subscribe HUD data at commit frequency;
- compare selected values before calling React `setState`;
- use discrete gameplay events for brick hits, score changes, game over,
  button presses, sound, and haptics;
- never drive audio or haptics from render frames, interpolation callbacks, or
  raw pointer movement.

### 8. The startup fade is a hypothesis

Both reviews treat the full-screen Canvas opacity fade as plausible startup
pressure, not a proven cause. Both require an A/B comparison of:

1. the current full-surface fade;
2. no fade;
3. an opaque game with an opaque cover fading away.

The existing transition should remain if measured differences are noise.

### 9. The same architectural boundaries remain out of scope

Both reviews reject, without new evidence:

- moving authoritative simulation to a worklet;
- adding a dedicated worker runtime;
- a native C++/JSI rewrite;
- live game state in React or Zustand;
- native Reanimated feature-flag experiments;
- premature `Atlas`, `Picture`, or texture escalation;
- weakening lifecycle or immutability guarantees;
- treating simulator or development FPS as a release gate.

## Differences in arguments and conclusions

### Difference 1: `deepFreeze` severity and order

#### Task 5 position

Task 5 ranks recursive freezing and fixed-step allocation as **High**, with
impact unmeasured. It places the optimization in Phase 4, after the
commit/presentation split, pointer coalescing, and renderer simplification.
Its argument is deliberately profiler-led: the allocation exists, but valuable
API guarantees must not be weakened without evidence.

#### Task 6 position

Task 6 promotes `deepFreeze` to **Critical**. Its Node/V8 microbenchmark reports
that, for the current 32-brick snapshot, freezing accounts for about 97% of the
measured snapshot pipeline and costs roughly 50 times collision-copy plus
snapshot-construction work. It also demonstrates linear scaling as entity
count grows and estimates a 13.7x improvement from trusted subtree caching and
static geometry sharing.

#### Combined conclusion

Adopt Task 6's **relative ranking inside the snapshot stage** and move the safe
trusted-cache/array-path work earlier. Do not repeat Task 6's result as proof
that `deepFreeze` is the cause of the observed frame drops:

- the benchmark ran on V8, not Hermes;
- it measured selected snapshot operations, not the complete JS frame;
- its reported current absolute cost is still small;
- it says nothing about the native UI-thread drops.

The precise conclusion is: `deepFreeze` is the strongest measured JS scaling
candidate and should be optimized early, while physical-device traces remain
the gate for calling it a jank root cause.

### Difference 2: cost of JS-to-UI frame transport

#### Task 5 position

Task 5 emphasizes that a new render-frame root and deeply structured snapshot
pair enter the generic shareable/serialization path on every display callback.
It treats the complete payload crossing as a likely contributor, especially on
120 Hz devices.

#### Task 6 position

Task 6 inspects Worklets 0.10.1 and finds an identity-keyed serialization
cache. It counts approximately:

- 407 serializable-creation calls for the cold first publish;
- 207 after a committed tick, where one snapshot is new;
- 7 for a zero-tick publish, where both snapshots are cached.

It therefore argues that Task 5 overstates repeat serialization cost. The
important recurring cost is the root assignment dirtying the renderer graph,
not a full traversal of both unchanged snapshots.

#### Combined conclusion

Use Task 6's corrected cost model. The commit/presentation split is still
Critical, but its strongest reasons are:

- one root update invalidates about 134 frame-dependent mappers;
- JavaScript listener and publication work still occurs at display rate;
- alpha incorrectly depends on JS scheduling;
- new primitive leaves are not identity-cached;
- zero-step publication is architecturally redundant even if serialization is
  cheaper than Task 5 assumed.

The “7 vs. 407 calls” figures are arithmetic/source-level counts, not measured
Hermes timings. They correct the mechanism but do not establish a device cost.

### Difference 3: `Canvas.onSize` is display-frequency, not layout-frequency

#### Task 5 position

Task 5 notices that `View.onLayout` and Skia `Canvas.onSize` both write surface
size, but classifies this as Low because it assumes both operate at layout
frequency.

#### Task 6 position

Task 6 inspects Skia 2.6.2 and finds that supplying `Canvas.onSize` enables a
permanent Reanimated frame callback that calls native `measure()` on every UI
frame. The value changes only after layout, but the measurement poll runs for
the Canvas's entire mounted life.

#### Combined conclusion

Task 6 corrects Task 5 here. Promote this from Low to **High-confidence
always-on waste**:

- remove `Canvas.onSize`;
- retain `View.onLayout` as the single surface-size source;
- use `Fill` so the background does not consume the surface-size shared value;
- validate rotation, split view, Stage Manager, and all viewport modes.

This mechanism is confirmed by source inspection. Its exact contribution to
the reported UI jank still requires a device trace.

### Difference 4: mapper severity and Skia `select()`

#### Task 5 position

Task 5 calls the 138-value graph a Medium scaling risk and proposes reducing
moving entities to coherent values manually. It correctly avoids premature
batching and requires measurement of actual UI/GPU impact.

#### Task 6 position

Task 6 promotes the issue to High because 134 values depend on the frame root
and are dirtied on every publish. It identifies Skia 2.11 `select()` as a new
enabler that can project multiple properties from a grouped shared value. Its
design projection reduces registrations from 138 to about 4.

#### Combined conclusion

Adopt Task 6's sharper mechanism and evaluate `select()` as the preferred
simplification. Preserve Task 5's measurement gate:

- 138 to 4 is a projected registration reduction, not a guaranteed 97%
  frame-time improvement;
- GPU fill, Skia replay, and compositor time must be measured separately;
- the Skia upgrade is outside Expo SDK 57's validated dependency matrix;
- retain a current-version/manual fallback until native compatibility is
  proven.

### Difference 5: pointer crossing severity

#### Task 5 position

Task 5 labels raw move crossing **Critical** because it is an architectural
runtime-boundary defect affecting every changed touch sample.

#### Task 6 position

Task 6 labels it **High** because it is bounded by hardware touch rate, occurs
only while a pointer is active, and extra movement is already discarded by the
fixed-step sample. In contrast, freezing, frame publication, mapper work, and
`onSize` polling run continuously.

#### Combined conclusion

Use **High for the current Brick Breaker investigation**, especially when
prioritizing idle UI drops. Keep it as a mandatory architectural fix before the
input API is considered production-ready: input-heavy games and multiple
actions can amplify the cost, and exact input latency is product-critical.

Coalescing should follow the always-on fixes and must pass measured
input-to-visible latency and edge-ordering gates.

### Difference 6: baseline-first versus immediate cleanup

#### Task 5 position

Task 5 says not to begin performance architecture changes until Phase 0 can
measure crossings, frame time, snapshot stages, input latency, startup, and
lifecycle behavior on physical devices.

#### Task 6 position

Task 6 allows `onSize` removal and API/correctness cleanup before a device
trace because they remove provably useless work or fix defects. It then places
`deepFreeze` before the commit/alpha split.

#### Combined conclusion

Keep Task 5's baseline-first rule for **all performance-affecting changes**.
Removing `onSize` before the first capture would prevent measuring one of Task
6's strongest UI-thread findings against the original implementation.

The preferred sequence is:

1. Implement only the minimum diagnostics required for an honest baseline.
2. Capture and preserve the original baseline.
3. Land provable-waste removals and re-capture.
4. Continue one attributable performance change at a time.

Pure formatting and correctness changes that cannot affect timing may land
independently, but they should not be mixed into benchmarked performance
commits.

### Difference 7: dependency upgrades

#### Task 5 position

Task 5 records the installed dependency baseline and avoids relying on
unverified newer APIs.

#### Task 6 position

Task 6 recommends:

- Skia 2.11.0 for `select()`;
- patch-level Reanimated and Worklets updates;
- keeping Gesture Handler on 2.32.0 rather than combining its 3.x migration
  with the input refactor.

It also records that these upgrades diverge from Expo SDK 57's validated
native-module pins.

#### Combined conclusion

Treat the Skia change as an isolated, evidence-producing upgrade, not an
automatic prerequisite for all Task 5 work:

- capture the original baseline first;
- re-check current package versions and compatibility when executing this
  step, because “latest” claims are time-sensitive;
- update the library peer, library exact dev dependency, and playground native
  dependency together;
- run clean Expo prebuilds, native debug/release builds, packaging checks, and
  repeated mount/unmount tests;
- capture performance before any `select()` renderer refactor so the dependency
  upgrade and code change remain separately attributable;
- keep Gesture Handler 3 as a separate future migration.

## Task 6 findings that complement rather than contradict Task 5

Task 6 adds several useful cleanup items that Task 5 does not cover:

- remove unused `sceneElapsedSeconds` state;
- remove no-op `try/catch` blocks;
- deeply freeze the exposed viewport configuration;
- make the unimplemented `assets` field optional until asset loading exists;
- fix the pointer-binding formatting defect;
- capture checked frame-driver functions instead of relying on non-null
  assertions;
- fix or remove the HUD's structurally dead `won` field;
- add a presentation binding epoch so delayed writes from an old session cannot
  move a replacement session backward.

These should be preserved in the final plan. Correctness/API cleanup should be
kept separate from performance commits when possible.

## Recommended combined priority

### Phase 0: measurement foundation

1. Add the smallest tree-shakeable diagnostics/performance-lab harness from
   Task 5.
2. Capture the unmodified baseline on a physical 60 Hz iPhone, mid-range
   Android, and 120 Hz iPad where available.
3. Record JS/UI p50/p95/p99, zero-step callbacks, commit notifications, mapper
   activity, pointer crossings, input latency, allocation/GC, memory, startup,
   and thermal/build metadata.

### Phase 1: confirmed always-on waste and safe JS scaling work

1. Remove `Canvas.onSize`, keep `onLayout`, and replace the background with
   `Fill`.
2. Add the trusted deep-freeze cache and array fast path without weakening
   public immutability.
3. Hoist static brick geometry and preserve liveness identity on no-hit steps,
   allowing the freeze cache to skip the shared subtree.
4. Capture each before/after result independently.

### Phase 2: structural frame-pipeline correction

1. Split commit-frequency snapshots from UI-owned presentation alpha.
2. Add revision plus binding epoch ordering.
3. Eliminate zero-step publication and display-rate HUD notification.
4. Preserve adjacent-pair catch-up, hard cuts, pause/background behavior, and
   deterministic 30/60/90/120 Hz results.

### Phase 3: dependency and renderer graph

1. Validate the chosen Skia/Reanimated/Worklets versions in an isolated native
   dependency commit.
2. If accepted, use Skia `select()` with grouped animated values.
3. Apply one logical-world parent transform.
4. Remove static brick derivations and repeated interpolation objects.
5. Prove at least a 75% registration reduction and separately measure UI,
   Skia/GPU, and compositor results.

### Phase 4: input and semantic consumers

1. Coalesce pointer moves on UI with one ordered queue per action.
2. Preserve immediate edges and terminal coordinates.
3. Move HUD work to commit frequency and compare before `setState`.
4. Introduce a minimal renderer-neutral semantic event seam only when needed
   for sound and haptics.

### Phase 5: experiments and guardrails

1. Run the startup-fade A/B.
2. Run the renderer scaling and shared-texture scenarios before considering
   `Atlas`, `Picture`, or another backend.
3. Complete the 50-cycle lifecycle/leak scenario.
4. Publish the final physical-device before/after table and performance model.

## Final combined conclusions

1. **Task 5's target architecture is correct.** Keep its commit/UI-alpha split,
   runtime ownership model, input coalescing design, renderer neutrality, and
   physical-device performance gates.
2. **Task 6 corrects important mechanisms.** Update the working plan to reflect
   identity-cached Worklets serialization, permanent `Canvas.onSize` polling,
   the measured relative cost of `deepFreeze`, and the possible Skia `select()`
   path.
3. **Do not describe `deepFreeze` as the proven cause of the user's frame
   drops.** It dominates Task 6's measured snapshot subset and is a serious
   scaling issue, but physical Hermes/UI attribution is still missing.
4. **Do not describe transport serialization as the primary P2 cost.** The
   architectural defect remains Critical because of invalidation fan-out,
   display-rate JS work, and JS-owned interpolation.
5. **Treat `Canvas.onSize` removal as the first UI-thread correction after the
   baseline.** It is always-on work with no current need.
6. **Treat the Skia upgrade as a controlled experiment.** `select()` is a
   compelling simplifier, but Expo matrix deviation and native lifecycle risk
   must be proven on all target platforms.
7. **Apply performance changes one at a time after the baseline.** This is the
   only way to know which conclusion survives physical-device measurement.

The combined plan is therefore not “Task 5 or Task 6.” Task 5 supplies the
stronger experimental method and overall architecture; Task 6 supplies several
better mechanism-level corrections and a more useful early optimization order.
