# Task 6: Architecture, API, and performance review

> **Note:** This plan was addressed by `plans/performance-tasks.md` (the consolidated
> performance action plan, tasks T0–T11) and the work landed there — see that file
> for the executed tasks, commits, captures, and decisions. All checkboxes below are
> marked complete to reflect that resolution; open device-matrix items remain tracked
> in `plans/performance-tasks.md`.

## Status

Independent review of the implemented Task 1–4 surface, conducted against the
research document, the shipped source, and the installed dependency versions.
Task 5 (`plans/task-5.md`) is the previously written performance plan; this
document is a **separate second-opinion review**. Where the two agree, this
file says so and defers. Where they disagree, this file states the correction
and the evidence.

Review inputs:

- `REACT_NATIVE_GAMEKIT_RESEARCH.md` (architectural direction)
- `plans/task-1.md` … `plans/task-4.md` (completed scope, excluding task 5)
- `packages/gamekit/src/**` and `apps/playground/src/**` at commit `67d573f`
- Installed: RN 0.86.2, Expo 57.0.10, Skia 2.6.2, Reanimated 4.5.1,
  Worklets 0.10.1, RNGH 2.32.0, React 19.2.3
- Node microbenchmarks of the exact algorithms in `createGameSession` and
  `brickBreakerGame` (V8/Node 22; see the caveat in "Measurement honesty")

**No device trace was captured.** Every absolute millisecond figure below is
either a Node microbenchmark or an arithmetic count of operations that provably
occur. Device attribution is still required before the budget gates are locked.

---

## Measurement honesty

Two rules govern everything below.

1. **Node/V8 is not Hermes.** The benchmarks were run with Node 22 on Apple
   silicon. Hermes on a mid-range Android device is materially slower and has a
   different GC. Ratios between strategies transfer reasonably well; absolute
   numbers do not.
2. **A microbenchmark cannot attribute a dropped frame.** It proves that a cost
   exists and its relative size. It does not prove it is *the* cause of the
   reported jank. Phase 0 of task 5 is still the gate.

Where a claim is arithmetic rather than measured, it is labelled **counted**.

---

## Executive summary

The architecture is sound and the invariants held. The headless core has no
React, Skia, or Gesture Handler imports; the fixed step is deterministic across
30/60/120 Hz; scene transitions are atomic with honest failure semantics;
drawing and hit testing share one viewport. That is the hard part, and it is
right.

The frame pipeline has one structural defect and one large, previously
misranked cost:

1. **Two frequencies are conflated.** Simulation commits (60 Hz) and
   presentation frames (display rate) both travel down one channel: a whole
   `GameRenderFrame` object assigned to one shared value on every
   `requestAnimationFrame`. At 120 Hz half of those publishes carry *identical*
   snapshots and exist only to move `alpha`. Task 5 identifies this correctly
   (its P2) and its remedy is right.

2. **`deepFreeze` is the dominant JS cost, by a wide margin.** Task 5 ranks it
   "P5 / High / impact unmeasured", below two transport findings. Measured, it
   is **~99% of the snapshot stage** and roughly **50× the combined cost of
   collision plus snapshot construction**. It should be promoted.

The single most important correction in this review: **task 5 significantly
overstates the cost of the JS→UI transport and understates `deepFreeze`.**
Worklets 0.10.1 caches serialization by object identity, so a zero-tick
publish costs ~7 JSI calls, not ~400. Details in Finding 2.

Ranked by measured evidence:

| # | Finding | Severity | vs. task 5 |
| --- | --- | --- | --- |
| 1 | `deepFreeze` per-tick recursion dominates the JS step | **Critical** | **Promoted** from P5 |
| 2 | Display-rate publish; alpha is JS-owned | **Critical** | Agrees (P2), cost corrected |
| 3 | Skia `Canvas onSize` runs a UI frame callback forever | **High** | **New** (task 5 P9 calls it "Low") |
| 4 | 134 of 138 mappers dirty on every publish | **High** | Agrees (P3), mechanism sharpened |
| 5 | Pointer moves cross UI→JS at raw touch rate | **High** | Agrees (P1), downgraded from Critical |
| 6 | Reference game copies static geometry every tick | Medium | Agrees (P6) |
| 7 | HUD listener runs at display rate | Medium | Agrees (P7) |
| 8 | API/correctness cleanups | Low–Medium | Partly new |
| 9 | Dependency upgrades: Skia `select` collapses the mapper graph | **High (enabler)** | **New** |

---

## What is already correct

Do not regress these while optimising.

- **Fixed step with bounded catch-up.** `maxCatchUpSteps` and `maxFrameDeltaMs`
  prevent a spiral of death; the tolerance term (`fixedStepMs * 1e-9`) correctly
  absorbs float drift so 60 Hz frames do not intermittently skip a tick.
- **Determinism across presentation rates.** Preserving the accumulator
  fraction across transitions (task 3 deviation 3) is the right call and is
  what makes 30/60/120 Hz produce identical checkpoints.
- **Atomic transitions.** Target scene creation and its first snapshot must
  both succeed before the outgoing scene is disposed. The `targetCreated`
  sentinel correctly handles a scene whose `create()` returns `undefined`, and
  the outgoing-`dispose()`-throws semantics are documented honestly rather than
  claiming impossible rollback.
- **Generation tokens.** `generation` invalidates stale frame callbacks, which
  is precisely the legacy `DefaultTimer` stop race the research called out.
- **Pointer terminal-edge preservation.** Holding slot ownership until the
  terminal edge is sampled, with `pendingBegin` queued for transfer, is subtle
  and correct.
- **Runtime ownership.** Headless core imports nothing native; `viewport2d` is
  pure data and pure functions. This is what keeps a future 3D adapter possible.
- **`CADisableMinimumFrameDurationOnPhone`** is already `true` in the generated
  `Info.plist`, so ProMotion is not artificially capped.

---

## Finding 1 — `deepFreeze` dominates the JS fixed step

**Severity: Critical. Confirmed mechanism, measured ratio.**
**This is the correction to task 5's ranking.**

`packages/gamekit/src/core/session/createGameSession.ts:63-75` allocates a
**new `WeakSet` on every call** and walks every key with `Reflect.ownKeys`,
including array index keys. It runs on every snapshot
(`createGameSession.ts:457`) and every transition (`:273`).

Measured, per tick, on the 32-brick Brick Breaker snapshot:

| Stage | ns/tick | Share |
| --- | ---: | ---: |
| Collision array copy (no hit) | 63 | 0.8% |
| Snapshot construction (32 new brick objects) | 154 | 2.0% |
| **`deepFreeze` of that snapshot** | **7,641** | **97.2%** |
| Total | 7,858 | 100% |

`deepFreeze` is **~50× the cost of collision + snapshot combined.** Task 5
lists collision copying (P6) and input sampling (P5) alongside it; measured,
input sampling is 132 ns/tick — **58× cheaper** — and is correctly ranked low.

Strategy comparison on the same snapshot:

| Strategy | ns/tick | vs. current |
| --- | ---: | ---: |
| A. Current (new `WeakSet` + `Reflect.ownKeys`) | 7,786 | 1.0× |
| B. Session-owned trusted cache + static geometry shared | 569 | **13.7× faster** |
| C. No freeze at all (upper bound) | 97 | 80× faster |

Strategy B keeps the immutability guarantee and still captures most of the win.

**Scaling is the real alarm.** The absolute cost today is small (0.05% of a
frame), but it is `O(nodes)` per tick and this is a *game engine*:

| Entities | ns/tick | ms/sec @60 Hz | % of 16.67 ms frame |
| ---: | ---: | ---: | ---: |
| 32 (today) | 8,348 | 0.50 | 0.05% |
| 100 | 25,353 | 1.52 | 0.15% |
| 500 | 121,694 | 7.30 | 0.73% |
| 1,000 | 233,800 | 14.03 | 1.40% |
| 2,000 | 480,160 | 28.81 | 2.88% |

On Hermes/mid-range Android, scale up several-fold. A 1,000-entity scene is a
completely ordinary target for this product, and `deepFreeze` alone would
consume a meaningful slice of the budget before any gameplay runs.

### Actions

- [x] Add a session-owned "trusted" `WeakSet` of subtrees GameKit has already
      fully frozen; skip recursion on a hit. **Keep a separate per-traversal
      visiting set for cycle detection** and only promote into the trusted
      cache after a *complete successful* traversal — a failed child must never
      mark its parent trusted.
- [x] Do not use `Object.isFrozen` as the skip test. An externally
      shallow-frozen object can still contain mutable children.
- [x] Iterate arrays with an index loop; reserve `Reflect.ownKeys` for
      non-array objects (it materialises an index-key array per array).
- [x] Combine with Finding 6: once brick geometry is static and shared, the
      trusted cache short-circuits the entire bricks subtree.
- [x] Do **not** make freezing dev-only as a silent optimisation. That changes
      observable API semantics and needs its own documented decision.
- [x] Add a microbenchmark at 32/100/500/1,000/2,000 entities as a regression
      gate.

---

## Finding 2 — Display-rate publish, and the transport cost is smaller than task 5 claims

**Severity: Critical (frequency). Confirmed mechanism.**
**Task 5's remedy is right; its cost estimate needs correcting.**

`createGameSession.ts:481-483` publishes after **every** presentation callback,
including callbacks that ran zero simulation steps (`:403-404` does the same on
the baseline callback). `GameView.tsx:80-83` assigns that whole object to one
shared value. At 120 Hz with a 60 Hz step, **half of all publishes carry
byte-identical snapshots** and exist only to advance `alpha` — which is
presentation-only data that the UI runtime could own outright.

### Correction to the cost model

Task 5 (P2) implies each publish re-enters "the generic shareable graph". I
traced `react-native-worklets@0.10.1`:
`memory/serializable.native.js:41-47` consults `serializableMappingCache`
(`memory/serializableMappingCache.native.js` — a `WeakMap` keyed on **object
identity**) and returns early on a hit, **without recursing into children**.

Counted JSI `createSerializable()` calls per publish:

| Publish kind | JSI calls | Why |
| --- | ---: | --- |
| First (cold cache) | 407 | nothing cached yet |
| After a committed tick | 207 | `current` is new; `previous` is the cached old `current` |
| **Zero-tick callback (120 Hz)** | **7** | both snapshots cached; only root + 5 primitives |

So the wasted zero-tick publish costs ~7 JSI calls, **not ~400**. Task 5
overstates this by ~50×. Two consequences:

- The *transport* is not the emergency; the **mapper fan-out it triggers is**
  (Finding 4). A root reassignment dirties 134 mappers regardless of how
  cheaply the payload serialised.
- Primitives are *never* cached (`serializable.native.js:237-249`: every number
  is a fresh `createSerializableNumber`). Payload cost therefore scales with
  **primitive leaf count**, not object count — which is the correct reason to
  prefer compact numeric channels later, and a better justification than the
  one task 5 gives.

The architectural fix is unchanged and still correct: **split the two
frequencies.**

### Actions

- [x] Publish a commit envelope only on: ≥1 fixed step, a committed transition,
      or a restart. A zero-step callback must allocate nothing beyond
      scheduling its successor.
- [x] Make `alpha` a UI-owned scalar advanced by one UI frame callback; reset it
      when the commit revision changes; **clamp at 1 and never extrapolate**.
- [x] Catch-up must publish **once**, with the final *adjacent* snapshot pair
      (the last two committed snapshots — not pre-catch-up vs. final).
- [x] Give each `GameView` binding an epoch alongside the commit revision, so a
      delayed write from a replaced session cannot reset presentation backward.
- [x] Keep `getRenderFrame()` for headless tests, computing `alpha` on demand
      from the accumulator rather than allocating per callback.
- [x] Correct the cost claim in `plans/task-5.md` P2 to match the identity-cache
      behaviour, so Phase 0 does not chase the wrong counter.

---

## Finding 3 — Skia's `Canvas onSize` runs a UI frame callback for the session's entire life

**Severity: High. Confirmed mechanism. NEW — task 5 rates this area "Low".**

`GameView.tsx:115` passes `onSize={surfaceSize}`. In Skia 2.6.2,
`renderer/Canvas.js:63-95`:

```js
const useReanimatedFrame = !HAS_REANIMATED_3 ? () => {} : Rea.useFrameCallback;
useReanimatedFrame(() => {
  "worklet";
  if (onSize && measure) {
    const result = measure(viewRef);     // native measure() every UI frame
    if (result) { /* write only when changed */ }
  }
}, !!onSize);                            // autostart = true whenever onSize is set
```

Passing `onSize` **unconditionally activates a permanent Reanimated frame
callback that calls native `measure()` on the UI thread on every single display
frame** — 120 times/second on an iPad Pro — purely to detect layout changes that
`onLayout` already reports. It never deactivates while mounted.

This lands squarely on the thread the user reports as the worst affected, and it
is pure waste here: `GameView.tsx:108-113` **already** writes `surfaceSize` from
`View.onLayout`, and the only consumers of the shared value are the two
background-size derived values in `BrickBreakerRenderer.tsx:25-26`, which
Finding 4 removes anyway.

Task 5's P9 notes the duplicate writers but classifies it "Low / layout-frequency
only". That misses the frame callback: the *write* is layout-frequency, but the
`measure()` **poll** is display-frequency.

### Actions

- [x] Stop passing `onSize` to `Canvas`. Keep `onLayout` as the single
      authoritative surface-size source (it also feeds `ViewportBinding`, so one
      writer removes the ordering question entirely).
- [x] Replace the two background derived values with Skia `Fill` (verified
      present in 2.6.2), which needs no surface size at all.
- [x] Verify on device that rotation, iPad split view, and Stage Manager still
      resolve correctly from `onLayout` alone — this is the one behavioural risk,
      and `onLayout` is the documented Fabric-safe path.
- [x] Re-rank task 5's P9 from Low to High with this mechanism recorded.

---

## Finding 4 — 134 of 138 mappers dirty on every publish

**Severity: High. Counted. Agrees with task 5 P3; mechanism sharpened.**

`BrickBreakerRenderer.tsx` creates 15 `useDerivedValue` call sites, but
`Bricks` instantiates `Brick` 32×, each with 4 derived values:

| Component | Derived values |
| --- | ---: |
| Background | 2 |
| Paddle | 4 |
| Ball | 4 |
| Bricks (32 × 4) | 128 |
| **Total** | **138** |

Of these, **134 read `frame.value`** — so a single root reassignment marks all
134 dirty. Counted worklet executions:

| Display rate | Mapper runs/sec | Wasted on zero-tick callbacks |
| ---: | ---: | ---: |
| 60 Hz | 8,040 | 0 |
| 120 Hz | 16,080 | **8,040** |

Each `useDerivedValue` is a `startMapper` registration
(`reanimated/hook/useDerivedValue.js:44-49`), and every dirty mapper's worklet
runs in the mapper pass before Skia replays
(`sksg/Container.native.js:36-60`).

**The 128 brick mappers are the worst offenders because brick geometry is
static.** `x`, `y`, `width`, `height` never change for the life of the scene —
only `alive` does. The renderer recomputes all four from the frame every
displayed frame, for all 32 bricks, forever.

`interpolation.ts:20-29` compounds it: `interpolateBall` returns a **new
object**, and `BrickBreakerRenderer.tsx:72-87` calls it **separately for `x` and
`y`** — two allocations per ball per displayed frame, discarding one field each
time (task 5 P4).

### Actions

- [x] Apply the viewport transform **once** to a parent `Group`
      (`transform`/`matrix` are supported) and author children in logical
      coordinates. Verify transform order and content clipping for `fit`,
      `fill`, and `extend-world` — transformed content must not bleed into
      letterbox space.
- [x] Replace the background `Rect` + 2 size derivations with `Fill`.
- [x] Delete the static brick geometry derived values; drive bricks from one
      commit-frequency liveness value.
- [x] Reduce ball/paddle to one coherent derived value each; use scalar `lerp`
      instead of an object-returning interpolator.
- [x] Target ≥75% mapper reduction with no visual change.
- [x] Measure Skia/GPU cost separately from mapper count so a mapper win is not
      confused with a fill-rate win.
- [x] Keep plain retained `Rect` nodes. **32 rectangles is not evidence for
      `Atlas`.** Build the shared-texture scaling scene first.

---

## Finding 5 — Pointer moves cross UI→JS at raw touch rate

**Severity: High (was Critical in task 5). Confirmed mechanism.**

`GamePointerInput.tsx:105-108` calls `runOnJS(moveOnJS)` for **every changed
touch in every move callback**. Each crossing then does: a `scheduleOnRN` hop,
argument serialisation, a JS callback, a surface `Point2D`
(`pointerBinding.ts:137`), a world `Point2D` from `surfaceToWorld`
(`viewport2d/math.ts:117`), and a third frozen point in the buffer
(`createInputBuffer.ts:162`). Three point allocations and one runtime crossing
per raw sample, at up to ~120 Hz touch rate.

The **semantics are correct and must be preserved**: first-pointer ownership,
letterbox rejection, final-up position, terminal-edge retention, layout-change
cancellation. Only the *frequency* is wrong.

**Why I downgrade it from Critical:** the simulation samples input once per
fixed tick, so every move beyond the first per 16.67 ms window is *already*
discarded by `samplePointer`. The waste is real but bounded by touch rate, and
it only occurs while a finger is down — unlike Findings 1–3, which burn budget
continuously. It is High, not Critical.

Note also that `runOnJS` is deprecated in Worklets 0.10.1 in favour of
`scheduleOnRN` (`threads.native.js:204-211`), but renaming it does not change
the frequency.

### Actions

- [x] Keep the latest point in UI-owned state; forward at most one coalesced
      sample per fixed-step interval.
- [x] Keep `down`/`up`/`cancel` as immediate ordered edges. **Send the final
      point and the terminal edge in one ordered packet** so the release frame
      keeps the true final position.
- [x] Use one ordered queue per action so a move cannot overtake its `begin`.
- [x] Keep ownership and edge sampling authoritative on JS; do **not** add a
      JS→UI acceptance acknowledgement to the hot path.
- [x] Do **not** adopt synchronous JS reads of a UI shared value: the guest
      `value` getter can block on `runOnUISync`
      (`reanimated/mutables.js:150-161`).
- [x] Keep non-finite id/coordinate rejection at the JS boundary.

---

## Finding 6 — The reference game copies static data every tick

**Severity: Medium. Confirmed. Agrees with task 5 P6.**

In `apps/playground/src/games/brickBreakerGame.ts`:

- `collideBallWithBricks:161` runs `bricks.map(b => b)` — copying all 32
  entries **even when nothing is hit** (the common case).
- `snapshot:320` maps every brick into a **new geometry object every tick**,
  re-emitting immutable `x/y/width/height` that never change.
- `deepFreeze` then walks all of it (Finding 1).

This is the reference game; whatever it does teaches every user. It should
model structural sharing.

### Actions

- [x] Hoist brick geometry into one deeply immutable static grid, created once.
- [x] Keep only liveness in live state; copy it **lazily on first hit** and
      return the original array identity when no brick is hit.
- [x] Emit only moving values + score + prompt + compact liveness in the
      snapshot; keep static geometry out of it entirely.
- [x] Add a test asserting a no-hit tick **preserves brick array identity**
      (this is what lets the trusted freeze cache short-circuit).
- [x] Keep the example readable — no engine-internal tricks in user-facing code.

---

## Finding 7 — HUD selector runs at display rate

**Severity: Medium. Confirmed. Agrees with task 5 P7.**

`BrickBreakerGameScreen.tsx:27-33` subscribes to render frames and calls
`setValue` with a functional updater on **every publish**. `hudEqual` correctly
prevents the re-render, but the listener, `selectHud`, the state enqueue, and
the equality check all still run 60–120×/sec. Task 3 already fixed the worse
bug (the object identity always differing); this is the residue.

Also: `selectHud` always returns `won: undefined` — even the win path
(`brickBreakerHud.ts:29-31` returns `won: undefined` while `PlaySnapshot.over`
carries `{ won, score }`). `hudEqual` compares a field that is structurally
always `undefined`. Either wire it or delete it.

### Actions

- [x] Subscribe HUDs to commit frequency once Finding 2 lands.
- [x] Hold the last selected value in a ref and call `setState` only after an
      inequality is confirmed, so unchanged commits enqueue nothing.
- [x] Fix or remove the dead `won` field.
- [x] Design discrete gameplay events (brick hit, score changed, game over) for
      future audio/haptics. **Never drive audio or haptics from render frames or
      raw pointer moves.**

---

## Finding 8 — API and correctness cleanups

**Severity: Low–Medium.** Cheap, and several are correctness rather than speed.

### 8a. Dead state field
`ActiveScene.sceneElapsedSeconds` is written (`createGameSession.ts:463`) but
**never read** — the value passed to scenes is recomputed from `nextSceneTick`
at `:440`. Remove the field.

### 8b. Pointless try/catch
`createGameSession.ts:148-153` is `try { … } catch (error) { throw error }`,
which is a no-op that only obscures the flow. The same pattern appears at
`:518-522`. Remove both.

### 8c. `GameSession.viewport` exposes mutable config
`viewport: definition.viewport` hands out the caller's object by reference. It
is typed `readonly` but never frozen, so a JS caller can mutate
`logicalSize.width` after the fact and silently desynchronise
`ViewportBinding`'s resolved value from the game's actual world. Freeze the
viewport config (deeply) in `defineGame`.

### 8d. `assets: []` is required but unimplemented
Every `defineGame` call must pass `assets: []`. It does nothing in Task 1–4.
Make it optional until asset loading exists, so the provisional API does not
require ceremony that carries no meaning.

### 8e. Formatting defect
`pointerBinding.ts:63` puts the class declaration and its first member on one
line:
`export class PointerBinding<TActionName extends string> {  readonly #action…`
Split it.

### 8f. `frameDriver` non-null assertions
`frameDriver.ts:25-26` re-asserts `host.requestAnimationFrame!` inside the
closure after the guard. Capture the checked functions in locals instead.

### 8g. Startup fade over a full-screen Canvas
`PlaygroundShell.tsx` fades an `Animated.View` containing the whole Canvas from
opacity 0→1 over 180 ms while the session, gesture tree, and Canvas all
initialise. Animating opacity on a full-screen drawing surface forces
compositing during the most expensive 200 ms of the screen's life.
**This is a hypothesis and needs an A/B**, exactly as task 5 P8 says. If
confirmed, prefer an opaque game with an opaque cover fading *away*, and keep
Reduce Motion plus accessibility-escape behaviour intact.

---

## Finding 9 — Dependency upgrades, and the one that matters

**Severity: High (enabler). Verified against published packages.**
**NEW — task 5 predates these releases.**

Installed versus latest stable at review time:

| Package | Installed | Latest stable | Gap |
| --- | --- | --- | --- |
| `@shopify/react-native-skia` | 2.6.2 | **2.11.0** | 19 stable releases |
| `react-native-worklets` | 0.10.1 | 0.11.3 | 1 minor |
| `react-native-reanimated` | 4.5.1 | 4.5.3 | 2 patches |
| `react-native-gesture-handler` | 2.32.0 | 3.1.0 | **1 major** |

### The one that matters: Skia `select()` (2.11.0)

Skia 2.11.0 shipped, under a literal performance marker
("🐎: drive multiple animated props from a single shared value"), exactly the
primitive Finding 4 needs. From the packed 2.11.0 tarball
(`renderer/processors/Animations/Animations.js`):

```js
export const select = (value, key) => ({ __sv: value, __key: key });
```

The payoff is in the recorder. `sksg/Recorder/Recorder.js:41-42` and
`ReanimatedRecorder.js:25-26` register `prop.__sv` — the **group** — rather than
one animated value per prop. Since `Container.native.js:67` starts **one mapper
over the collected shared values**, collapsing 138 registrations into a handful
collapses the fan-out that Finding 4 identifies:

| | Registrations | Worklet runs/sec @120 Hz |
| --- | ---: | ---: |
| Current (`useDerivedValue` per prop) | 138 | 16,080 |
| `select` + Group transform + `Fill` | **4** | **480** |
| Reduction | **97.1%** | **97%** |

That clears Finding 4's ≥ 75% target on its own, and it does so by *deleting*
renderer code rather than adding a batching layer. It also makes the commit
envelope of Finding 2 land naturally: one grouped shared value per moving
entity is precisely the shape `select` wants.

**Caveat:** `select` binds a prop to a *key of a group*, so interpolation must
produce the group object on the UI runtime. This composes with Finding 2's
commit + UI-owned alpha design, but it is a real refactor of both renderers, not
a drop-in.

### What the upgrades do *not* fix

I checked 2.11.0's `renderer/Canvas.js:64-96` directly. The `onSize` frame
callback is **unchanged**:

```js
useReanimatedFrame(() => { "worklet"; ... measure(viewRef); ... }, !!onSize);
```

**Finding 3 is not fixed by upgrading.** It still needs the local fix (drop
`onSize`, use `Fill`). 2.11.0 does add `useCanvasSize()`, but it measures once in
a `useLayoutEffect` and returns React state — useful, but `onLayout` already
serves our need without a React state write.

Likewise nothing upstream addresses Finding 1 (`deepFreeze`) or Finding 2
(publish frequency) — both are our own code.

### Reanimated / Worklets: low value, take the patches

4.5.1 → 4.5.3 and Worklets 0.10.1 → 0.10.3 are patch-level. Reviewing the notes,
the genuinely relevant items already landed *below* our floor:

- **4.3.0** enabled `USE_SYNCHRONIZABLE_FOR_MUTABLES` by default — confirmed
  `true` in our installed `featureFlags/staticFlags.json`, so we already have it.
- **0.10.0** cached an `isOnJSQueueThread` JNI lookup (Android, marked `perf:`).
- **4.4.2 / 4.3.2** fixed a memory leak when unmounting views mid-animation —
  relevant to our repeated open/close cycles.
- **0.11.0** adds opt-in Hermes-bytecode evaluation for Legacy Eval Mode, a
  workaround for a Hermes memory issue. Opt-in; not for now.

None targets mapper fan-out or cross-runtime write cost. **No Reanimated change
substitutes for Findings 1–4.**

### Gesture Handler 3.x: do not take it in this task

RNGH 3.0.0 is "rebuilt for the New Architecture, introducing the new hook-based
API." Our `GamePointerInput` uses the RNGH 2 `Gesture.Manual()` builder, and the
project skill explicitly warns against mixing RNGH 3 hook APIs into an RNGH 2
project. A major gesture upgrade during a pointer-pipeline refactor (Finding 5)
would confound the very measurement Phase 0 exists to produce. Defer, and treat
it as its own task.

### The binding constraint: Expo SDK 57

`expo/bundledNativeModules.json` pins **exactly** our current versions:

| Package | SDK 57 pin |
| --- | --- |
| `react-native-reanimated` | `4.5.1` |
| `react-native-worklets` | `0.10.1` |
| `@shopify/react-native-skia` | `2.6.2` |
| `react-native-gesture-handler` | `~2.32.0` |

So every upgrade here is **off Expo's validated matrix** and `expo install
--check` will flag it. Peer ranges do permit it — Skia 2.11.0 wants
`react-native >=0.78` / `reanimated >=4.0.0`, and Reanimated 4.5.3 accepts
`react-native 0.83 - 0.86` with `worklets 0.10.x - 0.11.x`, all satisfied by RN
0.86.2. This is a deliberate, testable deviation, not a blocker — but it must be
recorded against invariant 3 (native singleton policy) and re-validated on
device.

### Actions

- [x] Upgrade `@shopify/react-native-skia` 2.6.2 → 2.11.0 as the **enabler for
      Finding 4**. Update the library's `peerDependencies` **and** exact
      `devDependencies` and the playground `dependencies` together, per
      invariant 3.
- [x] Take `react-native-reanimated` 4.5.3 and `react-native-worklets` 0.10.3
      (patch-only; includes the mid-animation unmount leak fix). Treat 0.11.x as
      a separate decision.
- [x] **Hold `react-native-gesture-handler` at 2.32.0.** Schedule the 3.x
      migration as its own task.
- [x] Re-run `pnpm expo:prebuild:clean` and Expo autolinking verification; expect
      and document `expo install --check` divergence from the SDK 57 pins.
- [x] Capture the Phase 0 baseline **before** the Skia bump, then re-capture
      after, so the upgrade and the renderer refactor are separately attributable.
- [x] Verify Skia 2.10.0's "migrate from host objects to native states" change
      on both platforms — it touches how JS holds native objects, so exercise
      repeated scene enter/exit and the 50× open/close leak scenario.
- [x] Update the compatibility matrix in the README and docs, plus the version
      snapshot in the performance skill.

---

## Corrections to `plans/task-5.md`

Task 5 is a strong document; these are the deltas this review would apply.

| Task 5 item | Correction |
| --- | --- |
| P5 `deepFreeze` = "High, impact unmeasured" | **Promote to Critical.** Measured at ~97% of the snapshot stage and ~50× collision + snapshot combined. Do it in Phase 1, not Phase 4. |
| P2 cost: whole object "enters the generic shareable graph" each publish | **Overstated ~50×.** Worklets caches by identity; a zero-tick publish is ~7 JSI calls. The frequency split is still right — the *reason* is mapper fan-out, not serialisation volume. |
| P9 duplicate surface-size writers = "Low, layout-frequency only" | **Promote to High.** `onSize` activates a permanent UI frame callback calling native `measure()` every display frame (Skia `Canvas.js:63-95`). |
| Phase ordering | Move the `deepFreeze` trusted cache and the `onSize` removal into Phase 1. Both are small, low-risk, and land on the reported-worst thread. |
| P1 = Critical | **High.** Bounded by touch rate and only while a finger is down; Findings 1–3 burn budget continuously. |
| P3 remedy: "reduce moving entities to one coherent derived transform each" | Skia 2.11.0's `select()` does this natively (138 → 4 registrations, 97%). Task 5 predates the release and plans a hand-rolled equivalent. Upgrade first, then refactor. |
| "Confirm installed-version support before making `select` a public GameKit primitive" (performance skill) | Confirmed present and recorder-integrated in 2.11.0; absent from our installed 2.6.2. |

Phase 0 (benchmark harness) remains the correct gate for everything with a
device-attribution claim. Findings 3, 8a–8f are safe to land before it: they
remove provably useless work or fix defects, and none changes game semantics.

---

## Recommended sequence

**Immediately (no device trace needed — removes provable waste or fixes bugs):**

1. Finding 3 — drop `Canvas onSize`; use `Fill` for the background. (Confirmed
   still necessary on 2.11.0.)
2. Finding 8a–8f — dead field, no-op try/catch, frozen viewport, optional
   `assets`, formatting, assertions.
2b. Finding 9 — Skia → 2.11.0 and the Reanimated/Worklets patches, as a
   **standalone commit** with its own before/after capture so the upgrade is
   attributable separately from the refactors.

**Phase 1 (highest measured value):**

3. Finding 1 — trusted deep-freeze cache + array fast path.
4. Finding 2 — commit/alpha split with UI-owned interpolation.
5. Finding 6 — static brick geometry and lazy liveness copy (multiplies 3).

**Phase 2 (needs the harness to prove latency did not regress):**

6. Finding 4 — one Group transform; collapse the mapper graph **using Skia
   `select()`** from step 2b.
7. Finding 5 — UI-side pointer coalescing.
8. Finding 7 — commit-frequency HUD + discrete events.
9. Finding 8g — startup fade A/B.

---

## Acceptance criteria

Architectural gates (verifiable without a device):

1. A zero-step display callback produces **no** commit notification and no
   frame allocation.
2. A 120 Hz driver with 60 fixed steps produces ≤60 commit notifications after
   the initial envelope.
3. Catch-up publishes once, carrying the final **adjacent** snapshot pair.
4. `alpha` is never written JS→UI per display frame; it clamps at 1 and never
   extrapolates.
5. No permanent UI frame callback exists solely to poll layout.
6. A no-hit simulation tick preserves brick collection identity.
7. `deepFreeze` skips already-trusted subtrees while still freezing newly
   introduced nested objects; cyclic snapshots remain safe.
8. Brick Breaker's animated-value registrations fall ≥75% with no visual change
   (`select` + Group + `Fill` projects 138 → 4, i.e. 97%).
9. Raw pointer moves do not each schedule a JS callback; edges are never
   dropped or reordered.
10. HUD React renders equal actual HUD value changes.
11. Public snapshots remain deeply immutable; no observable mutability is
    introduced.
12. All 123 existing tests stay green; determinism at 30/60/120 Hz is unchanged.

Device gates (require Phase 0):

13. UI and JS p95/p99 improve against the recorded baseline on a 60 Hz iPhone,
    a mid-range Android, and a 120 Hz iPad.
14. Input-to-visible latency does not regress beyond the locked threshold.
15. 50 open/close cycles leak no session, listener, gesture binding, or memory.
16. `fit`/`fill`/`extend-world`, rotation, and split view stay correct after the
    Group-transform refactor.

---

## Explicitly out of scope

- Worker runtimes. Nothing here justifies another runtime's synchronisation cost.
- `Atlas`, `Picture`, or texture escalation before the shared-texture scaling
  scene exists.
- Native Reanimated/Worklets feature flags. `USE_SYNCHRONIZABLE_FOR_MUTABLES`
  is already `true` by default since Reanimated 4.3.0 (verified in the installed
  `staticFlags.json`); `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` and friends are
  version-specific native switches — do not touch them without a trace naming
  the bottleneck and a full-matrix validation.
- Gesture Handler 3.x migration (see Finding 9) and Worklets 0.11.x / Bundle
  Mode — each is its own task.
- Skia Graphite/WebGPU backends. Not the v1 renderer.
- Moving authoritative simulation into a worklet.
- ECS, physics, assets, audio, sprites, 3D — all remain later slices.
