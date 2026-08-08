# GameKit performance tasks — consolidated action plan

**Date:** 2026-08-08
**Supersedes for execution purposes:** the phase lists in
[`task-5.md`](./task-5.md) and [`task-6.md`](./task-6.md)
**Derived from:** [`performance-summary-gpt.md`](./performance-summary-gpt.md) and
[`performance-summary-opus.md`](./performance-summary-opus.md)

This is the executable plan. Task 5 remains the reference for benchmark
methodology and counter definitions; task 6 remains the reference for measured
mechanism evidence. Where the two reviews disagreed, the resolution is recorded
inline under **Why this order**.

---

## Ground rules

These apply to every task below. Violating them invalidates the results.

1. **Baseline before behaviour.** No performance-affecting change lands before
   T1 captures the unmodified baseline. This is the GPT synthesis's strongest
   correction to task 6, and it wins: removing `Canvas onSize` before the first
   capture would destroy the evidence for one of task 6's own best findings.
2. **One attributable change per commit.** Each task is its own commit with its
   own before/after capture on the same device, same build config, same thermal
   state. A commit that bundles two optimisations cannot be evaluated.
3. **Revert noise.** If a change's measured difference is within run-to-run
   noise, revert it or keep it only if it also simplifies the code. Complexity
   without measured gain is a regression.
4. **Release or `debugOptimized` builds only** for any performance conclusion.
   Dev-mode numbers locate problems; they never approve a gate.
5. **149 tests stay green** (123 library + 26 playground) after every task. Run
   `pnpm test` before every commit.
6. **Never weaken** public snapshot immutability, update-scope safety, pointer
   edge semantics, transition atomicity, or determinism at 30/60/90/120 Hz.
7. **No claim of root cause without a device trace.** Both reviews are explicit
   that no device trace exists yet. Language in commits and docs must say
   "removes N operations/frame", not "fixes the jank".
8. **Correctness-only changes may land independently** (T0) but must not be
   mixed into a benchmarked performance commit.

### Severity reconciliation used by this plan

| Finding | task 5 | task 6 | Adopted |
| --- | --- | --- | --- |
| `deepFreeze` cost | High, Phase 4 | Critical, Phase 1 | **High-scaling, early (T3)** — measured relative ranking accepted; "proven jank cause" rejected |
| Display-rate publish | Critical | Critical | **Critical (T5)** — reason corrected to fan-out, not serialisation volume |
| `Canvas onSize` poll | Low | High | **High (T2)** — task 6 correct; source-verified |
| Mapper fan-out | Medium | High | **High (T6)** |
| Pointer crossings | Critical | High | **High (T7)** — bounded by touch rate, only while finger down |
| Dependency upgrade | n/a | High enabler | **Controlled experiment (T4)** |

---

## T0 — Correctness and API cleanup (no timing impact)

**Type:** correctness · **Gate:** none · **Depends on:** nothing
**Can land immediately, before the baseline.** These cannot change timing.

### Scope

| Item | Location | Fix |
| --- | --- | --- |
| Dead state field | `createGameSession.ts:463` writes `activeScene.sceneElapsedSeconds`; never read (value recomputed at `:440`) | Delete the field from `ActiveScene` and its writes |
| No-op try/catch | `createGameSession.ts:148-153` and `:518-522` are `try { … } catch (e) { throw e }` | Delete both wrappers, keep the bodies |
| Mutable viewport escape | `GameSession.viewport` returns `definition.viewport` by reference; typed `readonly`, never frozen | Deep-freeze the viewport config in `defineGame` |
| Required-but-unimplemented field | `assets: []` mandatory on every `defineGame` | Make `assets` optional (`assets?:`) until asset loading exists; default `[]` |
| Formatting defect | `pointerBinding.ts:61` — class decl and first member on one line | Split; verify `git diff --check` clean |
| Redundant assertions | `frameDriver.ts:26-27` re-assert `host.requestAnimationFrame!` after the guard | Capture checked fns in locals before returning the object |
| Dead HUD field | `brickBreakerHud.ts:19,25,29` — `won` is always `undefined`; `PlaySnapshot.over` carries `{won,score}` | Wire to `frame.current.over?.won` **or** delete the field and its `hudEqual` comparison |

### How to approach

1. Do these as **one commit**, `refactor: remove dead code and tighten public API`.
2. For the viewport freeze: add a test that mutating `game.viewport.logicalSize.width`
   after `defineGame` throws in strict mode / has no effect, and that
   `ViewportBinding` still resolves from the frozen config.
3. For optional `assets`: update `defineGame.types.ts` compile fixtures to prove
   omitting `assets` typechecks, and that supplying it still works.
4. Run `pnpm lint && pnpm typecheck && pnpm test`.

### Done when

- 149 tests green, plus new tests for the frozen viewport and optional `assets`.
- `git diff --check` clean.
- No behavioural change observable from any existing test.

---

## T1 — Benchmark harness and baseline capture

**Type:** infrastructure · **Gate:** blocks T2–T9 · **Depends on:** T0 (optional)

This is task 5's Phase 0, adopted essentially unchanged. It is the single most
important task in the plan, because every later claim depends on it.

### Why this order

The GPT synthesis is right and my task 6 was wrong: task 6 proposed landing the
`onSize` fix before any capture. But `onSize` is one of the strongest UI-thread
findings, and removing it first means never being able to measure it against the
original implementation. Baseline first, without exception.

### Build the harness

1. **Add a Performance Lab entry to the playground catalog.** Follow the existing
   pattern: add the id to `apps/playground/src/catalog/games.ts`, add the screen
   to the exhaustive `GAME_SCREENS` registry in `PlaygroundShell.tsx`. It must
   compile in release-like builds, not just dev.
2. **Keep diagnostics tree-shakeable and no-op by default** in the library. Do
   not add a public diagnostics API yet — use an internal sink. A public contract
   before its usefulness is proven is a liability.
3. **Aggregate UI metrics on the UI runtime**; transfer summaries **at most once
   per second**. A per-UI-frame JS callback would itself invalidate the test.
4. **Do not `JSON.stringify` snapshots** to estimate payload size in the hot
   path. Count commits and channel sizes; measure representative payloads
   offline.
5. **Deterministic scenarios only** — fixed seed, fixed duration, and a reset
   action so three comparable runs can be collected without restarting Metro.
6. **Disable the on-screen overlay** during final Instruments/Perfetto captures.

### Counters required

**JS/session:** display callbacks · zero-step callbacks · fixed steps · catch-up
steps · dropped whole-step debt · update duration · input-sample duration ·
snapshot duration · **deep-freeze duration** · publish duration · commit
notifications · listener count · p50/p95/p99 for each.

**UI/presentation:** presented frame deltas · missed frames vs. current refresh
rate · p50/p95/p99 frame delta · commit envelope updates · alpha updates · active
mapper count where exposed · UI→JS pointer calls · raw/coalesced/forwarded input
counts.

**Interaction:** input-to-visible latency (scripted drag) · first-game-frame ·
first-interactive · open/close cycle count and retained memory.

### Scenarios

1. Bootstrap idle.
2. Brick Breaker idle, no touch. *(isolates always-on cost — this is the scenario
   that discriminates `onSize`/publish/mapper waste from input cost)*
3. Brick Breaker continuous **scripted** drag, ≥20 s. Manual drag is exploratory
   only and cannot approve a gate.
4. JS-stall probe: block JS briefly; verify UI alpha completes then holds.
5. Renderer scaling at 32 / 100 / 500 / 1,000 objects.
6. Shared-texture sprite scene *(for the later Atlas question — do not skip; this
   is what prevents premature escalation)*.
7. Tablet fill-rate: iPad portrait, landscape, split view.
8. 50× open/close for leaks.
9. Startup fade A/B.

### Device matrix

Physical devices only for gates: a 60 Hz iPhone · a 120 Hz ProMotion iPhone if
available · a mid-range Android at 60/90/120 Hz modes · a 60 Hz iPad · a 120 Hz
iPad Pro if available · iPad portrait/landscape/split-view.

Record per capture: commit SHA + dirty flag · exact dependency versions · device
model, OS, refresh mode, power mode · build config · scenario, seed, duration,
run number · initial/final thermal state · whether overlays/logging/remote
debugging were on.

### Done when

The baseline answers, with three runs per primary scenario:

- How many runtime crossings per second, idle vs. dragging?
- **Does UI or JS p95/p99 break first?** *(this decides whether T2/T6 or T3/T5
  matters more for the reported drops)*
- How much work happens on a 120 Hz zero-step callback?
- Which JS step stage costs most on Hermes?
- Is input-to-visible latency user-visible?
- Does the startup fade cost measurable frames?

Commit: `test(perf): add deterministic diagnostics and Performance Lab`.
**Archive the baseline table in this file or a linked results doc.**

### Done — harness (commits `608c962`, `ec8b447`)

- [x] Lab entry in `apps/playground/src/catalog/games.ts` + exhaustive registry in `PlaygroundShell.tsx` (`ec8b447`).
- [x] Internal-only sink: `SessionDiagnostics` in `packages/gamekit/src/core/session/diagnostics.ts`, wired via the testing seam; no public diagnostics API (`608c962`). Tree-shake note: production sessions pass no sink and pay only optional-chaining checks.
- [x] UI metrics aggregated on the UI runtime (`useFrameCallback` → shared values); transferred to React once per 60 frames (≤1/s). No per-frame `runOnJS`; no JS read of UI shared values.
- [x] No snapshot serialisation in the hot path. Offline probe (`apps/playground/src/perf/payload.test.ts`): brick-breaker play frame ≈ **3,644 bytes** → ≈ **219 KB/s** at 60 Hz commits.
- [x] Deterministic scenarios only: fixed durations, pure `generateDragSchedule` (begin/moves/end), reset action, three comparable runs without restarting Metro.
- [x] Overlay hide toggle (hide/show) for external captures.
- [x] Counters: JS/session — display, zero-step, fixed, catch-up, dropped-debt, update/input-sample/snapshot/deep-freeze/publish durations, commits, listener count, p50/p95/p99 (`PerfSummary` + `CounterSeries`, unit-tested). UI — presented frame deltas + p50/p95/p99. Interaction — input-to-commit latency (drag scenario), open/close cycle count.
- [x] Scenarios 1–4, 8 implemented: idle bootstrap, idle brick-breaker, scripted drag, JS stall probe, open/close cycles. Scenarios 5–7 (renderer scaling, shared-texture sprite scene, tablet fill-rate) are deferred to their enabling tasks (T3/T6/T7-adjacent); scenario 9 (startup fade A/B) waits on T10.
- [ ] Physical-device runs and retained-memory traces (Instruments) — pending device availability; simulator captures below are dev-mode only and **not** gates (ground rule 4).

### Baseline archive (dev-mode, iPhone 17 Pro Max simulator, iOS 26.5, Hermes, Metro dev bundle)

All runs: 5 s, fixed step 1000/60 ms (default), real RAF driver, no touch on idle runs. Three comparable runs per primary scenario were collected for the idle brick-breaker and drag scenarios with ±1 step run-to-run variance. First capture of each scenario:

| Scenario | display | zero-step | fixed | catch-up | dropped | commits | update p95 | input-sample p95 | snapshot p95 | deep-freeze p95 | publish p95 | input→commit p50 | UI p95/p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Idle · Bootstrap | 301 | 49 | 300 | 49 | 0 | 301 | 0.02 ms | 0.03 ms | 0.01 ms | 0.02 ms | 0.01 ms | — | 16.7/16.7 ms |
| Idle · Brick Breaker | 301 | 1 | 299 | 0 | 0 | 301 | 0.01 ms | 0.01 ms | 0.00 ms | 0.01 ms | 0.00 ms | — | 16.7/16.7 ms |
| Scripted drag · Brick Breaker | 297 | 1 | 295 | 0 | 0 | 297 | 0.02 ms | 0.01 ms | 0.01 ms | 0.04 ms | 0.01 ms | **17 ms** (1 frame) | 16.7/16.7 ms |
| JS stall probe · Brick Breaker | 289 | 6 | 292 | 10 | 0 | 289 | 0.01 ms | 0.04 ms | 0.00 ms | 0.01 ms | 0.01 ms | — | 16.7/16.7 ms |

Dev-mode answers to the Done-when questions (to be re-verified on physical devices):

- **Crossings/second**: idle ≈ 60 commits/s (1 commit per display callback, 1:1 with fixed steps at 60 Hz) — zero-step callbacks are rare on this sim (1/301 idle brick-breaker; the bootstrap jitter run showed 49, which is display-cadence jitter around 16.67 ms, not session cost).
- **UI vs JS p95**: UI is a solid 16.7 ms; JS per-stage work is 0.01–0.04 ms p95. UI breaks first if anything does — JS budget has ~2 orders of magnitude of headroom at 60 Hz.
- **120 Hz zero-step cost**: not observable on the 60 Hz simulator — needs a ProMotion device trace.
- **Most expensive JS stage on Hermes (dev)**: update + deep-freeze ≈ 0.01–0.04 ms p95; input-sample ≈ 0.01 ms. No stage dominates at this scale.
- **Input-to-visible latency**: 17 ms p50 (one frame) for a scripted move on the simulator — not user-visible, but the 1-frame floor is the design (input sampled at next fixed step, published same callback).
- **Startup fade**: not measurable without device traces (T10).
- **Stall absorption**: a 200 ms JS busy-loop produced 6 zero-step callbacks + 10 catch-up steps, **0 dropped debt** — the clamp+catch-up budget absorbed the stall and game time stayed near real time.

**Pending device matrix** (gates): 60 Hz iPhone · 120 Hz ProMotion iPhone · mid-range Android 60/90/120 Hz · 60 Hz iPad · 120 Hz iPad Pro · iPad portrait/landscape/split-view, with thermal state + build config recorded per capture.

---

## T2 — Remove the always-on `Canvas onSize` poll

**Type:** performance · **Gate:** T1 baseline captured · **Severity:** High

### The mechanism (source-verified)

`GameView.tsx:115` passes `onSize={surfaceSize}`. In Skia
`renderer/Canvas.js:63-95`:

```js
const useReanimatedFrame = !HAS_REANIMATED_3 ? () => {} : Rea.useFrameCallback;
useReanimatedFrame(() => {
  "worklet";
  if (onSize && measure) { const result = measure(viewRef); /* write if changed */ }
}, !!onSize);                              // autostart whenever onSize is set
```

Supplying `onSize` starts a **permanent Reanimated frame callback calling native
`measure()` every display frame** — 120×/s on an iPad Pro — for the Canvas's whole
mounted life, to detect layout changes `onLayout` already reports. **Verified
still present in Skia 2.11.0**, so T4 does not fix it.

`GameView.tsx:108-113` already writes `surfaceSize` from `View.onLayout`, and the
only consumers are the two background derived values at
`BrickBreakerRenderer.tsx:25-26`.

### How to approach

1. Replace the background `Rect` + `backgroundWidth`/`backgroundHeight` derived
   values with Skia `Fill` (verified present in 2.6.2). `Fill` covers the whole
   surface and needs no size.
2. Do the same in `BootstrapRenderer` if it reads `surfaceSize`.
3. Remove `onSize={surfaceSize}` from the `Canvas` in `GameView.tsx`.
4. Decide the fate of `GameRendererProps.surfaceSize`: if nothing consumes it,
   **remove it from the public renderer props** (breaking, but we are `0.0.0`).
   If kept, it must be fed from `onLayout` only. Update
   `reactEntry.types.tsx` fixtures either way.
5. `onLayout` becomes the single authoritative surface-size writer, which also
   removes the P9 dual-writer ordering question entirely.

### Risks and required verification

The one real behavioural risk is layout coverage. `onLayout` is the documented
Fabric-safe path, but verify **on device**:

- [ ] iPhone rotation portrait ↔ landscape.
- [ ] iPad rotation.
- [ ] **iPad Split View resize** (the case task 3 never live-verified).
- [ ] Stage Manager window resize.
- [ ] All three viewport modes (`fit`, `fill`, `extend-world`) still resolve.
- [ ] Letterbox hit-testing still rejects correctly after resize.

### Done when

- No Reanimated frame callback exists solely to poll layout.
- Baseline-vs-after capture on scenario 2 (idle) and 7 (tablet) recorded.
- Rotation/split-view/Stage Manager verified live.
- Commit: `perf: remove always-on Canvas size polling`.

### Done — commit `1aba6c4` (perf: remove always-on Canvas size polling)

- [x] `GameView` no longer passes `onSize` to the Skia `Canvas`; the Reanimated frame callback + per-frame native `measure()` poll is gone. `onLayout` is the single surface-size authority (P9 dual-writer question removed).
- [x] `GameRendererProps.surfaceSize` removed from the public renderer props (breaking at 0.0.0); compile fixture asserts its absence (`reactEntry.types.tsx` `@ts-expect-error`, RED-first).
- [x] Brick Breaker background is now Skia `Fill` (verified present in the pinned 2.6.2) — two derived values deleted; no other renderer consumed `surfaceSize`.
- [x] Live verification (iPhone 17 Pro Max simulator, iOS 26.5): open → play (press-launch) → paddle drag → landscape rotation → portrait rotation → back to Home. Viewport re-resolves after each rotation; letterbox taps remain correctly rejected; the one-press launch and game-over → tap-to-play-again → ready → play loop behave. Split View / Stage Manager / physical-device runs remain pending (documented tooling gaps; user runs the app manually).
- [x] Baseline-vs-after capture, scenario 2 (idle brick-breaker), same simulator, dev-mode, 5 s runs:

| Capture | display | zero-step | fixed | catch-up | dropped | commits | update p95 | deep-freeze p95 | publish p95 | UI p95/p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 before (`608c962`) | 301 | 1 | 299 | 0 | 0 | 301 | 0.01 ms | 0.01 ms | 0.00 ms | 16.7/16.7 ms |
| T2 after | 298 | 54 | 300 | 57 | 0 | 298 | 0.00 ms | 0.01 ms | 0.01 ms | 16.7/16.7 ms |

  **Conclusion (dev-mode, simulator):** JS-stage durations and UI frame deltas are identical within run-to-run jitter (the zero-step/catch-up swing is display-cadence jitter around 16.67 ms, not session cost — both runs average ~60 Hz). The `onSize` poll ran on the UI thread, invisible to the JS counters; its removal is kept because it simplifies (ground rule 3: keep noise-level changes that also remove complexity) and because the mechanism is source-verified: the poll calls native `measure()` every display frame for the Canvas's whole mounted life — 120×/s on an iPad Pro. Quantified device confirmation is pending the physical-device matrix.

---

## T3 — Trusted deep-freeze cache

**Type:** performance · **Gate:** T1 · **Severity:** High-scaling

### Evidence and honest framing

`createGameSession.ts:63-75` allocates a **new `WeakSet` per call** and walks
`Reflect.ownKeys` including array index keys, on every snapshot (`:457`) and
transition (`:273`).

Node/V8 microbenchmark, 32-brick snapshot:

| Stage | ns/tick | Share |
| --- | ---: | ---: |
| Collision copy (no hit) | 63 | 0.8% |
| Snapshot construction | 154 | 2.0% |
| **`deepFreeze`** | **7,641** | **97.2%** |

Strategy comparison: current 7,786 ns → trusted cache 569 ns (**13.7×**) → no
freeze 97 ns.

Scaling: 32 → 8.3 µs; 500 → 122 µs; 1,000 → 234 µs (~14 ms/s at 60 Hz); 2,000 →
480 µs (~29 ms/s). Hermes is slower.

**Honest framing, per the GPT synthesis:** this is the strongest measured **JS
scaling** candidate. It is *not* proven to cause the observed drops — the
benchmark is V8, covers only the snapshot subset, and current absolute cost is
small. Task 5 already proposed the correct fix; only its phase placement changes.

### How to approach — TDD, in this order

1. **RED tests first**, before touching the implementation:
   - A structurally shared subtree reused across two snapshots is frozen once.
   - A **newly introduced** nested object inside an otherwise-shared tree **is**
     frozen.
   - A cyclic snapshot does not infinite-loop and is frozen.
   - A snapshot whose child getter throws mid-traversal leaves the **parent
     untrusted**, and a later snapshot re-traverses it.
   - `Object.isFrozen`-but-shallow objects are still recursed into.
2. **Implement:**
   - Session-owned `trusted = new WeakSet<object>()`.
   - Separate **per-traversal** `visiting` set for cycle detection — do not reuse
     the trusted set for this.
   - Promote into `trusted` **only after** a complete successful traversal of the
     whole subtree. A failed child must never mark its parent trusted.
   - Array fast path: index loop, not `Reflect.ownKeys` (which materialises an
     index-key array per array).
3. **Do not** use `Object.isFrozen` as a skip test — an externally
   shallow-frozen object can contain mutable children.
4. **Do not** make freezing dev-only. That changes observable API semantics and
   needs its own documented decision.
5. Add a microbenchmark at 32/100/500/1,000/2,000 entities as a **regression
   gate** committed alongside.

### Done when

- New freeze tests green; all 149 existing tests green.
- Microbenchmark shows ≥5× improvement at 32 entities and ≥10× at 1,000.
- Device capture on scenario 5 (scaling) recorded.
- Commit: `perf: skip re-freezing trusted immutable subtrees`.

---

## T4 — Dependency upgrade as an isolated experiment

**Type:** dependency · **Gate:** T1 · **Enables:** T6

### Versions

| Package | Current | Target | Rationale |
| --- | --- | --- | --- |
| `@shopify/react-native-skia` | 2.6.2 | **2.11.0** | `select()` enables T6 |
| `react-native-reanimated` | 4.5.1 | 4.5.3 | patch; mid-animation unmount leak fix |
| `react-native-worklets` | 0.10.1 | 0.10.3 | patch |
| `react-native-gesture-handler` | 2.32.0 | **hold** | 3.x is a New-Arch rewrite with a new hook API; migrating during T7 would confound measurement |

**Re-verify versions at execution time.** "Latest" claims are time-sensitive;
re-run the registry check rather than trusting this table.

### The `select()` mechanism (verified in the 2.11.0 tarball)

```js
// renderer/processors/Animations/Animations.js
export const select = (value, key) => ({ __sv: value, __key: key });
```

`Recorder.js:41-42` and `ReanimatedRecorder.js:25-26` register `prop.__sv` — the
**group** — not one value per prop; `Container.native.js:67` starts **one mapper**
over the collected values. Projected for our renderer: **138 → 4** registrations.

### Constraint: off the Expo matrix

`expo/bundledNativeModules.json` pins **exactly** our current versions (Skia
2.6.2, Reanimated 4.5.1, Worklets 0.10.1, RNGH ~2.32.0). Peer ranges permit the
upgrade (Skia 2.11.0 wants `react-native >=0.78`, `reanimated >=4.0.0`;
Reanimated 4.5.3 wants `react-native 0.83 - 0.86`, `worklets 0.10.x - 0.11.x` —
all satisfied by RN 0.86.2). But `expo install --check` will flag divergence.
Record this as a deliberate deviation against **invariant 3**.

### How to approach

1. **Isolated commit, no renderer changes.** This commit must contain only
   manifest + lockfile changes so its effect is separately attributable.
2. Update **all three places together** per invariant 3: library
   `peerDependencies`, library exact `devDependencies`, playground
   `dependencies`.
3. `pnpm install`, then `pnpm expo:prebuild:clean`.
4. Run Expo autolinking verification; confirm exactly one copy of each native
   module.
5. Build **iOS and Android, debug and release**.
6. Run `pnpm check` (lint → typecheck → test → build) and `pnpm pack:inspect` to
   confirm the tarball is unchanged in shape.
7. **Capture the same scenarios before/after with no code changes.** Skia 2.10.0
   migrated "from host objects to native states" — that touches how JS holds
   native objects, so specifically run **scenario 8 (50× open/close)** for leaks
   and repeated scene enter/exit.
8. Update the compatibility matrix in root `README.md`, the docs compatibility
   page, and the version snapshot in
   `.agents/skills/react-native-gamekit-performance/SKILL.md`.

### Rollback criteria

Revert if: a native build fails on either platform; the 50-cycle leak scenario
regresses; or p95/p99 worsens beyond noise with no code change.

### Done when

- Both platforms build debug + release; autolinking clean.
- 149 tests green; `pack:inspect` unchanged.
- Before/after capture with **no code change** recorded.
- Commit: `chore(deps): upgrade Skia to 2.11.0 and Reanimated/Worklets patches`.

---

## T5 — Split simulation commits from UI presentation

**Type:** architecture · **Gate:** T1 · **Severity:** Critical
**This is the central architectural fix both reviews agree on.**

### The defect

`createGameSession.ts:481-483` publishes after **every** presentation callback,
including zero-step ones (`:403-404` likewise on the baseline callback).
`GameView.tsx:80-83` assigns the whole object to one shared value. At 120 Hz with
a 60 Hz step, **half of all publishes carry byte-identical snapshots** and exist
only to move `alpha`.

**Corrected cost model** (task 6, verified in Worklets 0.10.1
`memory/serializable.native.js:41-47` + `serializableMappingCache.native.js`):
serialization is identity-cached, so a zero-tick publish is ~7 JSI calls, not
~407. The real costs are therefore:

1. one root assignment dirties ~134 frame-dependent mappers;
2. JS listener + publish work runs at display rate;
3. `alpha` wrongly depends on JS scheduling;
4. new primitive leaves are never identity-cached (every number is a fresh
   `createSerializableNumber`).

Note: task 5 *did* hedge on the caching and named the root-assignment mechanism;
task 6 supplied the number and shifted the emphasis. Both prescribe this fix.

### Target shape

```text
presentation.commit  -> SharedValue of an immutable snapshot-pair envelope
                        (scene, previous, current, tick, elapsed, revision, hardCut)
                        updated ONLY on simulation/transition/restart commits
presentation.alpha   -> SharedValue<number>, UI-owned, advanced by a UI frame callback
viewport             -> SharedValue, updated only on layout revision
```

### How to approach — TDD

**RED tests first** (extend `gameSession.test.ts`, `sceneLifecycle.test.ts`):

- [ ] 120 Hz driver + 60 fixed steps → **≤60** commit notifications after the
      initial envelope.
- [ ] A zero-step callback → **zero** commit notifications and no frame
      allocation.
- [ ] Two catch-up steps in one callback → **one** notification with the final
      **adjacent** pair (last two committed snapshots — *not* pre-catch-up vs.
      final).
- [ ] Commit revision is monotonic.
- [ ] A stale/duplicate revision cannot replace a newer UI commit or reset alpha.
- [ ] Replacing the `GameView` session accepts the **new epoch** even when its
      revision restarts at 0; a delayed write from the old epoch is ignored.
- [ ] Alpha reset / progression / clamp at 1 / no extrapolation / pause / resume /
      hard cut, tested as **pure clock logic** (no React, no device).
- [ ] A throwing commit listener pauses the session and leaves no scheduled
      successor.
- [ ] Unmount stops the UI clock; Strict-Mode double mount creates no duplicate
      frame callback.
- [ ] Existing transition-failure, disposal, stale-callback, and 30/60/120 Hz
      determinism tests remain green.

**Implementation:**

1. Refactor `createGameSession` publication around **state commits**. Add
   `revision: number`, incremented only on commit.
2. Add `addCommitListener` (commit frequency). Keep `getRenderFrame()` for
   headless inspection, computing `alpha` **on demand** from the accumulator
   rather than allocating per callback — and document its freshness contract.
3. **Remove `addRenderFrameListener` before v1.** Migration surface is small and
   fully known: `bindGameSession.ts:15`, `BrickBreakerGameScreen.tsx:27`, and 6
   test call sites (`gameSession.test.ts` ×2, `sceneLifecycle.test.ts` ×4). Do
   not silently redefine a method documented as a *presentation-frame* listener.
4. Add the **UI-owned alpha clock**: one `useFrameCallback` in `GameView`,
   advancing alpha from UI frame deltas, resetting on revision change, clamping
   at 1. Activate only while mounted **and** presentation is running; stop on
   pause, background, unmount, dispose.
5. Give each `GameView` binding a monotonic **epoch** alongside the session
   revision, so a delayed handoff cannot reset presentation backward.
6. Zero-step callbacks must allocate nothing beyond scheduling their successor.
7. Update `GameRendererProps`, both playground renderers, `reactEntry.types.tsx`,
   and the docs renderer contract together.

### Done when

- All RED tests green; 149 existing green.
- Commit crossings at 120 Hz fall to simulation-commit frequency.
- JS-stall probe (scenario 4): alpha completes then **holds**, never extrapolates.
- Determinism, hard cuts, pause/resume, input semantics unchanged.
- Commit: `perf: publish render commits at simulation frequency`.

---

## T6 — Collapse the Skia renderer graph

**Type:** performance · **Gate:** T4 (for `select`) + T5 (for commit shape) ·
**Severity:** High

### The count

`BrickBreakerRenderer.tsx` has 15 `useDerivedValue` call sites, but `Bricks`
instantiates `Brick` 32× at 4 each:

| Component | Derived values |
| --- | ---: |
| Background | 2 |
| Paddle | 4 |
| Ball | 4 |
| Bricks (32 × 4) | 128 |
| **Total** | **138** |

**134 read `frame.value`**, so one root assignment dirties all 134 → 8,040
worklet runs/s at 60 Hz, 16,080 at 120 Hz. The 128 brick mappers are the worst
offenders because brick geometry is **static** — only `alive` changes.

`interpolation.ts:20-29` compounds it: `interpolateBall` returns a **new object**
and `BrickBreakerRenderer.tsx:72-87` calls it **separately for x and y** — two
allocations per ball per displayed frame, each discarding a field.

### How to approach

1. **Geometry assertions first.** Before moving mapping to a parent `Group`, add
   tests pinning expected surface coordinates for `fit`, `fill`, and
   `extend-world` at several surface sizes, so a transform-order mistake fails
   loudly.
2. Replace background `Rect` + 2 size derivations with **`Fill`** (done in T2).
3. Apply the resolved viewport **once** to a parent `Group` via
   `transform`/`matrix`; author all children in **logical** coordinates.
   Verify transformed content does **not** bleed into letterbox/pillarbox
   regions except where the mode intends it.
4. Use **`select()`** (from T4) with one grouped shared value per moving entity
   instead of one derived value per prop. Note `select` binds a prop to a *key of
   a group*, so interpolation must produce the group object on the UI runtime —
   which composes naturally with T5's commit + UI-alpha design.
5. Replace object-returning ball interpolation with a **scalar** worklet lerp, or
   one coherent grouped value consumed once.
6. Delete static brick geometry derived values; drive bricks from one
   commit-frequency liveness value.
7. **Keep plain retained `Rect` nodes.** 32 rectangles is not evidence for
   `Atlas`. Build scenario 6 (shared-texture) before even discussing it.
8. Optional A/B only if the trace demands it: batch same-colour alive bricks into
   paths rebuilt when liveness changes. Keep the simpler version unless the
   batch produces a repeatable material win.

### Done when

- Registrations drop **≥75%** (projection: 138 → 4, i.e. 97%).
- **No visual regression** at 60 and 120 Hz.
- `fit`/`fill`/`extend-world`, rotation, split view all still correct.
- **Skia/GPU/compositor cost measured separately** from mapper count, so a
  mapper win is not mistaken for a fill-rate win.
- No per-frame creation of images, fonts, paths, paints, or shaders; no unbounded
  cache growth.
- No React render from live ball/paddle/brick values.
- Commit: `perf: drive Skia props from grouped shared values`.

---

## T7 — Coalesce pointer movement on the UI runtime

**Type:** architecture · **Gate:** T1, T5 · **Severity:** High

### The defect

`GamePointerInput.tsx:105-108` calls `runOnJS(moveOnJS)` for **every changed
touch in every move callback**. Each crossing costs: a `scheduleOnRN` hop,
argument serialisation, a JS callback, a surface `Point2D`
(`pointerBinding.ts:137`), a world `Point2D` from `surfaceToWorld`, and a third
frozen point in the buffer (`createInputBuffer.ts:162`).

**Severity reconciliation:** task 5 said Critical, task 6 said High. Adopt
**High** — the simulation samples input once per tick, so extra moves are already
discarded by `samplePointer`, and the cost occurs only while a finger is down.
But keep it **mandatory before the input API is production-ready**: input-heavy
games with several actions amplify it, and latency is product-critical. If T1
shows input-to-visible latency is the user-visible complaint, promote it.

### Design constraints (must all hold)

- UI-owned state tracks latest surface x/y, pointer id, dirty revision, last
  forward time. It is **not** the authoritative owner.
- Forward the latest dirty point **at most once per configured interval**;
  default max coalescing delay = one fixed step. A shorter interval at 120 Hz
  only if measured latency justifies the extra crossings.
- `down`, final move, `up`, `cancel`, and queued moves travel through **one
  ordered queue per action** — independently scheduled calls must not overtake
  each other.
- `up` sends the **final point and terminal edge together**, in order.
- Mirror only the **containment check** on UI so an invalid layout or `fit`
  letterbox begin fails the Manual gesture before activation — reusing the exact
  same viewport values/formula, and re-validating on JS.
- Ownership and edge sampling stay **authoritative on JS**. Do **not** add a
  JS→UI acceptance acknowledgement to the hot path; the ordered queue sends
  `begin` before movement and JS ignores movement for an unowned action.
- **Never** synchronously read a UI shared value from JS — the guest `value`
  getter can block on `runOnUISync` (`reanimated/mutables.js:150-161`).
- Layout revision / unmount cancels ownership **and clears queued movement**.
- Non-finite id/coordinate rejection stays at the JS boundary.

### RED tests

- [ ] Hundreds of moves in one interval forward **only the final** move.
- [ ] Moves in separate intervals forward once per interval.
- [ ] A begin outside the viewport / in `fit` letterbox is rejected without
      leaking a queued move or leaving the gesture active.
- [ ] A move arriving before JS accepts/rejects `begin` cannot overtake it.
- [ ] Down+up between ticks preserves **both** edges.
- [ ] The final `up` coordinate is visible on the release sample.
- [ ] Cancel neutralises exactly once.
- [ ] A secondary pointer cannot steal ownership.
- [ ] End→begin preserves the old terminal edge before transferring.
- [ ] Layout revision cancels and drops stale queued moves.
- [ ] Paused/disposed sessions cannot receive or resurrect input.

Extract a **pure coalescer state machine** so ordering is testable without
mounting a native gesture. Use the current Worklets scheduling API
(`scheduleOnRN`; `runOnJS` is deprecated in 0.10.1) — but note renaming alone
does not fix frequency.

### Done when

- UI→JS move calls ≤ configured sampling rate.
- Down/up/cancel never dropped or reordered.
- Continuous-drag (scenario 3) UI and JS p95/p99 improve vs. T1.
- **Input-to-visible latency does not regress** beyond the T1-locked threshold.
- Verified on 60 and 120 Hz phones **and** iPad split view.
- Commit: `perf: coalesce pointer movement across runtimes`.

---

## T8 — Reference game: structural sharing

**Type:** performance · **Gate:** T3 (multiplies it), T5 · **Severity:** Medium

### The defect

In `brickBreakerGame.ts`:

- `collideBallWithBricks:163` — `bricks.map((brick) => brick)` copies all 32
  entries **even when nothing is hit** (the common case).
- `snapshot:320` — maps every brick into a **new** geometry object every tick,
  re-emitting immutable `x/y/width/height`.
- `deepFreeze` then walks all of it.

This is the reference game; whatever it does teaches every user.

### How to approach

1. **Update tests first** — collision and deterministic 30/60/120 Hz checkpoint
   tests in `brickBreakerGame.test.ts` must be adjusted before the refactor.
2. Hoist brick geometry into one deeply immutable **static grid**, created once
   at module scope.
3. Keep only **liveness** in live state. Benchmark a numeric bit mask against a
   structurally shared readonly boolean collection; **choose the clearer one**
   unless the trace shows a meaningful difference.
4. Copy liveness **lazily on first hit**; return the original array identity when
   nothing is hit.
5. Emit only moving values + score + prompt + compact liveness in the snapshot.
   Keep static geometry **out of the snapshot entirely**.
6. **Add a test asserting a no-hit tick preserves brick collection identity** —
   this is precisely what lets T3's trusted cache short-circuit the subtree.
7. Add a test proving snapshots do not recreate static geometry.
8. **Keep the example readable.** No engine-internal tricks in user-facing code.

### Done when

- Per-tick brick geometry allocations eliminated.
- No-hit identity test green; snapshot/freeze duration improves.
- Gameplay, scoring, win/loss, and 30/60/120 Hz checkpoints **identical**.
- Commit: `perf: structurally share Brick Breaker state and snapshots`.

---

## T9 — HUD and semantic events at commit frequency

**Type:** performance · **Gate:** T5 · **Severity:** Medium

### The defect

`BrickBreakerGameScreen.tsx:27-33` subscribes to render frames and calls
`setValue` with a functional updater on **every publish**. `hudEqual` prevents
the re-render, but the listener, `selectHud`, the state enqueue, and the equality
check all still run 60–120×/s.

### How to approach

1. Migrate `useHudValue` to **`addCommitListener`** from T5.
2. Hold the last selected value in a **ref**; call `setState` only after an
   inequality is confirmed, so unchanged commits enqueue nothing.
3. Add pure Node tests counting **selector calls** and **state-update requests**
   across unchanged commits. Count actual React renders only in an
   integration/perf-lab harness.
4. Define a minimal renderer-neutral **discrete event seam** (brick hit, score
   changed, game over, button pressed) **only if** score/audio/haptic consumers
   need more than commit selectors. Keep it independent of Zustand.
5. Document that future `react-native-audio-api` integration must preload and
   trigger **discrete commands**. **Never** emit continuous audio/haptics from
   interpolation or raw pointer callbacks.

### Done when

- HUD React renders **equal** actual HUD value changes.
- HUD work absent from zero-step callbacks.
- No live gameplay position reaches React or Zustand.
- Commit: `perf: move HUD and semantic effects to commit frequency`.

---

## T10 — Startup-fade A/B

**Type:** experiment · **Gate:** T1 · **Severity:** hypothesis

`PlaygroundShell.tsx` fades an `Animated.View` containing the whole Canvas 0→1
over 180 ms while the session, gesture tree, and Canvas initialise. Animating
opacity on a full-screen drawing surface forces compositing during the most
expensive 200 ms of the screen's life.

**This is a hypothesis, not a finding.** Both reviews agree it requires an A/B.

### Procedure

Capture the first 500 ms after opening Brick Breaker, **≥3 runs**, identical
build/device/thermal state, for each of:

1. Current full-surface fade.
2. Immediate opacity 1 (no fade).
3. Opaque game + opaque cover fading **away**.

Compare first-frame, first-interactive, UI frame time, and GPU/compositor cost.

### Decision rule

- Differences within noise → **keep current behaviour**.
- Confirmed cost → adopt the **least complex winning** transition, preserving
  Reduce Motion, `accessibilityViewIsModal`, and immediate back/escape.

Commit only if a change is adopted: `perf: apply measured startup transition`.

---

## T11 — Documentation and guardrails

**Type:** documentation · **Gate:** T2–T10 complete

1. **Performance model page:** JS fixed simulation → commit boundary → UI
   presentation → React overlays. State the runtime ownership table.
2. **Renderer guide:** fixed topology, one viewport transform, grouped shared
   values via `select`, scalar interpolation, static geometry, resource
   memoisation, and *when* to consider `Atlas`/`Picture`.
3. **Input guide:** UI ownership, coalescing interval, edge ordering, latency
   tradeoffs.
4. **Profiling guide:** release-like Expo prebuild captures on iOS, Android,
   iPad.
5. **Results:** publish the before/after device table, the rejected experiments
   **and why**, and the locked thresholds.
6. Update the compatibility matrix and the performance skill's version snapshot.
7. **CI:** add deterministic counter assertions (zero-step callbacks emit zero
   commits; commit count ≤ steps + transitions). Require ≥80% coverage for new
   pure engine logic. Do **not** treat CI/simulator FPS as a device gate.

---

## Execution order and dependencies

```text
T0  cleanup ....................... independent, land anytime
T1  harness + BASELINE ............ gates everything below
     |
     +-- T2  onSize removal ....... always-on waste, cheapest fix
     +-- T3  freeze cache ......... JS scaling
     +-- T4  Skia 2.11 upgrade .... isolated, enables T6
     |
     +-- T5  commit/alpha split ... CENTRAL architectural fix
           |
           +-- T6  renderer graph ..... needs T4 + T5
           +-- T7  pointer coalescing . needs T5
           +-- T8  structural sharing . multiplies T3
           +-- T9  HUD commits ........ needs T5
     +-- T10 startup A/B .......... independent experiment
                    |
                    +-- T11 docs + CI guardrails
```

**Order rationale:** T2/T3/T4 are independent, low-risk, and produce clean
attributable measurements, so they precede the larger T5 refactor. T5 is the
architectural centre and unlocks T6/T7/T9. T8 is sequenced after T3 because
static-geometry sharing is what makes the trusted freeze cache short-circuit.

---

## Global acceptance criteria

Verifiable without a device:

1. Zero-step display callback → no commit notification, no frame allocation.
2. 120 Hz driver + 60 fixed steps → ≤60 commit notifications after the initial
   envelope.
3. Catch-up publishes once with the final **adjacent** pair.
4. Alpha is never written JS→UI per display frame; clamps at 1; never
   extrapolates.
5. No permanent UI frame callback exists solely to poll layout.
6. A no-hit tick preserves brick collection identity.
7. `deepFreeze` skips trusted subtrees while still freezing newly introduced
   nested objects; cyclic snapshots safe.
8. Renderer animated-value registrations reduced ≥75%, no visual change.
9. Raw pointer moves do not each schedule a JS callback; edges never dropped or
   reordered.
10. HUD React renders equal actual HUD value changes.
11. Public snapshots remain deeply immutable; no observable mutability added.
12. All 149 tests green; determinism at 30/60/90/120 Hz unchanged.
13. API stays simple for a small 2D game; the commit model stays usable by a
    future 3D renderer.

Requiring devices:

14. UI **and** JS p95/p99 improve vs. the T1 baseline on a 60 Hz iPhone, a
    mid-range Android, and a 120 Hz iPad.
15. Input-to-visible latency within the T1-locked threshold.
16. 50 open/close cycles leak no session, listener, gesture binding, or memory.
17. `fit`/`fill`/`extend-world`, rotation, and **split view** correct after the
    Group-transform refactor.
18. No unexplained UI/JS frame-drop cluster in idle and continuous-drag traces.

---

## Out of scope

- Moving authoritative simulation to a worklet or worker runtime.
- Native C++/JSI rewrite.
- Gesture Handler 3.x migration (separate task).
- Worklets 0.11.x / Bundle Mode (separate decision).
- WebGPU / TypeGPU / Skia Graphite backends — see
  [`../research/webgpu-research-opus.md`](../research/webgpu-research-opus.md).
- `Atlas`/`Picture`/texture escalation before scenario 6 exists.
- Native Reanimated feature flags. (`USE_SYNCHRONIZABLE_FOR_MUTABLES` is already
  `true` by default since Reanimated 4.3.0 — verified in the installed
  `staticFlags.json`.)
- ECS, physics, assets, audio, sprites, 3D.
- Live game state in React or Zustand.
- Treating simulator FPS as a release gate.

---

## Handoff report template

| Item | Required |
| --- | --- |
| Commits tested | exact SHAs, per task |
| Devices/builds | full matrix, build config, thermal state |
| Baseline (T1) | p50/p95/p99, crossings, allocations, memory, latency |
| Final | same metrics, same scenarios |
| T2 result | UI frame-time change, idle scenario |
| T3 result | freeze duration + allocation change, 32→2,000 entities |
| T4 result | before/after with **no code change**; leak-cycle result |
| T5 result | display callbacks vs. commit crossings |
| T6 result | registration count + UI/GPU/compositor change, separated |
| T7 result | raw vs. forwarded input frequency, latency |
| T8 result | per-tick allocation change |
| T9 result | React renders vs. HUD value changes |
| T10 result | first-frame/first-interactive comparison, decision |
| Rejected | which changes were reverted as noise, and why |
| Remaining risks | explicit follow-up tasks |

The work is not done when it "feels smoother." It is done when runtime ownership
is correct, the deterministic contracts are green, and repeatable
physical-device measurements demonstrate the improvement.
