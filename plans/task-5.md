# Task 5: Frame-pipeline performance architecture and benchmark harness

## Status

Ready to execute after Task 3 and Task 4 are accepted.

This document is both the performance review requested after the first playable
GameKit implementation and the execution plan for fixing the issues found.
It intentionally separates:

- costs confirmed by reading the current implementation;
- likely explanations for the reported UI-thread and JS-thread frame drops;
- hypotheses that still require an A/B trace;
- changes that are explicitly not justified yet.

No device trace was captured as part of this code review, so the magnitude of
each cost has not yet been measured. Phase 0 exists to turn the current
evidence into a reproducible baseline before the architecture is changed.

## Objective

Make React Native GameKit capable of consistently presenting a 60 Hz fixed-step
2D game on phones and tablets, while taking advantage of 90/120 Hz displays for
smoother presentation when the device has enough headroom.

The implementation must:

- keep deterministic gameplay simulation on the React Native JS runtime;
- keep per-display-frame presentation work on the Reanimated UI runtime;
- keep Skia's React node topology stable during gameplay;
- bound and minimize UI-to-JS and JS-to-UI runtime crossings;
- avoid React state, Zustand, or React reconciliation in the live frame path;
- preserve the simple, headless-first GameKit API;
- remain renderer-neutral in the core so a future 3D renderer can use the same
  simulation/commit contract;
- support iPhone, Android phones, iPad, high-refresh iPad Pro, rotation, and
  split-view resizing;
- establish repeatable performance gates so later engine work cannot quietly
  regress the frame pipeline.

## Review inputs

The review used the project code plus the local skills generated from the
official Shopify React Native Skia and Software Mansion Reanimated/Worklets
documentation:

- .agents/skills/react-native-gamekit-performance/
- .agents/skills/react-native-skia/
- .agents/skills/reanimated-skia-performance/

The key rules applied from those skills were:

1. Give each kind of live data one owning runtime.
2. Keep high-frequency data on the runtime that consumes it.
3. Cross runtimes at explicit, bounded synchronization points with small
   payloads.
4. Keep authoritative simulation deterministic and independent of display
   refresh rate.
5. Use Reanimated shared values and worklets for UI-owned presentation, but do
   not assume that using a worklet automatically makes an operation cheap.
6. Avoid reading UI-owned shared values synchronously from the RN runtime in a
   hot loop because the RN runtime may wait for the UI runtime.
7. Keep Skia topology stable, map the logical viewport once where possible, and
   choose Atlas, Picture, or custom drawing only after profiling the actual
   content.
8. Profile physical devices in release-like builds; simulator and development
   FPS readings are diagnostic hints, not release gates.

## Current dependency and native baseline

The reviewed workspace currently uses:

| Component | Version/configuration |
| --- | --- |
| React Native | 0.86.2 |
| React | 19.2.3 |
| Expo | 57.0.10 |
| React Native Skia | 2.6.2 |
| Reanimated | 4.5.1 |
| React Native Worklets | 0.10.1 |
| Gesture Handler | 2.32.0 |
| Hermes | enabled on iOS and Android |
| React Native New Architecture | enabled on iOS and Android |
| Expo Go | not required; the playground uses prebuild/native projects |
| iPad | supported, all four orientations, full-screen not required |
| iPhone high refresh | CADisableMinimumFrameDurationOnPhone is enabled |

The package declares tightly constrained native peer ranges. Skia, Reanimated,
and Worklets are exact peers; the Expo/RN ecosystem peers use compatible
ranges. The package also installs concrete matching development versions, and
the playground installs matching concrete versions. They are not missing
merely because the monorepo root package does not list them.

The generated iOS Podfile properties explicitly select Hermes, and the
generated CocoaPods build settings define RCT_NEW_ARCH_ENABLED for debug and
release. Android gradle.properties enables both Hermes and the New
Architecture. Regenerated native projects must retain these settings.

The Skia audit helper reported missing dependencies when run from the root. That
is a monorepo-awareness limitation in the helper: it inspected only the root
package.json. Do not add duplicate native dependencies to the root in response
to those warnings.

## Verification baseline before performance work

The following checks passed on 2026-08-07:

- react-native-gamekit: 123 tests passed;
- playground: 26 tests passed;
- react-native-gamekit TypeScript check passed;
- playground TypeScript check passed.

The playground Node test command emits MODULE_TYPELESS_PACKAGE_JSON warnings
and reparses the test files as ES modules. This affects the Node test harness,
not mobile frame performance. Resolve it as test-harness hygiene only after
confirming that adding a package module type does not disturb Expo or existing
tooling.

The existing 30/60/120 Hz tests prove deterministic tick results under
different presentation callback rates. They do not measure UI frame duration,
JS frame duration, runtime-crossing cost, allocations, garbage collection, or
input latency.

## What is already correct

These decisions should be retained:

- Simulation uses a fixed time step with a bounded catch-up loop.
- Presentation refresh rate does not change the deterministic simulation
  result.
- Excess catch-up debt is bounded instead of allowing a spiral of death.
- App backgrounding and pause reset wall-clock debt.
- Session ownership and disposal are explicit.
- React owns the surface and low-frequency overlays, not gameplay positions.
- Zustand is restricted to low-frequency playground shell state.
- The Skia tree is currently fixed during gameplay.
- Drawing and input share the same viewport model.
- Viewport tests cover phone, tablet, orientation, ultrawide, and split-view
  layouts.
- Gesture Handler remains isolated in the React adapter rather than leaking
  platform event types into the headless core.
- The core simulation API does not depend on Skia, which is important for
  future 3D support.
- iOS high-refresh presentation is not blocked by the minimum frame-duration
  setting.

Task 5 is a pipeline refinement, not a replacement of these foundations.

## Executive diagnosis

The most important issue is not the number of Skia shapes. Brick Breaker draws
roughly three dozen simple shapes, which should be a modest scene. The larger
problem is that live data crosses runtimes at the wrong frequency and then
fans out into too many UI worklets.

Two costs dominate the design:

1. Every changed pointer move schedules a UI-to-JS call.
2. Every JS requestAnimationFrame callback publishes a newly allocated,
   deeply structured render-frame object to the UI runtime, even when no fixed
   simulation tick occurred.

At 120 Hz, the second path sends the same previous/current snapshots across the
runtime boundary twice per simulation tick merely to update interpolation
alpha. Once that object arrives, Brick Breaker has approximately 138 derived
values that can be invalidated from it. During a drag, the first path adds
touch-sample-rate UI-to-JS traffic and multiple point allocations.

This architecture can therefore pressure both reported counters:

- UI thread/runtime: gesture callbacks, cross-runtime scheduling, shared-value
  propagation, a large derived-value graph, repeated interpolation allocations,
  Skia property updates, and possible full-screen fade compositing at startup;
- JS thread/runtime: display-rate requestAnimationFrame callbacks, full-frame
  object creation/publication, listener fan-out, input event handling,
  viewport conversion, input sampling allocations, state/snapshot allocation,
  and recursive deep freezing.

The code review confirms those operations exist. Phase 0 must quantify which
ones dominate on each target device before and after every change.

## Current frame and input flow

~~~text
Native touch sample
  -> Gesture Handler callback on UI runtime
     -> runOnJS for every changed touch, including every move
        -> JS pointer binding
           -> surface-to-world conversion
              -> JS input buffer mutation
                 -> next fixed simulation sample

JS requestAnimationFrame at display refresh
  -> accumulate wall time
  -> zero or more 60 Hz fixed simulation updates
     -> allocate input frame and update context
     -> allocate next immutable state
     -> build snapshot
     -> recursively deep-freeze snapshot
  -> publish a newly frozen GameRenderFrame on every display callback
     -> GameView assigns the whole object to a Reanimated shared value
        -> object is made shareable and delivered to UI runtime
           -> many useDerivedValue nodes wake
              -> Skia properties update
     -> HUD listener selects and enqueues a React state updater
~~~

At 120 Hz, the simulation still runs at 60 Hz, but the zero-tick callbacks
still publish. This is unnecessary work and makes presentation dependent on
the JS runtime even though alpha is presentation-only data.

## Detailed findings

### Severity and confidence key

- Critical: pipeline architecture that can affect every active frame or every
  touch sample and limits larger games.
- High: material hot-path fan-out or allocation that should be addressed in
  this task.
- Medium: real work in a hot or startup path whose device impact still needs
  measurement.
- Low: cleanup or layout-frequency work, not a plausible primary cause.
- Confirmed mechanism: the operation is directly present in code.
- Impact unmeasured: no physical-device trace yet proves its exact share of a
  dropped frame.
- Hypothesis: plausible, but it must not be changed without an A/B capture.

| ID | Severity | Thread/runtime | Finding | Confidence |
| --- | --- | --- | --- | --- |
| P1 | Critical | UI -> JS | Every pointer move crosses runtimes immediately | Confirmed mechanism; likely contributor |
| P2 | Critical | JS -> UI | A complete render-frame object crosses on every display callback | Confirmed mechanism; likely contributor |
| P3 | Medium scaling risk | UI | Brick Breaker creates about 138 derived-value nodes | Confirmed mechanism; impact unmeasured |
| P4 | Medium | UI | Ball interpolation allocates objects twice per displayed frame | Confirmed mechanism; impact unmeasured |
| P5 | High | JS | Simulation ticks recursively freeze and allocate several short-lived objects | Confirmed mechanism; impact unmeasured |
| P6 | Medium | JS and bridge | Brick geometry and brick arrays are copied every tick | Confirmed mechanism; impact unmeasured |
| P7 | Medium | JS/React | HUD selector/listener runs for every published presentation frame | Confirmed mechanism; React usually bails out |
| P8 | Medium | UI/GPU startup | Whole game canvas mounts under a full-screen opacity fade | Hypothesis; requires A/B |
| P9 | Low | Layout | Surface size has both onLayout and Canvas onSize writers | Confirmed, layout-frequency only |
| P10 | Low now | JS | Listener Set is spread into a new array on every publish | Confirmed; mostly removed by P2 |

### P1 — Pointer moves cross from UI to JS at raw event frequency

Evidence:

- packages/gamekit/src/react/GamePointerInput.tsx:94-123 defines gesture
  worklets.
- GamePointerInput.tsx:104-108 invokes runOnJS once for every changed touch in
  every move callback.
- packages/gamekit/src/react/pointerBinding.ts:126-143 creates surface point
  objects and forwards the final up position.
- pointerBinding.ts:98-107 performs viewport conversion on JS.
- packages/gamekit/src/core/input/createInputBuffer.ts:149-162 validates,
  accumulates, freezes, and stores another point.

One raw move can therefore cause:

- a worklet-to-RN scheduling operation;
- argument serialization/shareable conversion;
- a JS callback;
- a temporary surface point;
- a world point returned by viewport conversion;
- another frozen point stored by the input buffer.

The existing semantics are good: the first pointer owns the action, begins in
letterbox space are rejected, final up coordinates are preserved, edges between
ticks are not lost, and layout invalidation cancels the gesture. The transport
frequency is the problem.

Recommendation:

- Keep the latest raw move in UI-owned shared/worklet state.
- Coalesce move updates on the UI runtime.
- Send at most one compact move sample per configured input sampling interval;
  the initial target is the 60 Hz fixed-step interval, not raw touch frequency.
- Continue to send down, up, and cancel as discrete ordered edges.
- Before up, flush the final position and then deliver the terminal edge in the
  same ordered RN callback so the release frame remains correct.
- Keep the authoritative input buffer and simulation on JS.
- Use the current Worklets scheduling API when the adapter is touched; simply
  renaming runOnJS does not solve the frequency problem.
- Do not make synchronous JS reads of a UI shared value every tick as the
  default design. Such reads can block waiting for the UI runtime.

The fallback Gesture Handler option that runs the whole callback on JS may be
useful as an A/B baseline, but it still processes every raw move and is not the
recommended final pipeline.

Required measurement:

- raw move events per second;
- coalesced samples per second;
- UI-to-JS calls per second;
- dropped/coalesced move count;
- down/up/cancel counts;
- input-to-visible latency;
- UI and JS frame times during a repeatable continuous drag.

### P2 — Full render frames cross from JS to UI at display rate

Evidence:

- packages/gamekit/src/core/frameDriver.ts:18-27 uses JS
  requestAnimationFrame.
- packages/gamekit/src/core/session/createGameSession.ts:376-487 schedules the
  fixed-step loop.
- createGameSession.ts:203-223 allocates and freezes a new GameRenderFrame and
  copies the listener Set.
- createGameSession.ts:401-405 publishes on the baseline callback.
- createGameSession.ts:481-483 publishes after every callback, including a
  callback that ran zero simulation steps.
- packages/gamekit/src/react/GameView.tsx:80-83 assigns that complete object to
  one Reanimated shared value.

At a 120 Hz display with a 60 Hz fixed step, every other callback normally has
no simulation commit. Previous and current snapshots do not change, yet a new
frame object crosses to UI so alpha can change. This has four consequences:

1. JS performs publication and listener work at display rate.
2. A new generic frame root is made shareable repeatedly. Worklets may cache
   unchanged nested object identities, but every new snapshot still enters the
   generic shareable graph and the root assignment still propagates.
3. All UI consumers of the frame object can be invalidated together.
4. Interpolation progress stalls whenever JS is delayed, even though progress
   is presentation-only state.

Recommendation:

- Separate a simulation commit from a displayed presentation frame.
- Publish a new immutable snapshot pair only after one or more fixed steps, a
  committed scene transition, restart, or another explicit state commit.
- Make interpolation alpha a separate UI-owned scalar.
- Advance/clamp alpha with a UI frame callback or equivalent UI-owned clock.
- When a new snapshot pair arrives, reset the UI interpolation interval.
- Clamp at the current snapshot; never extrapolate gameplay while JS is late.
- Preserve hard-cut semantics across scene transitions.
- Keep getRenderFrame for headless tests and inspection, but do not use a
  display-rate JS listener as the Skia clock. Preserve its documented alpha
  semantics by constructing the diagnostic frame on demand from current
  accumulator state rather than allocating it on every display callback.
- Make the zero-tick JS callback allocation-free apart from scheduling its
  successor: update timing, detect no fixed step, and return without notifying
  renderers or HUD listeners.

Recommended renderer-facing shape:

~~~text
presentation.commit
  -> SharedValue of one immutable snapshot-pair envelope
  -> updated only when simulation commits

presentation.alpha
  -> SharedValue<number>
  -> owned and advanced on UI runtime each display frame

viewport
  -> SharedValue updated only when layout changes
~~~

The exact public names should be decided before implementation, but the two
frequencies must remain separate. This is early enough in the package lifecycle
to avoid permanently exposing one monolithic per-frame object.

For small games, the default snapshot pair can remain a generic immutable
object. Before large entity counts, benchmark an optional renderer adapter that
projects the authoritative state into compact renderer-facing channels. Do not
force a complex buffer API into v1 without that evidence.

Required tests:

- 30/60/120 Hz presentation still produces identical deterministic ticks.
- A 120 Hz driver does not cause 120 JS-to-UI commit notifications for 60
  simulation commits.
- A zero-tick callback does not publish.
- Multiple catch-up steps in one callback publish only the final committed
  snapshot pair once.
- UI alpha reaches 1 and holds when JS stops committing.
- UI alpha never exceeds 1 and never extrapolates.
- transition/restart frames hard-cut with previous equal to current;
- pause/resume resets interpolation timing and cannot blend across stale wall
  time;
- listener errors and disposal retain their existing honest failure semantics.

### P3 — Excessive UI derived-value fan-out

Evidence in apps/playground/src/renderers/BrickBreakerRenderer.tsx:

- background: two derived values;
- paddle: four derived values;
- ball: four derived values;
- 32 bricks: four derived values each, or 128;
- approximate total: 138 derived values reading the frame, viewport, or size.

Each brick recomputes x, y, width, and height even though brick geometry is
static. Assigning a new root frame object invalidates the shared dependency
used by all of them.

Recommendation:

- Replace the size-derived background Rect with Skia Fill.
- Map logical world coordinates to surface coordinates once on a parent Group
  transform. Validate transform order against the existing viewport tests,
  especially fit letterboxing and iPad split view.
- Keep paddle, ball, and brick geometry authored in logical coordinates.
- Keep static brick positions and sizes out of per-frame derived values.
- Reduce moving entities to one coherent derived transform/position each where
  practical.
- Represent brick liveness as one compact, commit-frequency value.
- First retain ordinary Rect nodes after removing property fan-out. Thirty-two
  simple rectangles are not enough evidence to require Atlas.
- A later measured experiment may batch same-colored brick rectangles into a
  small number of paths rebuilt only when the alive mask changes.
- Use Atlas for many instances that share a texture. Use Picture for immutable
  reusable command lists or for a measured dynamic command-list workload.
  Never re-record a large Picture every frame without measuring recording and
  playback separately. Neither primitive is a generic performance switch.

Acceptance is based on measured mapper/worklet count and UI frame time. The
Brick Breaker renderer should reduce the derived graph by at least 75 percent
from the measured baseline without changing visuals, hit mapping, interpolation
semantics, rotation, or split-view behavior.

### P4 — Repeated UI interpolation allocation

apps/playground/src/renderers/interpolation.ts:20-29 returns a new ball point
object. BrickBreakerRenderer.tsx:72-87 calls it independently for x and y, so
two objects are created for one ball on every displayed frame.

Recommendation:

- use a scalar worklet-safe lerp helper for x and y; or
- compute one coherent derived ball position and consume it once if Skia's
  property shape allows that without reintroducing broader invalidation.

This is a small, low-risk improvement and should be measured with the renderer
fan-out work, not presented as the sole explanation for dropped frames.

### P5 — Allocation and recursive freezing in the JS fixed-step path

Evidence in createGameSession.ts:

- deepFreeze recursively walks Reflect.ownKeys and starts with a new WeakSet for
  every call at lines 63-75.
- snapshots are deep-frozen after every fixed update at line 457.
- a new update scope, transition controller, update context, and often state
  object are created for each step at lines 428-441.
- makeTransitionController creates closures and a frozen object at lines
  331-374.
- a new frozen render-frame root is created on every display publication.

Evidence in createInputBuffer.ts:

- sample creates a new Map at lines 229-248;
- it creates new frozen button/pointer state objects;
- it creates another frozen accessor object with method closures at lines
  250-271;
- pointer moves freeze replacement point objects.

Recommendation:

1. Remove display-rate publication first. It is the clearest redundant
   allocation.
2. Preserve the public immutable snapshot contract.
3. Make snapshot authors structurally share unchanged objects.
4. Consider a session-owned WeakSet containing only objects that GameKit has
   already fully deep-frozen. Reused immutable subtrees can then be skipped
   safely on later snapshots while new roots are still verified.
5. Use a separate per-traversal visiting set for cycle detection. Add an object
   to the session's trusted cache only after its full recursive traversal and
   freezing succeeds; a failed child traversal must never mark the parent
   trusted.
6. Do not use Object.isFrozen alone to skip recursion: an externally
   shallow-frozen object can still contain mutable children.
7. Compile input action names/kinds to indexed internal slots at game/session
   creation instead of rebuilding a Map of action metadata each sample.
8. Any optimized public input view must remain immutable for its valid update
   and must not let a retained old sample silently observe future input.
9. Profile the update context and transition controller before redesigning
   them. A naive stable controller is incorrect because a retained controller
   is currently required to throw outside its owning update. Preserve that
   generation/scope safety test if closures are reduced.
10. Do not disable deep freeze in production as an incidental optimization. A
   dev-only freeze policy would change observable API semantics and requires a
   separate, documented decision backed by measurements.

Measure step, input sample, snapshot, deep-freeze, and publish durations
separately. Capture allocation/GC evidence before and after; do not optimize
only from object counts.

### P6 — Brick data is copied through state and snapshots every tick

Evidence in apps/playground/src/games/brickBreakerGame.ts:

- collideBallWithBricks copies the whole brick array even when nothing hits at
  line 163;
- a hit spreads a brick at line 170;
- every fixed step returns a new play state at line 315;
- every snapshot maps every brick into a new geometry object at line 320;
- GameKit then recursively deep-freezes the result.

Recommendation:

- Make the brick grid geometry static immutable data.
- Store only dynamic liveness in live state.
- For this 32-brick example, benchmark a number bit mask against a structurally
  shared readonly boolean collection; choose the clearer representation unless
  the trace shows a meaningful difference.
- Copy liveness only on the first collision in a tick. Return/share the
  original liveness data when there is no hit.
- Keep static geometry out of every render snapshot.
- Reduce the play snapshot to moving values, score/prompt state, and the compact
  liveness representation.
- Keep the reference game readable. It should teach users the normal performant
  pattern, not expose premature engine-internal tricks.

### P7 — HUD work runs at presentation frequency

BrickBreakerGameScreen.tsx:19-35 registers a render-frame listener. Every
publication calls setValue with a functional updater. Equality usually returns
the previous object and prevents a React render, but the listener, selector,
state enqueue, and equality check still run.

Recommendation:

- Once P2 exists, subscribe HUDs only to simulation commits.
- Select and compare against a ref before calling setState so unchanged values
  do not enqueue a state update.
- Keep score, scene, prompt, pause, and menu state low-frequency.
- Do not put HUD values in the UI display-frame path merely because the Canvas
  uses shared values.
- Prefer a small commit-selector helper before inventing a global event bus.
- Design discrete gameplay events so future sound and haptic triggers can
  subscribe to semantic edges such as brick hit, score changed, game over, or
  button pressed. Audio and haptics must not be driven by render frames.

### P8 — Full-screen game fade may add startup pressure

PlaygroundShell.tsx:49-95 mounts the game and starts its session while an
Animated.View containing the full Canvas fades from opacity 0 to 1 over 180 ms.
Animating opacity for a full-screen drawing surface may add compositing work at
the same time the session, renderer, gesture tree, and Canvas initialize.

This is a hypothesis, not a confirmed root cause.

Required experiment:

- capture the first 500 ms after opening Brick Breaker with the fade enabled;
- repeat with immediate opacity 1;
- repeat by keeping the game opaque and fading an opaque cover away;
- use identical builds/device/thermal state and at least three runs.

If the fade is responsible for meaningful missed frames, prefer the opaque game
plus dismissing cover. Consider deferring session start only if that produces a
better measured result and does not make input/readiness feel delayed. If the
trace shows no meaningful difference, keep the current transition.

### P9 and P10 — Minor cleanup

- GameView writes surfaceSize from View.onLayout while Canvas also receives it
  through onSize. This happens on layout changes, not every frame. Choose one
  authoritative source only after verifying rotation and iPad split view.
- publish spreads listeners into a new array before iterating. The defensive
  iteration semantics are useful. Reducing publication from display rate to
  commit rate likely makes this negligible; do not weaken subscription
  correctness for an unmeasured micro-optimization.

## Root-cause ranking

Implement and measure in this order:

1. Establish a repeatable release-like benchmark and counters.
2. Separate commit-rate snapshots from UI-owned interpolation.
3. Coalesce UI-owned pointer moves before crossing to JS.
4. Reduce Brick Breaker's UI derived graph and UI allocations.
5. Optimize engine fixed-step allocations proven hot by the post-P2 trace.
6. Reduce reference-game snapshot/state copying, moving this ahead of engine
   micro-optimization if the trace shows the example's copying dominates.
7. Move HUD work to commit/semantic frequency.
8. A/B the startup fade.
9. Clean up layout-frequency and test-harness warnings.

P2 and P1 are architectural. P3/P4/P6 are important reference-renderer and
reference-game work. P5 must be profiler-led because some allocations enforce
valuable API guarantees.

## Target architecture

~~~text
                         LOW-FREQUENCY REACT LANE
                         ------------------------
simulation commit -> selector/equality -> React HUD only when value changes
                  -> discrete semantic events -> future audio/haptics

UI / Reanimated runtime                         React Native JS runtime
-----------------------                         -----------------------
native pointer callbacks
  -> latest UI-owned point
  -> coalesce at bounded interval
  -> schedule compact ordered packet --------> JS input buffer
       down/up/cancel remain discrete               |
                                                    v
UI frame callback                              fixed 60 Hz simulation
  -> advance alpha only                            -> sample input
  -> clamp [0, 1]                                  -> update state
       |                                           -> snapshot once/tick
       |                                           -> deep-freeze/share
       |                                                |
       |           commit envelope only when changed <---+
       |           <---------------------------------
       v
Skia renderer
  -> stable topology
  -> one viewport transform
  -> compact dynamic channels
  -> static geometry stays static
~~~

### Runtime ownership contract

| Data | Owner | Crossing rule |
| --- | --- | --- |
| authoritative game state | JS runtime | never copied to React state per frame |
| fixed-step input state/edges | JS runtime | receives bounded compact packets |
| raw pointer coordinates | UI runtime | latest value stays UI-owned |
| down/up/cancel edges | UI then JS | cross immediately and in order |
| previous/current render snapshots | JS runtime | cross only on commits |
| interpolation alpha | UI runtime | never published from JS each display frame |
| viewport configuration | JS/React layout boundary | cross only on layout revision |
| Skia node properties | UI runtime | derived from commit plus alpha |
| HUD/menu/score text | React | update only when selected semantic value changes |
| future audio/haptic commands | discrete game events | never tied to display refresh |

### API constraints

- Do not move authoritative simulation into a worklet.
- Do not expose Reanimated, Skia, or Gesture Handler types from the headless
  package entry.
- Keep the default API approachable for a small game.
- Keep the core commit contract renderer-neutral for a later 3D adapter.
- Preserve discriminated scene snapshots and hard-cut transitions.
- Preserve headless driver injection and deterministic tests.
- Preserve input ownership, edge buffering, cancellation, and final-up
  semantics.
- Do not place live engine data in Zustand.
- Do not add a Worker Runtime yet. The current game is far below the point
  where another runtime's synchronization complexity is justified.
- Do not change native Reanimated feature flags until a trace identifies the
  exact bottleneck and the flag is validated on the complete device matrix.

## Phase 0 — Build the benchmark and diagnostics harness

### Goal

Create a repeatable way to prove where time is spent and prevent every later
phase from becoming a subjective smoothness comparison.

### Approach

- Add an internal benchmark-only Performance Lab entry to the playground
  catalog. Exclude it from the normal public library/API, but make it available
  in dedicated release-like benchmark builds.
- Keep diagnostics optional and tree-shakeable/no-op in normal library use.
- Prefer an internal diagnostics sink first; do not freeze a public API before
  its usefulness is proven.
- Aggregate UI metrics on the UI runtime and transfer summaries no more than
  once per second. A JS callback on every UI frame would invalidate the test.
- Do not JSON.stringify live snapshots to estimate bridge size in the hot path.
  Count commits, entity/channel counts, and measure representative payloads
  outside the active capture instead.
- Let every scenario run from a deterministic seed and a fixed duration.
- Provide a reset action so three comparable runs can be collected without
  restarting the packager.
- Disable the on-screen diagnostic overlay during final Instruments/Perfetto
  captures to measure the game rather than the overlay.

### Required counters

JS/session:

- display callbacks;
- zero-step callbacks;
- fixed steps;
- catch-up steps;
- dropped whole-step debt;
- update duration;
- input sampling duration;
- snapshot duration;
- deep-freeze duration;
- commit publication duration;
- commit notifications;
- listener count;
- max, p50, p95, and p99 duration summaries;
- allocation/GC/memory observations from platform tools.

UI/presentation:

- presented frame deltas;
- missed-frame count relative to current refresh rate;
- p50, p95, and p99 frame delta;
- commit envelope updates;
- alpha updates;
- active mapper/derived-worklet count where tooling exposes it;
- UI-to-JS pointer calls;
- raw/coalesced/forwarded input counts.

Interaction:

- input-to-visible latency for a scripted drag/tap;
- first-game-frame time;
- first-interactive time;
- open/close session count and retained memory.

### Benchmark scenarios

1. Bootstrap scene idle.
2. Brick Breaker idle without touch.
3. Brick Breaker continuous scripted or recorded/replayed drag for at least 20
   seconds. Manual drag is exploratory only and cannot approve a gate.
4. JS-stall probe: block JS for a controlled short interval and verify UI alpha
   completes the current interpolation then holds without extrapolating.
5. Renderer scaling scene at 32, 100, 500, and 1,000 objects.
6. Sprite/tile scene using a shared texture, used later to compare retained
   nodes with Atlas.
7. Tablet fill-rate scene in portrait, landscape, and split view.
8. Open and close a game 50 times to find leaked sessions/listeners/resources.
9. Startup fade A/B.

### Device/build matrix

Final gates require physical devices:

- a representative 60 Hz iPhone;
- a 120 Hz ProMotion iPhone when available;
- a mid-range Android device at its supported 60/90/120 Hz modes;
- a standard 60 Hz iPad;
- a 120 Hz iPad Pro when available;
- iPad portrait, landscape, and at least one narrow split-view size.

For each capture record:

- commit SHA and dirty-worktree note;
- exact dependency versions;
- device model, OS version, refresh mode, and power mode;
- build configuration;
- scenario, seed, duration, and run number;
- initial and final thermal state where tooling exposes it;
- whether overlays/loggers/remote debugging were enabled.

Use release or debug-optimized native builds for performance conclusions.
Development builds may be used to locate a problem, never to approve the gate.

### Initial budgets

The physical display frame budget is approximately:

- 16.67 ms at 60 Hz;
- 11.11 ms at 90 Hz;
- 8.33 ms at 120 Hz.

Task 5 should leave headroom rather than merely averaging under the budget.
Phase 0 must record baseline p95/p99 values and then lock device-specific
acceptance thresholds before P1/P2 code lands. Architectural gates can be fixed
now:

- zero-step display callbacks emit zero renderer commits;
- renderer commit count never exceeds the initial envelope plus simulation
  commits and explicit transition/restart commits;
- interpolation alpha is not sent JS-to-UI per display frame;
- raw pointer moves do not each schedule a JS callback;
- move packets are bounded by the configured sampling interval;
- HUD React updates equal semantic changes, not frame count;
- no lifecycle scenario leaks a session, listener, shared resource, or gesture
  binding.

### TDD tasks

- [ ] Add failing unit tests for diagnostics aggregation and percentile/reset
  behavior before implementing it.
- [ ] Add a deterministic fake clock/driver scenario for zero-step, one-step,
  and catch-up counters.
- [ ] Add a pure test seam for pointer raw/coalesced/forwarded counters.
- [ ] Implement the private diagnostics sink behind an explicit benchmark
  build/performance-lab option that also works in release-like captures.
- [ ] Add the Performance Lab catalog entry and deterministic scenarios.
- [ ] Document the capture form and save the first baseline table in this file
  or a linked performance-results document.
- [ ] Capture at least three runs per primary scenario on one physical iPhone,
  one physical Android device, and one iPad before Phase 1.
- [ ] Run coverage and retain at least 80 percent coverage for new pure
  diagnostics code.

### Completion gate

Do not begin architecture work until the baseline can answer:

- how many runtime crossings occur per second while idle and while dragging;
- whether UI or JS p95/p99 breaks first;
- how much work occurs on a 120 Hz zero-step callback;
- which part of the JS step costs the most;
- whether the startup fade contributes meaningfully.

## Phase 1 — Split simulation commits from UI presentation

### Goal

Stop publishing a complete render frame from JS at display frequency and make
interpolation progress UI-owned.

### Design tasks

- [ ] Write an API decision note for the renderer-facing commit-plus-alpha
  shape before modifying GameRendererProps.
- [ ] Keep getRenderFrame as the headless/inspection representation.
- [ ] Preserve getRenderFrame alpha as an on-demand diagnostic view computed
  from current accumulator state. Add type documentation and tests making its
  identity/freshness contract explicit.
- [ ] Introduce one immutable commit envelope containing scene, previous,
  current, tick, elapsed time, revision, and hard-cut information.
- [ ] Notify renderer bindings only when that envelope changes.
- [ ] Supply interpolation alpha as a separate UI-owned shared scalar.
- [ ] Advance alpha with a UI frame callback using elapsed UI frame time; reset
  it when the commit revision changes and clamp it at 1.
- [ ] Activate the UI presentation clock only while GameView is mounted and the
  session presentation is running. Stop it on pause, app background, unmount,
  and disposal; resume with reset timing.
- [ ] Give each GameView presentation binding a monotonic epoch in addition to
  the session commit revision. Accept the first commit of a newer epoch and
  ignore older epochs or non-increasing revisions within the active epoch so a
  delayed handoff cannot reset presentation backward.
- [ ] Ensure a hard cut renders current immediately and never blends scene
  snapshot types.
- [ ] Make zero-step JS callbacks avoid publish/listener/frame allocation.
- [ ] Ensure catch-up performs all required simulation snapshots but sends only
  the final adjacent pair once after the callback: the last two committed
  simulation snapshots, not the pre-catch-up snapshot and final snapshot.
  Intermediate visual states may be dropped during recovery; alpha starts from
  the adjacent final pair and clamps at 1.
- [ ] Add addCommitListener for commit-frequency observers and migrate the
  playground to it.
- [ ] Remove addRenderFrameListener before v1 after its consumers, type tests,
  and docs are migrated. Do not silently redefine a method documented as a
  presentation-frame listener.
- [ ] Keep a compatibility layer only if an existing external consumer
  genuinely exists; do not preserve the current hot path merely for hypothetical
  compatibility at version 0.0.0.

### RED tests

- [ ] A 120 Hz fake driver with 60 fixed steps produces no more than 60 commit
  notifications after the initial envelope.
- [ ] A callback with zero fixed steps produces no commit notification.
- [ ] Two catch-up steps in one callback produce one notification containing
  the correct final previous/current pair.
- [ ] Commit revision is monotonic.
- [ ] An older or duplicate asynchronously delivered revision cannot replace a
  newer UI commit or reset alpha.
- [ ] Replacing the GameView game/session identity accepts the new epoch even
  when its revision restarts at zero, and a delayed write from the old epoch is
  ignored.
- [ ] Alpha reset, progression, clamp, pause, resume, and hard-cut behavior are
  tested as pure clock logic.
- [ ] A throwing commit listener pauses the session and leaves no scheduled
  successor callback.
- [ ] Unmount stops the UI clock; pause/background holds safely; resume resets
  timing; React Strict Mode double mount cannot create duplicate active frame
  callbacks.
- [ ] Existing transition failure, disposal, and stale callback tests remain
  green.
- [ ] Existing deterministic 30/60/120 Hz tests remain green.

### GREEN implementation

- [ ] Refactor createGameSession publication around state commits.
- [ ] Refactor bindGameSession and GameView so the JS binding writes only the
  commit envelope.
- [ ] Add the UI-owned alpha clock without React state or per-frame JS calls.
- [ ] Update GameRendererProps and both playground renderers.
- [ ] Update docs and type tests for the renderer contract.

### Benchmark gate

- [ ] Commit crossings on a 120 Hz device fall to simulation commit frequency.
- [ ] Zero-tick publication duration and payload disappear.
- [ ] UI presentation of the current pair continues independently if JS is
  briefly busy, then clamps rather than extrapolating.
- [ ] Determinism, scene hard cuts, pause/resume, and input semantics do not
  regress.
- [ ] Compare p95/p99 UI and JS results against Phase 0 on the same devices.

## Phase 2 — Coalesce pointer movement on the UI runtime

### Goal

Preserve exact pointer-edge semantics while preventing raw touch move frequency
from becoming JS callback frequency.

### Design

- UI-owned worklet state tracks a candidate pointer's latest surface x/y,
  pointer id, dirty revision, and last forwarded time. It must not claim to be
  the authoritative gameplay owner.
- Mirror only the resolved viewport containment check on UI so an invalid
  layout or fit-letterbox begin can fail the Manual gesture before activation.
  Reuse the exact viewport values/formula and repeat validation on JS.
- Keep gameplay action acceptance and primary-pointer ownership authoritative
  on JS. Do not add an asynchronous JS-to-UI acceptance acknowledgement to the
  hot path; the ordered RN queue sends begin before movement and JS ignores
  movement for a rejected/unowned action.
- Down, final move, up, cancel, and any queued move travel through one ordered
  RN packet/queue per action. Independently scheduled calls must not be able to
  overtake one another.
- Move only updates the latest UI-owned position.
- A UI frame/sampling callback forwards the latest dirty point no more often
  than the configured interval. The default maximum coalescing delay is one
  fixed-step interval. A shorter interval on 120 Hz displays is allowed only if
  measured latency justifies the added crossings.
- Up sends the final point and terminal edge together in order.
- Cancel remains a discrete edge.
- Layout revision/unmount cancels ownership and clears queued movement.
- The JS input buffer remains the authority for action ownership and edge
  sampling.
- If viewport conversion moves to UI, the viewport transform must update only
  on layout revisions and must share the exact fit/fill/extend-world math used
  by rendering. Otherwise retain conversion on JS after coalescing. Benchmark
  both before choosing.

### RED tests

- [ ] Hundreds of moves inside one interval forward only the final move.
- [ ] Moves in separate intervals forward once per interval.
- [ ] A begin outside the viewport/fit letterbox is rejected without leaking a
  queued move or leaving the manual gesture active.
- [ ] A move that arrives before JS accepts or rejects begin cannot overtake
  begin or mutate an unaccepted action.
- [ ] Down and up between simulation ticks preserve both edges.
- [ ] The final up coordinate is visible on the release sample.
- [ ] Cancel neutralizes the action exactly once.
- [ ] A secondary pointer cannot steal ownership.
- [ ] End followed by another begin preserves the old terminal edge before
  transferring ownership.
- [ ] Layout revision cancels and drops stale queued moves.
- [ ] Paused/disposed sessions cannot receive or resurrect input.
- [ ] Non-finite ids/coordinates continue to fail at the JS boundary.

### GREEN implementation

- [ ] Extract a pure coalescer state machine so ordering is testable without a
  native gesture mount.
- [ ] Implement UI-owned latest-position state.
- [ ] Use the current Worklets RN scheduling API for bounded packets.
- [ ] Remove per-move runOnJS calls.
- [ ] Add development counters without adding production logging.
- [ ] Update pointer-input documentation with frequency and latency semantics.

### Benchmark gate

- [ ] UI-to-JS move calls stay at or below the configured sampling rate.
- [ ] Down/up/cancel are never dropped or reordered.
- [ ] Continuous-drag UI and JS p95/p99 improve against Phase 0.
- [ ] Input-to-visible latency does not regress beyond the locked Phase 0
  threshold.
- [ ] Test on 60 and 120 Hz phones and iPad split view.

## Phase 3 — Simplify the Skia/Reanimated renderer graph

### Goal

Make Brick Breaker a model renderer whose work scales with dynamic content,
not with four derived worklets per static rectangle.

### TDD/implementation tasks

- [ ] Add visual/geometry assertions for viewport transform order before moving
  mapping to a parent Group.
- [ ] Replace the background Rect and two size derivations with Fill.
- [ ] Apply the resolved viewport transformation once to a logical-coordinate
  Group.
- [ ] Validate both transform order and clipping/content bounds for fit, fill,
  and extend-world. Fill covers the whole surface; transformed gameplay
  content must not leak into letterbox/pillarbox regions unless the selected
  viewport mode intends it.
- [ ] Keep ball, paddle, and bricks in logical coordinates.
- [ ] Replace object-returning ball interpolation with scalar or single-result
  interpolation.
- [ ] Reduce paddle interpolation to one coherent dynamic value/transform.
- [ ] Remove static brick x/y/width/height derived values.
- [ ] Feed brick liveness at commit frequency.
- [ ] Measure ordinary retained Rect nodes after those changes.
- [ ] Add an isolated A/B implementation that batches alive bricks by color
  into paths rebuilt only when liveness changes.
- [ ] Keep the simpler retained implementation unless batching produces a
  repeatable material win.
- [ ] Build the shared-texture scaling scene before evaluating Atlas.
- [ ] Confirm no React render occurs from live ball, paddle, or brick values.

### Benchmark gate

- [ ] Derived mapper/worklet count drops by at least 75 percent in Brick
  Breaker.
- [ ] UI p95/p99 improves or remains within noise with substantially simpler
  code; reject complexity that produces no material gain.
- [ ] Capture Skia/GPU/compositor cost separately from Reanimated mapper count
  so a mapper reduction is not mistaken for a fill-rate or draw-cost win.
- [ ] No visual regression at 60/120 Hz.
- [ ] Fit letterboxing, fill, extend-world, rotation, and split view remain
  correct.
- [ ] No per-frame creation of expensive Skia resources such as images, fonts,
  paths, paints, or shaders, and no unbounded cache growth. Any short-lived
  scalar/transform objects that remain are measured and minimized.

## Phase 4 — Reduce measured JS fixed-step allocation

### Goal

Remove allocation/GC hotspots identified by the Phase 0/Phase 1 traces without
breaking immutable snapshots or update-scope safety.

### Tasks

- [ ] Re-profile after P2 is removed; do not optimize costs that disappeared
  with display-rate publication.
- [ ] Add focused microbenchmarks for input sample, update, snapshot,
  deep-freeze, and commit publication.
- [ ] Precompile input action metadata into indexed slots.
- [ ] Avoid rebuilding action-kind lookup Maps per sample.
- [ ] Preserve immutable sampled states and error messages.
- [ ] Add retained-input tests before attempting any view reuse/pooling.
- [ ] Add a session-owned trusted deep-freeze cache and tests proving reused
  immutable subtrees are skipped while newly introduced nested objects are
  still frozen.
- [ ] Keep cyclic snapshots safe with a per-traversal visiting set, and add
  entries to the cross-snapshot trusted cache only after successful complete
  traversal/freezing.
- [ ] Measure transition-controller cost separately.
- [ ] If controller closures are material, design a generation-token approach
  that still makes every retained old controller throw outside its owning
  update. Do not reuse one controller object in a way that makes an old
  reference valid again on a future tick.
- [ ] Keep the zero-step display callback free of update-context, input-frame,
  snapshot, and commit allocations.

### Benchmark gate

- [ ] JS fixed-step p95/p99 and allocation rate improve on the slowest reference
  device.
- [ ] GC pauses do not create new missed-frame clusters.
- [ ] All input, transition, deep-freeze, disposal, and failure-semantics tests
  remain green.
- [ ] No observable mutability is introduced into public snapshots.

## Phase 5 — Refactor Brick Breaker state and snapshots

### Goal

Make the reference game demonstrate structural sharing and compact render data.

### Tasks

- [ ] Move brick geometry into one deeply immutable static grid.
- [ ] Replace per-brick geometry-plus-alive state with a compact liveness
  representation.
- [ ] Make collision detection lazily clone liveness only after the first hit.
- [ ] Share the original liveness data when no collision occurs.
- [ ] Keep ball and paddle update objects small and explicit.
- [ ] Emit a compact play snapshot with paddle, ball, liveness, score, and
  prompt/result state only.
- [ ] Update collision and deterministic checkpoint tests first.
- [ ] Add a test proving a no-hit step retains the same brick liveness identity.
- [ ] Add a test proving static geometry is not recreated by snapshots.
- [ ] Update renderer tests and docs to explain structural sharing.

### Benchmark gate

- [ ] Per-tick brick geometry allocations are eliminated.
- [ ] Snapshot/deep-freeze duration and allocation rate improve.
- [ ] Gameplay, scoring, win/loss, and 30/60/120 deterministic tests remain
  identical.
- [ ] The example remains understandable to a normal GameKit user.

## Phase 6 — Move HUD and semantic effects off the render-frame path

### Goal

Ensure React overlays and future sound/haptics respond to semantic changes,
never display refresh.

### Tasks

- [ ] Change HUD subscription to commit frequency.
- [ ] Hold the last selected HUD value in a ref and call setState only after an
  equality change is confirmed.
- [ ] Add pure Node tests counting selector calls and state-update requests
  across unchanged commits.
- [ ] Count actual React renders only in an integration/performance-lab test
  with a React Native render harness.
- [ ] Define a minimal discrete gameplay-event seam only if score/audio/haptic
  consumers need more than commit selectors.
- [ ] Keep the event seam renderer-neutral and independent of Zustand.
- [ ] Document that future react-native-audio-api and Pulsar integration must
  preload resources and trigger discrete commands rather than reading render
  frames.
- [ ] Never emit continuous haptics/audio commands from interpolation or raw
  pointer-move callbacks.

### Benchmark gate

- [ ] HUD React renders equal actual HUD value changes.
- [ ] HUD work is absent from zero-step display callbacks.
- [ ] No live gameplay position reaches React or Zustand.

## Phase 7 — Run the startup-fade experiment

### Tasks

- [ ] Capture current full-surface fade startup three times per reference
  device.
- [ ] Capture immediate game mount with no fade.
- [ ] Capture an opaque game with an opaque cover fading away.
- [ ] Compare first-frame, first-interactive, UI frame, and GPU/compositor
  results.
- [ ] Keep current behavior if differences are noise.
- [ ] If confirmed, adopt the least complex winning transition and preserve
  Reduce Motion, accessibility modal behavior, and immediate back/escape.

## Phase 8 — Documentation and performance guardrails

### Required docs

- [ ] Add a GameKit performance model page: JS fixed simulation, commit
  boundary, UI presentation, React overlays.
- [ ] Add a renderer guide covering fixed topology, one viewport transform,
  scalar interpolation, static geometry, resource memoization, and when to
  consider Atlas/Picture.
- [ ] Add an input guide covering UI ownership, coalescing, edge ordering, and
  latency tradeoffs.
- [ ] Add a profiling guide for release-like Expo prebuild apps on iOS,
  Android, and iPad.
- [ ] Document the performance lab scenarios and result format.
- [ ] Record the before/after table, device matrix, rejected experiments, and
  final thresholds.
- [ ] Resolve the Node ESM test warning if it can be done without changing Expo
  module resolution.
- [ ] Keep dependency declarations in their correct package manifests; do not
  duplicate native peers at the monorepo root.

### CI checks

- [ ] Run library and playground tests.
- [ ] Run typechecks, lint, build, package inspection, and coverage.
- [ ] Require at least 80 percent coverage for newly added pure engine logic.
- [ ] Add deterministic counter assertions to CI.
- [ ] Do not pretend CI/simulator FPS is a physical-device performance gate.
- [ ] Attach the physical-device result table to the completion review.

## Completion acceptance criteria

Task 5 is complete only when all of the following are true:

1. The 60 Hz fixed-step simulation remains deterministic at 30/60/90/120 Hz
   presentation callback patterns.
2. JS-to-UI snapshot envelopes cross only on simulation/transition commits.
3. Interpolation alpha is UI-owned and never sent from JS every display frame.
4. A zero-step callback does not allocate/publish a renderer frame or notify
   HUD/render listeners.
5. Raw pointer moves are coalesced and UI-to-JS move calls are bounded.
6. Pointer down/up/cancel/final-position/ownership semantics remain exact.
7. Brick Breaker's derived UI graph is reduced by at least 75 percent from the
   measured baseline.
8. Static brick geometry is not copied through state and snapshots per tick.
9. React and Zustand never receive per-frame gameplay position updates.
10. Deep immutable snapshot behavior and transition scope safety remain intact.
11. No session/listener/resource leak appears after 50 open/close cycles.
12. Physical-device p95/p99 results meet the thresholds locked in Phase 0 on
    the agreed phone and iPad matrix.
13. Release-like traces show no unexplained UI- or JS-frame-drop cluster in the
    baseline Brick Breaker idle and continuous-drag scenarios.
14. The API remains simple for a small 2D game and the core commit model remains
    usable by a future 3D renderer.
15. Tests, typechecks, lint, builds, packaging inspection, and required
    coverage pass.

## Explicitly out of scope

- moving the authoritative simulation to the UI runtime;
- a dedicated Worker Runtime before measured need;
- a native C++/JSI engine rewrite;
- a 3D renderer implementation;
- physics, ECS, asset streaming, audio, or haptic implementation;
- changing Reanimated native feature flags without a targeted trace;
- adopting Atlas for solid rectangles without a shared-texture benchmark;
- caching every frame as a Skia Picture;
- storing game sessions or live frame data in Zustand;
- an in-game navigation/settings API;
- weakening immutable snapshot or lifecycle failure semantics for a micro-win;
- treating simulator FPS as proof of release performance.

## Recommended commit sequence

Keep phases reviewable and benchmarkable:

1. test/perf: add deterministic diagnostics and Performance Lab
2. perf: split simulation commits from UI interpolation
3. perf: coalesce pointer movement across runtimes
4. perf: simplify Brick Breaker Skia presentation
5. perf: reduce measured GameSession/input allocation
6. perf: structurally share Brick Breaker state and snapshots
7. perf: move HUD and semantic effects to commit frequency
8. perf: apply the measured startup-transition result
9. docs: publish the GameKit performance model and final measurements

After every performance commit:

- run the relevant tests and typechecks;
- capture the same scenario on the same reference device;
- record before/after p50/p95/p99 and crossing counts;
- revert or simplify changes whose difference is noise;
- review correctness before beginning the next phase.

## Final handoff template

When implementation is complete, append or link a report containing:

| Item | Required result |
| --- | --- |
| commits tested | exact SHAs |
| devices/builds | complete matrix |
| baseline | p50/p95/p99, crossings, allocations, memory |
| final | same metrics and scenarios |
| P1 result | raw versus forwarded input frequency and latency |
| P2 result | display callbacks versus commit crossings |
| renderer result | mapper count and UI frame-time change |
| JS result | step/snapshot/freeze/allocation change |
| lifecycle result | 50-cycle memory/listener result |
| rejected experiments | result and reason rejected |
| remaining risks | explicit follow-up tasks |

The task is not finished with “it feels smoother.” It is finished when the
runtime ownership model is correct, the deterministic contracts remain green,
and repeatable physical-device measurements demonstrate the improvement.
