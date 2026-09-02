# Task 20: Reference-game feedback action backlog

This task consolidates the independent feedback from all three Mossy Cavern
reference games into one prioritized Gamekit backlog. It identifies repeated
integration problems, preserves the systems that worked well, and converts the
most useful one-off findings into implementable work with explicit boundaries
and acceptance criteria.

## Status

**Proposed.** This file is the planning and prioritization record. Do not land
all work as one change. Promote each accepted workstream into a focused task or
small series of attributable commits before implementation.

## Source evidence

The synthesis uses the three clean-room development diaries and checks their
claims against the current public API, documentation, and completed task plans.

- [Mossy Cavern memo](../apps/playground/src/screens/mossy-cavern/MEMO.md)
- [Mossy Cavern 2 memo](../apps/playground/src/screens/mossy-cavern-2/MEMO.md)
- [Mossy Cavern 3 memo](../apps/playground/src/screens/mossy-cavern-3/MEMO.md)
- [Task 13: deterministic events](./task-13.md)
- [Task 14: audio and haptics](./task-14.md)
- [Task 15: particles](./task-15.md)
- [Task 16: tilemaps and platformer helpers](./task-16.md)
- [Task 17: storage](./task-17.md)
- [Task 18: optional Physics2D](./task-18.md)
- [Task 19: package entry points](./task-19.md)

## Objective

The objective is to remove repeated application glue without weakening
Gamekit's headless-first architecture. The resulting APIs must let a game load
durable state before session creation, bind presentation effects to the correct
session lifecycle, author common particle envelopes safely, and use multiple
input devices without creating parallel simulation authority.

The task also records lower-priority tooling and gameplay helpers that have
enough reference-game evidence to justify further design work.

## Findings repeated in all three games

These findings appeared independently in every Mossy Cavern implementation.
They are the strongest signals in the feedback and form the P0 backlog.

| ID | Repeated finding | Current consequence | Decision |
| --- | --- | --- | --- |
| R1 | Save loading is async, but the generic Playground session factory is sync. | Games persist checkpoints but cannot hydrate the initial scene through the shared shell. | Add host-owned async session preparation; keep the core session constructor synchronous. |
| R2 | Renderer-side particles and other effects cannot directly observe the owning session lifecycle. | Games duplicate pause, resume, disposal, and event-subscription glue through different workarounds. | Expose a read-only lifecycle binding and design an optional typed effects binding. |
| R3 | `scaleOverLife` cannot express a clear large-to-small envelope. | Every game either reverses intent, removes scaling, or discovers the error at runtime. | Add explicit start/end scale authoring with deterministic sampling and compatibility coverage. |
| R4 | Supplied art needs substantial preprocessing before it is mobile-ready. | Every game manually curates, crops, resizes, or repacks source assets. | Build development-time asset preparation and diagnostics; do not add runtime packing. |

R4 is a repeated workflow in all three games. The explicit request for a
first-party atlas builder appears in Mossy Cavern 2 and 3, while the first game
already used derived, atlas-friendly files.

## Findings repeated in two games

These findings have more than one independent reference and must remain near
the front of the backlog, even though they did not appear explicitly in every
memo.

| ID | Repeated finding | Evidence | Decision |
| --- | --- | --- | --- |
| R5 | Keyboard and controller prompt art cannot connect to Gamekit input. | Mossy Cavern 2 and 3 | Design source-aware semantic input, then evaluate native keyboard and gamepad adapters. |
| R6 | Individual animation PNGs do not fit the pre-packed sprite-sheet API. | Mossy Cavern 2 and 3 | Add an offline atlas/code-generation workflow with stable frame names and trim metadata. |
| R7 | Audio creation eagerly decodes the complete sound map. | Mossy Cavern 2 and 3 | Add explicit startup and on-demand loading groups without promising streaming. |
| R8 | Native presentation behavior is not proven by TypeScript, tests, or an Expo export alone. | Mossy Cavern 1 and 3 explicitly; Mossy Cavern 2 only proves export | Add reference-game runtime smoke gates and physical-device evidence. |

## High-value specific findings

The following items appeared explicitly in one memo or as a sharper version of
a repeated issue. They align with existing roadmap gaps or remove unsafe public
usage, so they belong in this backlog.

| ID | Specific finding | Why it is worth addressing |
| --- | --- | --- |
| S1 | Input ownership is not source-aware. | Touch, keyboard, and gamepad cannot safely share one held action until releases are tracked by source. |
| S2 | `GameButtonPad` writes directly to a session. | A callback or diff sink would let applications compose touch, accessibility, keyboard, and controller input first. |
| S3 | Sensors are metadata, not enter/stay/exit tracking. | All platformers repeat trigger bookkeeping for pickups, hazards, checkpoints, exits, and enemies. |
| S4 | Scene transitions have no typed payload. | Loaded runs, selected levels, and results require closures or single-scene state workarounds. |
| S5 | Particle emissions are effect-wide and snapshot bridges can collapse same-tick effects. | A bounded committed-event presentation feed would preserve ordered visual facts without per-frame React state. |
| S6 | Haptics expose session pause only through private `_setPaused`. | The documentation and reference games require unsafe casts for a normal lifecycle operation. |
| S7 | `defineGameCamera2D` is pure but exported only from `rn-gamekit/react`. | Headless tests can accidentally load React Native when a camera definition sits beside game code. |
| S8 | Irregular atlas chunks do not fit `TileMapLayer2D`. | Production terrain art needs a culled static-sprite layer between cell tiles and hand-authored Skia nodes. |
| S9 | Asset manifests have no attribution, license, or decoded texture-budget report. | Teams cannot generate credits or catch oversized mobile textures from the current manifest. |
| S10 | Higher-level platformer feel is repeatedly game-owned. | Three games independently implement coyote time, jump buffering, acceleration, braking, variable jump, dash, hurt, and respawn. |
| S11 | Presentation selectors can fail only on a device runtime. | Invalid particle tables and unsafe worklet dereferences escaped compile, headless gameplay, and bundle checks. |

## Positive findings to preserve

The memos also agree on what works. New work must preserve these properties and
must not replace successful low-level systems with a larger framework.

- Keep the fixed-step session, immutable scene state, and manual frame driver.
- Keep typed committed events as the simulation-to-effects boundary.
- Keep `movePlatformerBody2D` deterministic, composable, and independent from
  a rigid-body backend.
- Keep camera authoring in scene snapshots and presentation interpolation in
  `GameView`.
- Keep `GameButtonPad` true-multitouch behavior and semantic button actions.
- Keep particle pools seeded, bounded, deterministic, and presentation-only.
- Keep audio, haptics, particles, and storage in optional subpath exports.
- Keep React out of per-frame gameplay state.
- Keep asset loading explicit, typed, lease-owned, and based on static Metro
  module handles.

## Non-goals and authored responsibilities

Some diary entries are useful lessons but do not justify an engine API. This
task records them so later implementation does not expand Gamekit in the wrong
direction.

- Do not make Gamekit choose semantically appropriate sound effects. A four
  second notification sound being unsuitable for jump remains an authored
  content problem.
- Do not make Gamekit tune level difficulty, jump reachability, hazard pacing,
  or enemy placement. Deterministic trace tooling can help test those choices.
- Do not infer licenses from filenames. Tooling may carry declared metadata and
  report missing metadata, but only the asset owner can supply legal facts.
- Do not add a rigid-body backend to solve trigger tracking. Task 18 remains a
  no-go; a sensor tracker must build on immutable Collision2D values.
- Do not add a monolithic platformer state machine that owns game rules.
- Do not put native resources, effect controllers, or save stores in scene
  state, snapshots, transition payloads, or event payloads.
- Do not treat an Expo export as proof of audio, haptic, GPU, controller, or
  high-refresh-rate device behavior.

## Priority and delivery order

The order below addresses runtime correctness and repeated architecture gaps
before adding broader capabilities. Dependencies refer to the detailed
workstreams later in this file.

| Priority | Workstream | Rationale |
| --- | --- | --- |
| P0 | T20.0 contract freeze and regression inventory | Prevents another API from being designed from one game or one runtime failure. |
| P0 | T20.1 explicit particle scale envelopes | Repeated in all three games and already caused a device startup failure. |
| P0 | T20.2 async prepared-session shell contract | Repeated in all three games and blocks honest checkpoint resume. |
| P0 | T20.3 read-only lifecycle binding | Repeated in all three games and removes unsafe or module-global coordination. |
| P0 | T20.4 reference-game runtime gates | Two device-only failures show that current automated coverage is insufficient. |
| P1 | T20.5 typed effect binding and presentation feed | Pulls forward Task 13's `EVENT-F1` after three games repeated the glue. |
| P1 | T20.6 source-aware input and hardware adapter evaluation | Two games exposed the missing capability; source ownership is a prerequisite. |
| P1 | T20.7 public haptic lifecycle and staged audio loading | Removes a private cast and bounds startup decode cost. |
| P1 | T20.8 typed scene transition payloads | Already documented on the roadmap and reinforced by save/result workflows. |
| P1 | T20.9 deterministic sensor contact tracking | Removes repeated trigger bookkeeping without reviving Physics2D. |
| P1 | T20.10 camera-definition package boundary | Small, low-risk correction with a concrete headless-test failure. |
| P2 | T20.11 asset preparation and diagnostics | Valuable tooling, but it must remain offline and avoid runtime package weight. |
| P2 | T20.12 irregular static world layer | Useful after proving `SpriteBatch` plus existing culling cannot cover the need. |
| P2 | T20.13 platformer-feel composables | Extract only behavior proven common across the three independent games. |
| P2 | T20.14 documentation and roadmap reconciliation | Update public promises only after each accepted contract is implemented. |

## Non-negotiable architecture boundaries

Every workstream must satisfy these boundaries before it can move from a plan
to implementation.

1. Keep `createGameSession` synchronous and deterministic. Async storage and
   asset work belongs to the host before session construction.
2. Keep one session as the only gameplay clock and input authority.
3. Publish effects only from committed events or committed presentation data.
4. Keep renderers free of per-frame React state and per-frame JS-to-UI bulk
   transfers.
5. Keep headless subpaths free from React, React Native, Skia, Reanimated,
   Worklets, and optional native peers.
6. Preserve existing public behavior or provide an explicit compatibility and
   migration path.
7. Clone, validate, and freeze every new public configuration or payload.
8. Make cancellation, stale async completion, replacement, pause, and disposal
   part of the first contract rather than follow-up fixes.
9. Require physical-device evidence for native input, audio, haptics, and
   performance claims.

## T20.0 — Freeze contracts and regression evidence

This workstream turns the diary evidence into failing tests and small API
decision records before implementation starts.

### Required work

Use the three games as independent fixtures instead of creating another toy
example.

- Inventory duplicated code for save bootstrap, effect lifecycle, particle
  definitions, input adapters, trigger tracking, and platformer feel.
- Record which duplicate is truly identical and which is intentionally
  game-specific.
- Add a failing fixture for every P0 contract before changing the library.
- Keep runtime failure reproductions outside TSX renderers when possible so
  Node can execute them without loading React Native.
- Capture current physical-device behavior for opening, pausing, resuming, and
  closing each Mossy Cavern game.

### Done when

The evidence set must make each P0 change independently testable.

- Every P0 proposal has a failing runtime or compile-time fixture.
- The source matrix identifies the exact memo and implementation that motivated
  each fixture.
- No test depends on a module-global session, effect system, or asset lease.
- Existing successful behavior remains covered before refactoring begins.

## T20.1 — Add explicit particle scale envelopes

This workstream fixes the clearest repeated API defect. A scale-over-life
property must describe time progression directly, not overload a numeric
sampling range whose `min` and `max` also act as endpoints.

### Proposed contract

Freeze exact names through compile fixtures. The preferred shape is explicit
about start and end values and supports deterministic per-particle variation.

```ts
scale: {
  start: { min: 0.9, max: 1.1 },
  end: { min: 0.15, max: 0.3 },
}
```

A scalar convenience may be accepted if it normalizes to a fixed range:

```ts
scale: { start: 1, end: 0.2 }
```

### Required approach

Implement the new contract without silently changing existing seeded effects.

- Validate finite start and end values independently. Decide explicitly
  whether zero and negative scales are supported.
- Sample start and end in a documented deterministic order.
- Preserve analytic interpolation from active age.
- Keep `scaleOverLife` compatible for existing callers during an announced
  migration period, or make the breaking change only under an approved
  provisional-API decision.
- Reject definitions that specify both the legacy and new forms.
- Deep-freeze every nested range in the normalized definition.
- Update shape and sprite presentation through the same sampled fields.

### Required tests

The test suite must cover shrinking, growth, fixed scale, and compatibility.

- Prove `{ start: 1, end: 0.2 }` shrinks at age zero, midpoint, and expiry.
- Prove ranged start and end sampling is deterministic for a fixed seed.
- Prove invalid nested values fail at definition time.
- Prove `createParticleSystem` revalidates raw definitions at its boundary.
- Prove old definitions retain byte-for-byte sampling behavior if compatibility
  is promised.
- Add one real shrinking effect to Particle Lab and a mounted renderer test.

### Done when

All three Mossy Cavern games can express their intended dust and impact shrink
without reversed ranges, visual growth fallbacks, or module-load errors.

## T20.2 — Add async prepared-session support to the Playground shell

This workstream closes the gap between Task 17's correct storage workflow and
the generic shell's synchronous `SurfaceGameEntry.createSession()` contract.
It must not make the deterministic core constructor asynchronous.

### Proposed direction

Allow a catalog entry to prepare its session from assets and application I/O.
Existing synchronous entries must remain valid without wrappers.

```ts
interface SurfaceGameEntry {
  createSession(
    context: GameSessionPrepareContext,
  ): GameSession | Promise<GameSession>;
}
```

The context must include the matched asset lease, an `AbortSignal`, and the
active request identity. A game may load and validate a save, then create the
session synchronously from that prepared value inside the async factory.

### Required approach

Extend the existing request/generation state machine instead of placing async
ownership in game content components.

- Keep one loading state across asset acquisition and session preparation.
- Abort preparation on close, retry, replacement, and shell disposal.
- Dispose a session that resolves after its request becomes stale.
- Never publish assets from one request with a session from another.
- Surface preparation failures through the existing retryable error UI.
- Preserve the current sync fast path for games with no preparation work.
- Port the Storage Lab's proven stale-request and Strict Mode protections into
  the generic shell rather than duplicating its full component architecture.
- Hydrate all three Mossy Cavern sessions from their validated save projection
  as the reference proof.

### Required tests

The shell tests must treat asynchronous completion as hostile and unordered.

- Prove the serial startup contract (T20G-R1): save preparation never starts
  before the matched asset lease, starts exactly once after readiness arrives,
  and stays single across duplicate ready effects and same-props rerenders.
- Close or replace a game while preparation is pending.
- Resolve a stale session after a newer request is ready and prove it is
  disposed without publication.
- Retry after a preparation error and prove only the new request can publish.
- Exercise same-props rerenders and React Strict Mode.
- Prove at most one ready gameplay session is live per surface.
- Prove the session's initial snapshot contains the loaded checkpoint before
  its first fixed tick.

### Done when

The shell can honestly restore a checkpoint before play starts, and no game
needs to inject asynchronous save data into an already-running deterministic
scene.

## T20.3 — Expose a read-only session lifecycle binding to presentation

This workstream removes the lifecycle and effect glue repeated by all three
games. Mossy Cavern 1 and 2 used session-keyed/shared coordinators; Mossy
Cavern 3 used a renderer-local system with a snapshot bridge and no direct
session-pause source. The renderer needs pause and disposal facts, not general
authority over session input, transitions, or state.

### Proposed contract

Freeze the final location after testing both a renderer prop and a React
context hook. The public value must remain minimal.

```ts
interface GameLifecycleSource {
  getStatus(): GameSessionStatus;
  subscribe(listener: (status: GameSessionStatus) => void): () => void;
}
```

`GameView` owns this binding and supplies it to its renderer subtree. It must
not expose `press`, `setScene`, `restart`, or raw session internals.

### Required approach

Use the existing session status subscription as the only source of truth.

- Give `useParticlePresentation` the lifecycle source directly.
- Stop active particle scheduling immediately on pause and resume exactly one
  driver from the frozen clock.
- Make replacement and disposal invalidate the old lifecycle generation.
- Keep manual presentation pause independent from session pause.
- Remove the Mossy 1 and 2 session-keyed particle coordinator maps and the
  Mossy 3 lifecycle-blind workaround after the direct path is proven.
- Do not add per-frame status polling or JS-to-UI traffic.

### Required tests

The lifecycle tests must cover idle and active resources.

- Pause while no particles are active, then attempt an emission.
- Pause with active particles and prove no additional frames are scheduled.
- Resume and prove exactly one presentation driver restarts.
- Replace the session and prove old events cannot reach the new system.
- Unmount and dispose in either order without double release.
- Mount two independent game surfaces and prove their lifecycle sources do not
  cross.

### Done when

A renderer-local particle system follows its owning session without a private
cast, a module-global registry, or a game-specific sibling coordinator.

## T20.4 — Add reference-game runtime verification gates

This workstream responds to two Mossy Cavern 3 failures that passed TypeScript,
headless gameplay tests, and Expo export. The goal is not to move all tests to
devices; it is to make authoring tables and worklet selectors executable at
the cheapest correct layer.

### Required approach

Split pure authoring and selection logic from TSX renderers, then add a small
native smoke matrix for behavior that cannot be proven in Node.

- Require particle effect tables to be imported and used to construct their
  real system in a headless contract test.
- Require worklet-tagged selectors to have pure tests for idle, incomplete,
  invalid, and valid committed snapshots.
- Test stale same-sequence suppression through a separate pure scheduling
  predicate or a mounted reaction test that observes current and previous
  values.
- Add mounted tests that invoke the real `useAnimatedReaction` preparation path
  where project mocks can represent it accurately.
- Add one development-build smoke flow that opens every reference game,
  triggers particles, pauses, resumes, backgrounds, foregrounds, and exits.
- Record device, OS, refresh rate, build type, and result.
- Keep Expo export as a packaging gate, not a runtime claim.

### Device matrix

Use available physical devices and mark unavailable rows honestly. One
supported physical iOS device and one supported physical Android device block
completion of native-runtime work. iPad and 120 Hz rows block only tablet or
high-refresh claims; when unavailable, record them as residual risk rather
than blocking unrelated headless changes.

- One supported iPhone.
- One supported iPad in portrait and landscape.
- One mid-range supported Android phone.
- A 120 Hz device when making high-refresh performance claims.

### Done when

Invalid effect definitions and unsafe snapshot selectors fail before manual
gameplay. The automated portion can land independently, but native-runtime
completion requires repeatable physical iOS and Android smoke records. Any
unavailable conditional row remains an explicit residual risk and blocks only
the claim it would verify.

## T20.5 — Add typed effect binding and a bounded presentation feed

This workstream pulls forward `EVENT-F1` from Task 13 because all three games
now repeat subscription ownership across audio, haptics, particles, storage,
and transient HUD feedback.

### Required approach

Start with an opt-in typed binding over the existing committed event stream.
Do not add middleware, priorities, global buses, or provider-specific imports.

- Preserve exact event-name and payload inference.
- Subscribe and unsubscribe as one lifecycle-owned unit.
- Observe synchronous throws and rejected promises through the existing event
  error policy.
- Let handlers call optional systems supplied by the game; the core must not
  import audio, haptics, particles, or storage.
- Provide a bounded renderer-facing feed only if it can preserve every event in
  a committed tick without per-frame React state or an unbounded history.
- Preserve `(tick, ordinal)` ordering and use it for particle seeds.
- Remove snapshot fields used only to smuggle one latest visual effect into the
  renderer after the feed is proven.
- Allow per-emission presentation values, such as position, color choice, or
  count within validated effect limits, only through an explicit bounded
  command contract.

### Required tests

The tests must prove ordering, lifecycle, and bounded memory.

- Deliver two different events from one tick without visual collapse.
- Preserve catch-up tick order.
- Drop no event because a React render did not occur.
- Dispose subscriptions exactly once on replacement and unmount.
- Bound queue capacity and define overflow behavior explicitly.
- Keep games with no effect binding on the existing no-work path.

### Done when

A reference game can bind its committed events once and drive all optional
effects without snapshot-diff bridges or repeated subscription cleanup code.

## T20.6 — Add source-aware semantic input and evaluate hardware adapters

This workstream must solve input composition before selecting a keyboard or
controller dependency. Adding a native adapter first would reproduce the
release bug described in Mossy Cavern 3: one source can release an action that
another source still holds.

### Required approach

Implement the headless source model first, then perform a current-source native
adapter evaluation for the validated Expo and React Native versions.

- Give every input producer a stable source identifier.
- Treat a button as held while at least one live source holds it.
- Emit `pressed` only on the effective zero-to-one transition.
- Emit `released` only on the effective one-to-zero transition.
- Cancel one source without cancelling unrelated sources.
- Add a callback or diff-sink mode to `GameButtonPad` so applications can
  compose input before forwarding it to the session.
- Preserve current direct session usage as a compatibility convenience.
- Evaluate keyboard and gamepad libraries from current official source,
  licenses, native setup, Expo prebuild support, device identity, disconnect
  behavior, axes, dead zones, and New Architecture support.
- Add analog axis and virtual-stick contracts only after button composition is
  stable.
- Keep prompt-family selection separate from simulation actions.

### Required tests

The headless tests must cover multiple simultaneous producers.

- Hold `right` from touch and gamepad, release either source, and keep the
  action held until both release.
- Disconnect a controller while a button is held and emit one effective
  cancellation.
- Reconnect with a new source generation and prevent stale releases.
- Apply dead-zone and hysteresis rules deterministically for axes if accepted.
- Pause, transition, restart, replacement, and disposal must neutralize every
  source exactly once.

### Done when

Touch, keyboard, controller, and accessibility adapters can target the same
declared actions without phantom releases or parallel gameplay state.

## T20.7 — Publicly bind haptic lifecycle and stage audio loading

This workstream removes one unsafe haptic seam and gives games control over
audio startup cost without expanding into streaming or a general media engine.

### Haptic approach

Replace private lifecycle casts with a small public contract.

- Add a public `setPaused()` method or a typed session-lifecycle binder.
- Keep AppState backgrounding independent from session pause.
- Drop transient requests while either pause source is active.
- Remove `_setPaused` and `_setBackgrounded` from public documentation and
  reference-game casts after compatibility review.

### Audio approach

Preserve typed sound IDs while making readiness explicit.

- Keep existing eager creation as the compatibility path.
- Add declared preload groups or explicit on-demand preparation.
- Let games preload short interaction sounds before play and defer a large
  music bed.
- Deduplicate concurrent preparation for the same sound.
- Define `play()` behavior for an unprepared sound without silent failure.
- Keep one context, one music channel, current concurrency limits, and existing
  lifecycle rules.
- Keep remote streaming, DRM, playlists, and background media controls out of
  scope.

### Done when

Reference games use no private haptic method, and a game can enter play with
critical SFX ready without decoding every declared track first.

## T20.8 — Add typed scene transition payloads

This workstream implements an existing public roadmap item and removes closure
workarounds for loaded runs, selected levels, and results screens.

### Required approach

Payloads must join the existing transaction rather than becoming an external
mutable store.

- Declare target-scene payload types with literal scene names.
- Type `transition.setScene(name, payload)` against the target scene.
- Supply a cloned, validated, frozen payload to the target scene's creation
  context.
- Reject unsupported values using the same plain-data principles as game
  events.
- Discard the payload if update, snapshot, freeze, or transition commit fails.
- Define restart semantics separately; restart must not accidentally reuse a
  prior transition payload.
- Preserve the no-payload call for scenes that declare none.
- Keep native handles, sessions, save stores, and assets out of payloads.

### Done when

A loaded game selection and a terminal results flow can use separate scenes
without closures, casts, or duplicating the entire flow in one scene state.

## T20.9 — Add deterministic sensor contact tracking

This workstream supplies trigger lifecycle bookkeeping on top of Collision2D.
It does not move bodies, resolve penetration, or reopen the rejected Physics2D
adapter.

### Required approach

Build a pure tracker over stable game-owned collider IDs and explicit previous
state.

- Accept eligible sensor/body pairs produced by existing collision queries or
  a spatial hash.
- Return immutable, stably ordered `enter`, `stay`, and `exit` records.
- Preserve body and shape IDs, filters, and authored sensor metadata.
- Support swept eligibility for fast AABB trigger crossings where the caller
  supplies the sweep result.
- Keep response game-owned: collection, damage, checkpoint activation, and
  scene transition remain authored rules.
- Keep tracker state serializable as plain IDs, not collider or backend
  handles.
- Evaluate tilemap object-layer import as a separate authoring adapter after
  the core tracker is proven.

### Done when

The three platformers can replace custom previous-overlap sets with one tested
deterministic contact tracker without changing their gameplay responses.

## T20.10 — Move the pure camera definition to a headless boundary

This workstream corrects a package-organization edge discovered by the third
game's Node integration test. The function contains no React runtime behavior,
even though `GameView` consumes its result.

### Required approach

Move or re-export the definition from `rn-gamekit/camera2d` while preserving
symbol identity and the existing React import.

- Keep `defineGameCamera2D` validation native-free.
- Export `GameCamera2DDefinition` from the headless camera subpath.
- Re-export the exact same function and type from `rn-gamekit/react` for
  compatibility.
- Ensure importing `rn-gamekit/camera2d` loads no React or native peer.
- Keep hooks and presented-camera bindings in `rn-gamekit/react`.

### Done when

A headless game definition test can import its camera declaration without
loading React Native, and existing application imports continue to work.

## T20.11 — Add offline asset preparation and diagnostics

This workstream addresses the repeated mobile asset-preparation burden without
putting image processing into the runtime package or Metro execution path.

### Required approach

Start with a development-only CLI or repository script and generated static
TypeScript output.

- Accept individual PNG frames and trim transparent margins consistently.
- Preserve a union crop or explicit anchor so animation poses do not jitter.
- Pack frames into one or more bounded atlases.
- Emit deterministic frame rectangles, clips, and static `require()` calls.
- Keep generated output stable across unchanged inputs.
- Report source dimensions, atlas dimensions, decoded RGBA byte estimates,
  maximum texture dimensions, duplicate content, and unused frames.
- Accept optional author-declared attribution, source URL, author, and license
  metadata.
- Generate a credits/report artifact and warn when metadata is missing; never
  infer legal values.
- Evaluate platform texture ceilings and budgets before freezing defaults.
- Keep the CLI out of the mobile runtime dependency graph.

### Done when

A repository-owned synthetic fixture pack proves transparent trimming, stable
packing, generated static imports, metadata warnings, texture reporting, and
byte-for-byte deterministic output in CI. The original local Mossy folder
remains a manual reference input that can produce the curated runtime manifest
and report when available; CI and task completion must not depend on a user's
`Downloads` directory.

## T20.12 — Add an irregular static world layer only if needed

This workstream addresses terrain and decoration chunks that are atlas-backed
but not cell-sized. It must prove that composition of existing primitives is
insufficient before adding another renderer component.

### Required approach

Try a documented `SpriteBatch` authoring recipe first. Add a new component only
when the reference case demonstrates missing culling or ownership behavior.

- Accept immutable instances with frame, position, scale, rotation, anchor,
  layer, and conservative bounds.
- Group by source sheet and use stable Atlas buffers.
- Cull against the presented camera without changing simulation.
- Keep collision and visual chunks independent.
- Avoid per-frame React reconciliation and per-instance worklets.
- Support parallax through the existing `GameLayer2D` contract.
- Do not make irregular chunks pretend to be tile cells.

### Done when

Mossy Cavern 3 can render irregular floating-platform and decoration chunks
with camera culling and stable batching, without hand-authored repeated Skia
nodes or collision/render coupling.

## T20.13 — Evaluate platformer-feel composables

This workstream treats three independent implementations as evidence but does
not assume every repeated mechanic belongs in the engine.

### Required approach

Compare the implementations and extract only small, pure, policy-driven pieces
that remain identical after naming and coordinate differences are removed.

- Evaluate acceleration and braking helpers.
- Evaluate coyote-time and jump-buffer state transitions.
- Evaluate variable-jump gravity selection.
- Evaluate dash timers and cooldown helpers.
- Evaluate respawn/camera-cut reset helpers.
- Keep enemy AI, damage rules, collectibles, checkpoint semantics, lives,
  scoring, and level progression game-owned.
- Prefer composable functions over a `PlatformerController` class or hidden
  mutable state.
- Keep `movePlatformerBody2D` as the low-level terrain authority.

### Decision gate

Do not add a helper merely because all three games have similarly named code.
Approve it only when one shared pure contract reduces code in every game while
preserving each game's authored feel and tests.

### Done when

The evaluation either produces a small proven helper set with migrations in
all three games or records a no-go explaining why the mechanics must remain
game-owned.

## T20.14 — Reconcile documentation and roadmap state

This workstream updates public documentation after contracts land. The current
roadmap still lists tilemaps and storage as future work even though Tasks 16
and 17 are complete, while transition payloads and hardware input remain open.

### Required approach

Update claims only alongside implemented and verified APIs.

- Move completed tilemap and storage systems into recent additions.
- Keep transition payloads and hardware input under next work until complete.
- Document the particle migration and deterministic sampling order.
- Document prepared-session ownership and cancellation in save/load guides.
- Document the renderer lifecycle source and effect-binding ownership model.
- Remove private haptic lifecycle examples.
- Add asset-tooling and device-verification guidance after those tools exist.
- Keep API reference imports aligned with package entry-point ownership.

### Done when

The roadmap, guides, examples, package exports, and implementation status no
longer contradict one another.

## Cross-workstream verification gates

Every promoted implementation task must pass the repository gates and the
specific evidence appropriate to its risk.

### Automated gates

The automated baseline remains test-first and repository-wide.

- Add failing unit and compile-time fixtures before implementation.
- Maintain at least 80 percent coverage for new headless modules.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Run `pnpm test:coverage` for new pure systems.
- Verify package export maps and native-free headless imports.
- Verify `git diff --check` and generated artifact stability.

### Runtime gates

Native claims require development or release builds on physical devices.

- Open, interact with, pause, resume, background, foreground, and close every
  affected reference game.
- Verify audio startup, mute restoration, music replacement, and cleanup.
- Verify haptic suppression and graceful unsupported-device behavior.
- Verify particle start, expiry, pause, camera movement, and replacement.
- Verify keyboard/controller connect, disconnect, and simultaneous touch when
  hardware input lands.
- Record 60 Hz and 120 Hz evidence before making refresh-rate claims.

## Recommended first delivery slice

The first implementation slice must stay small enough to review and measure.
It resolves the two runtime failures and the most repeated unsafe lifecycle
usage before taking on shell or input architecture.

1. Implement T20.1 explicit particle scale envelopes.
2. Implement the haptic public pause portion of T20.7.
3. Implement T20.3 read-only lifecycle binding for particle presentation.
4. Add the automated portion of T20.4 to all three Mossy Cavern games.
5. Run the physical-device smoke matrix and record results.

After that slice is green, implement T20.2 as a separate shell-focused task.
Do not combine the async surface state machine with particle or native-input
changes.

## Final definition of done

Task 20 is an umbrella backlog. Planning is complete when this synthesis is
reviewed and priorities are accepted. Implementation is complete only when
each accepted workstream has its own test-first task, compatibility decision,
documentation update, and verification record.

The outcome must be visible in the reference games: no fake hardware prompts,
no post-start save injection, no renderer/session coordinator globals, no
private lifecycle casts, no ambiguous shrink ranges, and no native-runtime
claim based only on a successful bundle.

## Focused review — Task 20A slice 1

This review covers only the reported particle-envelope slice: the public
definition and sampling contract, focused tests, renderer behavior, Particle
Lab coverage, and the three Mossy Cavern particle gates. The already reported
repository-wide checks were not rerun. The slice needs the following changes
before T20.1 is treated as complete.

### T20A-R1 — Do not expose negative scale until every renderer defines it

Priority: high. The public type and guide state that negative finite scales are
supported, but the shape renderer passes the signed value directly to Skia as
a circle radius or rectangle width and height. Negative radii and dimensions
are not a defined flip operation. The sprite path instead receives a signed
RSXform scale, so the same authored envelope has different semantics depending
on particle kind. The current negative-scale test checks only the headless
value at age zero and never reaches a negative rendered value.

For this slice, validate both scalar endpoints and range bounds as greater than
or equal to zero, remove the negative-support claim, and retain zero as the
collapse-to-a-point case. If signed scale is a real future requirement, specify
axis and pivot semantics first, render shapes through an explicit transform,
and add mounted shape and sprite tests that cross zero. Do not infer support
from interpolation alone.

Affected code:

- `packages/gamekit/src/particles/types.ts`
- `packages/gamekit/src/particles/defineParticleEffect.ts`
- `packages/gamekit/src/react/particles/ParticleView.tsx`
- `packages/gamekit/test/particles.envelopes.test.ts`
- `apps/docs/content/docs/engine-systems/particles.mdx`

### T20A-R2 — Validate optional scale fields by presence, not truthiness

Priority: medium. `defineParticleEffect` currently enters validation only when
`scale` or `scaleOverLife` is truthy. Raw JavaScript values such as `null`,
`false`, or `0` therefore bypass the intended boundary checks. Because the
return value begins with `...def`, a malformed value can remain on the frozen
definition even though sampling silently falls back to the default scale. The
same gap remains when `createParticleSystem` revalidates a raw definition.

Use `value !== undefined` for mutual exclusion and validation. Require `scale`
to be a non-null object with both endpoints, reject arrays and invalid legacy
values, and construct the normalized result so an unchecked optional field
cannot survive the input spread. Add focused raw-boundary tests for `null`,
`false`, `0`, arrays, and both properties being present with malformed values.

Affected code:

- `packages/gamekit/src/particles/defineParticleEffect.ts`
- `packages/gamekit/test/particles.envelopes.test.ts`

### T20A-R3 — Separate author input from the normalized definition type

Priority: medium. `defineParticleEffect` normalizes scalar endpoints into
frozen ranges, but its return type remains `ParticleEffectDefinition`, whose
endpoints are still `number | Range`. The type fixture consequently proves
valid authoring syntax but does not prove the normalized output contract. The
same type also permits `scale` and `scaleOverLife` together even though the
runtime rejects that combination.

Introduce an author-input type with scalar-or-range endpoints and a normalized
definition type with range-only endpoints. Encode legacy versus explicit scale
as an exclusive union, while retaining the runtime check for JavaScript and
unsafe inputs. Update `defineParticleEffect` and `createParticleSystem`
signatures to expose normalized definitions, then add compile fixtures that
prove range-only output and reject definitions containing both scale forms.

Affected code:

- `packages/gamekit/src/particles/types.ts`
- `packages/gamekit/src/particles/defineParticleEffect.ts`
- `packages/gamekit/test/api/particles.envelopes.types.ts`

### T20A-R4 — Replace self-derived compatibility expectations with a golden

Priority: medium. The legacy compatibility test calculates its expected result
with the current `createRng` and `sampleRange` helpers. A simultaneous change to
those helpers or their consumption order can update both the implementation and
the expectation while the test remains green. That is weaker evidence than the
reported byte-for-byte compatibility guarantee.

Capture a pre-envelope golden emission snapshot with literal numeric values.
Use ranged lifetime, speed, direction, rotation, and legacy scale so every
historical draw is observable. Assert the full sampled record, including
velocity, rotation, scale start, scale end, and the absence of a synthesized
`scale` envelope. Keep the existing behavioral test as a readable companion,
but let the golden fixture guard compatibility.

Affected code:

- `packages/gamekit/test/particles.envelopes.test.ts`

### T20A-R5 — Make all three Mossy gates prove every effect emits

Priority: medium. The Mossy Cavern 3 gate constructs and disposes a particle
system, but it emits only `dust`. It does not exercise every authored effect as
claimed in the completion report. Aggregate `emitted > 0` assertions in the
other game gates also provide less diagnostic value than effect-specific
checks.

Use the same table-driven contract in all three games: construct one real
system, emit each effect with a valid deterministic command, and assert that
the effect's diagnostics report the authored burst count. Dispose in a
`finally` block so a failed assertion cannot leave a system alive. Keep the
Mossy Cavern 3 dust assertion as a separate intent test.

Affected code:

- `apps/playground/src/screens/mossy-cavern/mossyCavernEffects.test.ts`
- `apps/playground/src/screens/mossy-cavern-2/mossyCavern2Effects.test.ts`
- `apps/playground/src/screens/mossy-cavern-3/mossyCavern3Particles.test.ts`

### Review disposition

Address T20A-R1 and T20A-R2 before marking the particle-envelope contract
complete. T20A-R3 and T20A-R4 tighten the public API and compatibility evidence
and belong in the same slice while the contract is still new. T20A-R5 can land
as the final focused fixture update before the physical-device smoke matrix.

## Focused re-review — Task 20A remediation pass

The implementation addresses the five original review actions at the source
and type-contract levels. Presence validation, non-negative explicit
envelopes, normalized output types, exclusive authoring types, literal legacy
expectations, and table-driven Mossy gates now match the requested direction.
Two focused test changes remain before closing the automated portion of T20.1.

### T20A-RR1 — Lock the legacy renderer clamp with mounted tests

Priority: medium. `ParticleView` now clamps legacy negative scale to zero in
the shape sampler and separately in the sprite Atlas worklet. The guide
promises this behavior, but the mounted renderer test covers only a positive
explicit envelope. Headless snapshots can still contain a negative legacy
scale, so the renderer clamp is the only protection against passing signed
geometry to Skia.

Add a legacy definition whose entire `scaleOverLife` range is negative. Mount
a circle particle and assert that its recorded radius is zero. Record RSXform
buffer writes in the Skia mock, mount a sprite particle from the same legacy
case, and assert that its transform scale is zero. These two assertions protect
both clamp sites and the documented compatibility behavior.

Affected code:

- `packages/gamekit/test/particleView.contract.test.tsx`

### T20A-RR2 — Keep golden values literal but compare floats by tolerance

Priority: medium. The compatibility fixture now uses literal pre-envelope
values, which removes its dependency on the current sampler helpers. However,
`assert.deepEqual` also requires exact equality for velocity values produced
through `Math.sin` and `Math.cos`. Their final bits can vary across JavaScript
runtimes and platform math implementations even when sampling order and
behavior remain compatible. The public guide already defines compatibility
within `PARTICLE_TOLERANCE`.

Keep every expected number as a literal golden value. Assert discrete fields
and object shape exactly, then compare lifetime, velocity, rotation,
rotation speed, and scales against their literal values with
`PARTICLE_TOLERANCE`. Do not regenerate expectations with `createRng` or
`sampleRange`; the fixture must remain independent of the implementation.

Affected code:

- `packages/gamekit/test/particles.envelopes.test.ts`

### Re-review disposition

The five original actions are structurally resolved. Complete T20A-RR1 and
T20A-RR2, then treat the automated T20.1 contract as closed and proceed to the
T20.3 and T20.7 lifecycle slice. The physical-device smoke matrix remains a
separate runtime gate.

## Focused review — T20.3 and T20.7 haptic lifecycle slice

This review covers only the lifecycle source, particle presentation ownership,
shell presentation binding, Mossy migrations, and public haptic pause binding.
The reported repository-wide gates were not rerun. The source and API direction
is sound, but one asset-ready publication defect and two lifecycle ownership
gaps remain.

### T20L-R1 — Publish the bound renderer on asset readiness

Priority: high. `SurfaceController.assetReady()` creates the session-scoped
presentation binding, but the `asset-ready` event carries only its disposer.
The reducer therefore keeps the loading slot's original renderer instead of
publishing `presentation.renderer`. Both Mossy Cavern 1 and 2 are asset-backed,
and their original renderers return `null` when the injected particle system is
missing. Their particle systems and event bridges are created, but the ready
surface renders neither game.

Add the resolved renderer to the `asset-ready` event, pass
`presentation?.renderer ?? entry.renderer` from the controller, and publish it
atomically with the real session, assets, and presentation disposer. Add an
asset-backed `bindPresentation` fixture to the controller test. Assert that the
loading slot uses the original renderer, the ready slot uses the wrapped
renderer, the binder runs once, and replacement and final unmount release the
binding once.

Affected code:

- `apps/playground/src/shell/surfaceController.ts`
- `apps/playground/src/shell/surfaceSlot.ts`
- `apps/playground/src/shell/surfaceController.test.ts`
- `apps/playground/src/shell/surfaceSlot.test.ts`

### T20L-R2 — Stop the frame loop for initially paused active systems

Priority: medium. `useParticlePresentation` applies the lifecycle pause before
stepping, but `stepFrame()` schedules its next frame whenever the driver is not
idle. If particles are already active when the hook binds to an initially
paused lifecycle source, the paused step cannot expire them, the driver remains
non-idle, and the hook keeps scheduling frames while paused. The reactive
`updateScheduling()` path has the correct running-status guard, but the frame
path does not.

After publishing the terminal clock, schedule another frame only when
`system.status === 'running' && !driver.isIdle()`. Otherwise, stop scheduling.
Add a regression that emits before mounting, binds an initially paused source,
and proves that the system pauses without scheduling a follow-up frame. Resume
the source and prove that exactly one driver restarts.

Affected code:

- `packages/gamekit/src/react/particles/useParticlePresentation.ts`
- `packages/gamekit/test/particleView.contract.test.tsx`

### T20L-R3 — Make haptic lifecycle detachment part of disposal

Priority: medium. `GameHaptics.bindLifecycle()` returns the source's detach
function directly, but `dispose()` does not retain or invoke it. Mossy Cavern 1
drops the returned function and later disposes only the haptics object. The
session can therefore retain a listener closure after the component and haptic
resource are disposed.

Define one explicit binding policy. Prefer one active lifecycle source per
`GameHaptics`: binding a replacement detaches the previous source, the returned
detach is idempotent, and `dispose()` detaches the active source before removing
the AppState listener. Retain and invoke the detach in the Mossy Cavern 1 effect
cleanup as the reference usage. Add tests for listener count after disposal,
replacement-source isolation, repeated detach, and lifecycle transitions after
disposal.

Affected code:

- `packages/gamekit/src/haptics/createGameHaptics.ts`
- `packages/gamekit/src/haptics/types.ts`
- `packages/gamekit/test/audioHaptics.test.tsx`
- `apps/playground/src/screens/mossy-cavern/MossyCavernContent.tsx`
- `apps/docs/content/docs/engine-systems/haptics.mdx`

### Lifecycle-slice review disposition

Do not close T20.3 until T20L-R1 is fixed because the production asset-ready
path currently drops the renderer that owns the new session-scoped resources.
Complete T20L-R2 and T20L-R3 in the same focused lifecycle slice, then proceed
to the T20.4 physical-device smoke matrix. The audio-loading portion of T20.7
remains a separate accepted workstream unless it is explicitly removed from
scope.

## Focused re-review — T20.3 lifecycle remediation

The implementation resolves T20L-R1, T20L-R2, and T20L-R3. Asset readiness now
publishes the bound renderer, paused active systems stop scheduling, and haptic
lifecycle bindings detach on replacement and disposal. Two adjacent lifecycle
issues remain in the same paths.

### T20L-RR1 — Preserve the catalog pointer contract at asset readiness

Priority: medium. `reduceAssetReady()` still publishes `pointer: true`
unconditionally. This overrides `SurfaceGameEntry.pointer` for every
asset-backed game. Platformer Lab and all three Mossy Cavern entries declare
`pointer: false`, so they unexpectedly mount `GamePointerInput` after loading
and can dispatch the default `primary` action alongside their authored button
controls. The reducer test currently asserts this incorrect forced-true value.

Carry `entry.pointer` and `entry.pointerAction` in the `asset-ready` event and
publish both fields from the event. Extend the controller and reducer tests
with an asset-backed pointer-disabled entry and an asset-backed custom-action
entry. Prove the loading slot remains disabled and the ready slot exactly
matches its catalog declaration.

Affected code:

- `apps/playground/src/shell/surfaceController.ts`
- `apps/playground/src/shell/surfaceSlot.ts`
- `apps/playground/src/shell/surfaceController.test.ts`
- `apps/playground/src/shell/surfaceSlot.test.ts`

### T20L-RR2 — Keep the presentation driver stable across React renders

Priority: medium. `applyCombinedPause` is recreated during every render and is
listed in the driver effect's dependency array. A parent render therefore
releases and reacquires the exclusive particle driver, detaches and reattaches
the lifecycle subscription, resets its time baseline, and runs an immediate
step. The new regression test explicitly relies on this rebind instead of
protecting stable per-system ownership.

Keep the driver and scheduler effect stable for the lifetime of `system` and
`binding`. Move lifecycle subscription into a separate effect keyed by the
current lifecycle source and legacy subscription callback; route its status
changes through `controlRef.current.updateScheduling()`. Keep pause evaluation
behind a stable callback or an effect-local function that reads the existing
refs. Replace the rebind regression with one that rerenders the same system and
source, then proves driver acquisition, lifecycle subscription, and scheduled
frame ownership do not change.

Affected code:

- `packages/gamekit/src/react/particles/useParticlePresentation.ts`
- `packages/gamekit/test/particleView.contract.test.tsx`

### Lifecycle remediation re-review disposition

The original three review findings are closed. Complete T20L-RR1 before the
device smoke matrix because the current asset-ready path enables an unintended
input adapter in the affected games. Complete T20L-RR2 before closing T20.3 so
the public lifecycle path preserves one stable presentation owner rather than
depending on incidental effect churn.

## Broad review — T20.4 smoke prep and T20.2 shell slice

This review covers the current combined diff after the T20.4 smoke-prep work
and the T20.2 async prepared-session shell work. The shell state-machine tests
cover the main promise ordering paths, but the source still has four issues to
address before these workstreams are considered closed.

### T20R-1 — Asset readiness still overrides pointer declarations

Priority: high. This is the same issue recorded as T20L-RR1, and it remains
present in the current diff. `reduceAssetReady()` still publishes
`pointer: true` unconditionally, and the `asset-ready` event still does not
carry `pointer` or `pointerAction`. The current controller and reducer tests
also assert the forced-true behavior, so they protect the bug.

Current evidence:

- `apps/playground/src/shell/surfaceSlot.ts:312`
- `apps/playground/src/shell/surfaceSlot.ts:326`
- `apps/playground/src/shell/surfaceController.ts:255`
- `apps/playground/src/shell/surfaceController.ts:386`
- `apps/playground/src/shell/surfaceController.test.ts:474`
- `apps/playground/src/shell/surfaceSlot.test.ts:269`

Address this before device smoke. Add `pointer` and optional `pointerAction`
to the `asset-ready` event, pass them from `SurfaceGameEntry` in both the sync
and async asset-ready paths, and publish those exact values in
`reduceAssetReady()`. Replace the forced-true tests with asset-backed fixtures
for `pointer: false`, `pointer: true`, and a custom pointer action. The ready
slot must match the catalog declaration exactly.

### T20R-2 — Particle presentation still rebinds on ordinary React renders

Priority: medium. This is the same issue recorded as T20L-RR2, and it remains
present in the current diff. `applyCombinedPause` is recreated on every render
and is listed in the driver effect dependency array, so a parent HUD or status
render tears down the exclusive driver, detaches the lifecycle subscription,
resets the scheduler baseline, and runs an immediate step. One test currently
documents the rebind during rerender instead of preventing it.

Current evidence:

- `packages/gamekit/src/react/particles/useParticlePresentation.ts:100`
- `packages/gamekit/src/react/particles/useParticlePresentation.ts:114`
- `packages/gamekit/src/react/particles/useParticlePresentation.ts:226`
- `packages/gamekit/test/particleView.contract.test.tsx:693`

Keep the driver effect stable for the lifetime of `system` and `binding`.
Move pause evaluation into the effect or wrap it in a stable callback that reads
the existing refs. Put lifecycle subscription ownership in a separate effect
keyed only by the lifecycle source or legacy subscribe callback, and route
status transitions through `controlRef.current.updateScheduling()`. Replace the
rerender regression with one that proves driver ownership, subscription count,
and scheduled frame ownership do not change when the same system and lifecycle
source rerender.

### T20R-3 — Synchronous preparation failures bypass the retry UI

Priority: medium. T20.2 adds `onPrepareError` for retryable preparation
failures, but only promise rejections reach it. If `createSession(context)`
throws before returning a promise, or if `bindPresentation(session)` throws
after a session is created, the exception escapes `SurfaceController.open()` or
`SurfaceController.assetReady()` and can crash the shell instead of showing
`AssetGateOverlay` with Retry.

Current evidence:

- `apps/playground/src/shell/surfaceController.ts:181`
- `apps/playground/src/shell/surfaceController.ts:198`
- `apps/playground/src/shell/surfaceController.ts:247`
- `apps/playground/src/shell/surfaceController.ts:254`
- `apps/playground/src/shell/PlaygroundShell.tsx:112`

Centralize preparation in a helper that catches synchronous throws and promise
rejections through the same request-id guard. For a non-asset open that fails
synchronously, publish a loading/error slot for that request before invoking
`onPrepareError`, so Retry has a mounted surface to target. For an asset-backed
request, leave the existing loading slot in place and surface the error against
the current request. If binding presentation fails after a session exists,
dispose that session before reporting the preparation error. Add controller
tests for sync throw, asset-ready sync throw, and bind-presentation throw.

### T20R-4 — The smoke matrix claims manual pause coverage Brick Breaker cannot exercise

Priority: medium. `plans/task-20-device-smoke.md` says the smoke flow covers
pause, resume, background, foreground, haptics, and particle freezing across
all games, but the Brick Breaker section has no pause/resume step and
Brick Breaker exposes no `brick-breaker-pause` test target. That leaves part of
T20.4's stated manual evidence unexecutable.

Current evidence:

- `plans/task-20-device-smoke.md:23`
- `plans/task-20-device-smoke.md:28`
- `plans/task-20-device-smoke.md:70`
- `apps/playground/src/screens/brick-breaker/BrickBreakerContent.tsx:267`

Choose one honest closure path. If Brick Breaker is part of the required
reference-game smoke set, add a pause/resume control with a stable
`brick-breaker-pause` testID and update the flow to use it. If T20.4 is scoped
only to the Mossy reference games for manual pause, rewrite the document so the
Brick Breaker row covers particles plus background/foreground only, and record
manual pause as out of scope rather than an all-games claim.

### Broad review disposition

Do not mark T20.4 complete until T20R-1 and T20R-4 are addressed, then the
physical iOS and Android rows in `plans/task-20-device-smoke.md` are filled in.
Treat the T20.2 shell state machine as a good partial slice, but keep the
workstream open until T20R-3 is covered and the previously required Mossy
checkpoint-hydration proof lands.

## Full working-tree review — T20.4 and T20.2 shell slice

This review covers the current working tree after the T20.4 smoke-flow prep and
the T20.2 async prepared-session shell slice. I inspected the changed runtime,
shell, tests, docs, and the untracked Mossy reference-game files. I did not
rerun the broad reported gates.

The async prepared-session controller direction is sound: request ids stay
opaque, pending preparations abort on replacement paths, stale resolutions are
disposed without publication, and prepare failures reuse the retryable overlay.
However, two earlier lifecycle findings are still present in the checked-out
code, and the T20.2 done-when is not complete yet.

### T20F-R1 — Asset-ready still forces pointer input on disabled games

Priority: high. `reduceAssetReady()` still publishes `pointer: true`
unconditionally. That means every asset-backed, pointer-disabled game becomes
pointer-enabled after loading. This currently affects `platformer-lab`,
`mossy-cavern`, `mossy-cavern-2`, and `mossy-cavern-3`, all of which declare
`pointer: false` in the catalog. The earlier T20L-RR1 feedback called this out,
but the live reducer and tests still preserve the bug.

Affected code:

- `apps/playground/src/shell/surfaceSlot.ts:326`
- `apps/playground/src/shell/surfaceController.ts:255`
- `apps/playground/src/shell/surfaceController.ts:386`
- `apps/playground/src/shell/surfaceSlot.test.ts:269`
- `apps/playground/src/shell/surfaceController.test.ts:474`

Fix approach: carry `pointer` and `pointerAction` on the `asset-ready` event
from `SurfaceController.assetReady()` and async `trackPrepare()`, then publish
those values from `reduceAssetReady()`. Add reducer and controller tests for an
asset-backed pointer-disabled entry and an asset-backed custom pointer-action
entry. Update the existing tests that currently assert forced `true`.

### T20F-R2 — Particle presentation still rebinds on every React render

Priority: medium. `applyCombinedPause()` is still declared in render scope and
included in the presentation-driver effect dependencies. Any parent render of
the same `system` and lifecycle source releases and reacquires the exclusive
particle driver, detaches and reattaches the lifecycle subscription, resets the
time baseline, and performs a synchronous step. The mounted regression still
documents that rebind rather than protecting stable ownership.

Affected code:

- `packages/gamekit/src/react/particles/useParticlePresentation.ts:100`
- `packages/gamekit/src/react/particles/useParticlePresentation.ts:114`
- `packages/gamekit/src/react/particles/useParticlePresentation.ts:226`
- `packages/gamekit/test/particleView.contract.test.tsx:597`

Fix approach: keep the driver/scheduler effect keyed only to the stable
presentation ownership inputs (`system`, `binding`, and stable shared values).
Move lifecycle subscription into its own effect keyed by the current lifecycle
source or legacy subscription callback, and route status changes through
`controlRef.current.updateScheduling()`. Replace the rerender test with one
that proves the same system and same source do not reacquire the driver, do not
resubscribe, and do not create a new frame owner across parent renders.

### T20F-R3 — T20.2 shell plumbing is not the T20.2 completion criterion

Priority: medium. The new `GameSessionPrepareContext`, async factory support,
abort handling, stale-resolution disposal, and retry overlay close the generic
shell contract, but the task's own "done when" still requires reference proof:
all three Mossy Cavern sessions must hydrate from their validated save
projection before the first fixed tick. The pasted completion note calls this
out honestly, so do not close T20.2 based on the shell tests alone.

Affected code:

- `plans/task-20.md:297`
- `apps/playground/src/shell/PlaygroundShell.tsx:351`
- `apps/playground/src/shell/PlaygroundShell.tsx:374`
- `apps/playground/src/shell/PlaygroundShell.tsx:390`
- `apps/playground/src/screens/mossy-cavern-3/MossyCavern3Content.tsx:174`

Fix approach: make the Mossy entries use async `createSession(context)` only for
load-and-validate preparation, then construct the deterministic session
synchronously from the prepared save. Add a pure builder for each game, such as
`buildDefinition(save?)` or `makeState(save?)`, and add a controller or
game-level test proving the first published ready snapshot already contains the
loaded checkpoint or restored projection before any fixed update. Preserve the
current lossy projection semantics where a save intentionally stores aggregate
progress rather than every collected entity.

### T20F-R4 — Thrown factories and presentation binders escape preparation

Priority: high. The controller reports rejected preparation promises through
`onPrepareError`, but it does not guard synchronous `createSession()` calls or
any `bindPresentation()` call. A thrown factory can escape `open()` or
`assetReady()` before the retry state is published. A binder that throws after
an async preparation resolves also rejects the ignored promise returned by
`.then()`, clears the pending request before the failure, and leaks the resolved
session.

Affected code:

- `apps/playground/src/shell/surfaceController.ts:182`
- `apps/playground/src/shell/surfaceController.ts:198`
- `apps/playground/src/shell/surfaceController.ts:248`
- `apps/playground/src/shell/surfaceController.ts:254`
- `apps/playground/src/shell/surfaceController.ts:382`

Fix approach: centralize session creation and presentation finalization behind
one guarded request-aware helper. Convert synchronous throws and promise
rejections into the same current-request error path, abort the preparation
signal, keep a loading slot mounted for Retry, and dispose any session created
before binding failed. Add tests for factory throws and binder throws in both
asset-backed and non-asset paths, including a stale-request variant.

### T20F-R5 — Required async integration orderings are still unproved

Priority: medium. The controller tests call `assetReady()` twice to model a
Strict Mode duplicate, but no mounted shell test exercises React Strict Mode or
a same-props rerender. The required asset/save ordering test is also absent.
For an asset-backed entry, the current controller does not invoke
`createSession()` until assets are ready, so save preparation cannot settle
first unless a game starts work outside the entry contract. The existing eight
tests therefore do not close all hostile-ordering requirements in T20.2.

Affected code:

- `plans/task-20.md:302`
- `apps/playground/src/shell/PlaygroundShell.tsx:250`
- `apps/playground/src/shell/surfaceController.test.ts:259`

Fix approach: decide explicitly whether asset loading and save preparation run
in parallel. If they do, add a separate entry preparation phase that starts at
open and let the controller join its result with the matched asset lease before
constructing the session. Mount the real shell boundary under React Strict Mode
with controllable asset and save promises, resolve them in both orders, rerender
with identical props, and prove one preparation, one binding, one publication,
and one disposal owner. If preparation intentionally starts only after assets,
revise the task requirement and document the serial startup contract instead of
claiming both orderings.

### T20F-R6 — The all-game smoke claim has no Brick Breaker pause action

Priority: medium. The smoke record says every game exercises pause and resume,
and its expected observations apply pause, haptic, and particle behavior to all
games. The Brick Breaker flow only backgrounds and foregrounds the app, and the
screen has no `brick-breaker-pause` control. A tester cannot execute the stated
manual-pause coverage for that game.

Affected code:

- `plans/task-20-device-smoke.md:23`
- `plans/task-20-device-smoke.md:28`
- `plans/task-20-device-smoke.md:70`
- `apps/playground/src/screens/brick-breaker/BrickBreakerContent.tsx:267`

Fix approach: either add a stable Brick Breaker pause/resume control and include
it in the flow, or scope the all-game language to background lifecycle checks
and record manual pause as a Mossy-only assertion. Keep the physical matrix
pending until the documented flow matches what the build can execute.

### Review disposition

Fix T20F-R1 and T20F-R4 first because they can enable an invalid input adapter,
crash the shell, or leak a prepared session. Fix T20F-R2 next to stabilize
presentation ownership. Then complete T20F-R3 and T20F-R5 together as the Mossy
hydration and mounted async-integration slice. Resolve T20F-R6 before executing
the device script, then record the required physical iOS and Android rows.

Do not close T20.2, T20.3, or T20.4 from the reported green gates. T20.2 still
lacks guarded failure paths, the Mossy hydration proof, and required integration
orderings. T20.3 still churns the exclusive particle driver on React renders.
T20.4 still runs the wrong pointer surface for asset-backed platformers, has an
unexecutable all-game pause claim, and has no physical-device results.

## Focused re-review — T20F remediation pass

This re-review checks the reported T20F-R1, T20F-R4, T20F-R2, and T20F-R6
remediation against the current source and focused fixtures. T20F-R1 is closed:
asset readiness now preserves both pointer fields through the sync and async
paths. T20F-R4's runtime error paths are guarded and dispose created sessions.
T20F-R6 is closed by explicitly limiting manual-pause coverage to the Mossy
games. One lifecycle defect and one focused test gap remain.

### T20FR-R1 — Apply lifecycle source replacement immediately

Priority: medium. The particle driver now remains stable across ordinary React
renders, but the separate lifecycle subscription effect only subscribes to a
replacement source. It does not apply that source's current status. If the old
source is running and the replacement is already paused, the system remains
running until a later frame, wake, or status notification and can accept an
emission that the paused-drop policy requires it to reject. The inverse change
can leave a system paused after replacement with a running source and no frame
available to resume it.

Affected code:

- `packages/gamekit/src/react/particles/useParticlePresentation.ts:218`
- `packages/gamekit/src/react/particles/useParticlePresentation.ts:225`

Fix approach: subscribe to the selected source first, then immediately call
`controlRef.current.updateScheduling()`. This ordering avoids missing a status
transition between reading current state and attaching the listener. Apply the
same immediate synchronization when switching to or from the legacy subscriber
and when removing lifecycle input entirely. Add a mounted source-replacement
test that proves paused emissions drop immediately, a running replacement
resumes immediately, and transitions from the detached source reach nobody.

### T20FR-R2 — Replace the old rebind fixture with the claimed stability test

Priority: medium. The completion report says the rebind regression was replaced
with a test for one subscription, no cancellations, no extra frames, and a
continuously held driver lease. The checked-in test still has the old title,
comments, and assertions that explicitly describe a rebind. It checks only that
the paused rerender schedules no additional tick, so it can pass without proving
stable driver or subscription ownership.

Affected code:

- `packages/gamekit/test/particleView.contract.test.tsx:693`
- `packages/gamekit/test/particleView.contract.test.tsx:707`

Fix approach: instrument the lifecycle source's subscribe and detach counts and
the scheduler's acquire/cancel behavior. Rerender the same system and source at
least twice, then prove the counts and pending frame owner do not change. Keep
the exclusive-driver assertion before and after rerender, and verify lifecycle
transitions still control the original driver.

### T20FR-R3 — Complete the asset-backed binder failure fixture

Priority: low. The guarded asset-backed binder path is present in the source,
but the new binder-throw fixtures cover only non-asset entries. The test named
"stale thrown binder" supersedes the request before resolution, so the binder
correctly never runs; it tests stale-resolution disposal rather than a thrown
binder. This does not reopen the main T20F-R4 implementation, but it leaves one
requested branch without direct regression coverage.

Affected code:

- `apps/playground/src/shell/surfaceController.ts:279`
- `apps/playground/src/shell/surfaceController.test.ts:465`
- `apps/playground/src/shell/surfaceController.test.ts:489`

Fix approach: add an asset-backed entry whose synchronous or asynchronous
session resolves and whose binder throws while the request is current. Prove
the loading slot and matched lease request remain current, the created session
disposes once, the error surfaces once, and Retry uses a fresh request. Rename
the stale test to state what it proves: stale resolution disposes without
invoking the binder.

### Remediation re-review disposition

Keep T20F-R1, T20F-R4's runtime implementation, and T20F-R6 closed. Complete
T20FR-R1 and T20FR-R2 before closing T20F-R2. T20FR-R3 is focused test debt and
can land in the same small patch. T20F-R3 and T20F-R5 remain open exactly as the
completion report states: the three Mossy sessions still need pre-first-tick
hydration and mounted serial-preparation integration coverage. Physical iOS and
Android device rows also remain pending.

## Focused re-review — T20F follow-up remediation

The three runtime changes are correct. Replacing a lifecycle source now applies
its current status after subscription, the particle driver effect is stable
across ordinary parent renders, and current asset-backed binder failures dispose
their prepared sessions. T20FR-R1 and the runtime portions of T20FR-R2 and
T20FR-R3 are closed. Two small contract-test corrections remain before the
automated T20F follow-up is fully closed.

### T20FRR-R1 — Prove lifecycle detach and driver cleanup directly

Priority: medium. The new stable-driver test proves one subscription, no
rerender cancellation, no extra scheduled frame, and an exclusively held driver
lease. Its post-unmount assertion checks `subscribeCount` again, however, so it
does not prove the reported "detaches exactly once" behavior. It also does not
check the scheduler cancellation or driver release after unmount. A lifecycle
listener leak or missed final driver cleanup could pass this test.

Affected code:

- `packages/gamekit/test/particleView.contract.test.tsx:718`
- `packages/gamekit/test/particleView.contract.test.tsx:760`

Fix approach: instrument the lifecycle wrapper's returned detach function and
assert zero detaches across both rerenders and exactly one detach after unmount.
After unmount, assert the active scheduled callback was cancelled exactly once
and acquire and release a fresh driver lease. Add a source-replacement assertion
that transitions from the detached old source no longer affect the system. Keep
the existing pre-unmount subscription, frame, transition, and exclusive-lease
assertions.

### T20FRR-R2 — Make the asset-backed Retry assertion match its claim

Priority: low. The asset-backed sync binder test's comment says Retry can
publish a full ready slot, but it reopens the same always-throwing fixture and
only checks that the error count reaches two. The second failure shows another
attempt occurred, but it does not directly prove a fresh request identity, the
second prepared session's disposal, or successful publication. The adjacent
"stale thrown binder" test also remains misnamed: the request becomes stale
before resolution, so the binder never runs.

Affected code:

- `apps/playground/src/shell/surfaceController.test.ts:524`
- `apps/playground/src/shell/surfaceController.test.ts:534`
- `apps/playground/src/shell/surfaceController.test.ts:558`

Fix approach: if the intended contract is retryability after repeated failure,
change the comment accordingly and assert that the second request ID is newer,
the binder creates a second session, and that session disposes exactly once. If
the intended contract includes recovery, make the fixture fail once and bind
successfully on the fresh request, then assert the ready slot. Rename the stale
test to state that stale resolution disposes without invoking the binder.

### Follow-up re-review disposition

Do not reopen the runtime work for T20FR-R1 through T20FR-R3. Close the automated
follow-up after T20FRR-R1 and T20FRR-R2 make the test evidence match the stated
contract. T20F-R3, T20F-R5, and the physical iOS and Android matrix remain open
and unchanged.

## T20FRR closure re-review

The focused re-review found no remaining issue in the two corrected test
contracts. T20FRR-R1 and T20FRR-R2 are closed, so the automated T20F follow-up
is closed.

The stable-driver contract now directly proves zero lifecycle detaches across
rerenders, exactly one detach and one final scheduler cancellation at unmount,
and successful driver acquisition by a fresh consumer after cleanup. The
source-replacement contract also proves that a detached source can no longer
change particle scheduling state.

The controller contracts now separate recovery from repeated failure. The
recovering asset-backed fixture proves a newer Retry request prepares a second
session and publishes the ready slot with its wrapped renderer and pointer
declaration. The always-throwing fixture proves both failed sessions dispose,
and the renamed stale-resolution test proves disposal occurs without invoking
the binder.

No broad gate was rerun during this review. The reported GameKit and playground
test, typecheck, lint, and diff-check results are accepted as the implementation
record. T20F-R3, T20F-R5, and the physical iOS and Android matrix remain open.

## Focused review - T20F-R3/T20F-R5 completion

This review checked the reported Mossy hydration and mounted Strict Mode
completion against the current source without rerunning the broad gates. The
first-snapshot hydration shape is now present for all three Mossy games, and the
shell creates Mossy sessions from the validated async save/profile loaders before
publishing the ready slot. Several closure issues remain.

### T20G-R1 - The mounted Strict Mode test bypasses the real asset-ready path

Priority: high. The new integration test claims to drive the real
`SurfaceController` and `GameSurface` boundary under Strict Mode, but it mocks
`rn-gamekit/react` and then calls the controller directly. `GameView`,
`GamePointerInput`, and `useGameAssets` are replaced by test hosts at
`apps/playground/src/shell/asyncPreparation.integration.test.tsx:62`, and the
test starts preparation by manually calling `controller.assetReady(...)` at
`apps/playground/src/shell/asyncPreparation.integration.test.tsx:196`.

That proves the controller can dedupe duplicate readiness once `assetReady()` is
invoked, but it does not prove the production React ordering that T20F-R5 asked
for: `GameAssetAcquirer` running `useGameAssets`, `onStateChange` publishing the
displayed state, `onReady` being called from the effect, shell request filtering,
and Retry UI behavior for the same mounted request.

The test's controllable `assetGateState` is never consumed by a mounted
`GameAssetAcquirer`; `GameSurface` receives `assetState={undefined}` and does not
call `useGameAssets`. The test also infers "one publication" from the final slot
instead of counting ready-slot publications through `onSlot`, so two
publications could satisfy the current assertions.

Fix approach: move the proof one level higher, or export a narrow test seam for
the acquirer. The passing test must not call `controller.assetReady()` directly.
Drive a mocked `useGameAssets` state from loading to ready, let
`GameAssetAcquirer` invoke `onReady` through its effect, and assert one
preparation, one binding, one publication, and one disposal under Strict Mode and
same-props rerenders.

The serial-startup decision must also update the authoritative "Required tests"
section at `plans/task-20.md:302`, which still requires resolving asset and save
promises in both orders. For serial startup, replace that requirement with proof
that save preparation never starts before the matched asset lease, starts once
after readiness, and remains single across duplicate ready effects and rerenders.

### T20G-R2 - content-side saves can overwrite the just-hydrated profile

Priority: high. The shell now loads a validated Mossy save/profile before
constructing each session, but the content components still open their own store
reads after mount and initialize their durable refs from defaults.

In Mossy Cavern 2, `profileRef` starts from the default profile, the async load
resolves later, and event handlers persist by spreading the current ref:
`apps/playground/src/screens/mossy-cavern-2/MossyCavern2Content.tsx:80`,
`apps/playground/src/screens/mossy-cavern-2/MossyCavern2Content.tsx:99`,
`apps/playground/src/screens/mossy-cavern-2/MossyCavern2Content.tsx:148`, and
`apps/playground/src/screens/mossy-cavern-2/MossyCavern2Content.tsx:238`. The
current guard prevents the late load from overwriting an early gameplay save, but
it does not prevent the early gameplay save from being based on the default
profile and overwriting stored fields such as mute settings, `completedRuns`,
`bestTimeMs`, or a higher aggregate relic count.

Mossy Cavern 3 has the same ownership split: `durableRef` starts with
`createDefaultMossyCavern3Save()`, event listeners can call `persist()` before
the second content-side `store.load()` resolves, and `persist()` derives the next
record from that default:
`apps/playground/src/screens/mossy-cavern-3/MossyCavern3Content.tsx:78`,
`apps/playground/src/screens/mossy-cavern-3/MossyCavern3Content.tsx:111`,
`apps/playground/src/screens/mossy-cavern-3/MossyCavern3Content.tsx:137`, and
`apps/playground/src/screens/mossy-cavern-3/MossyCavern3Content.tsx:162`.

Fix approach: make the validated startup projection available to the content
layer before event listeners are registered. A clean option is for the async
shell factory to attach the loaded save/profile to the session wrapper or slot
metadata that content receives. Initialize `profileRef`/`durableRef` from that
projection and use the content-side load only to refresh display state or recover
if no startup projection was provided. A smaller game-local alternative is to
buffer pure profile mutations or save-worthy snapshots until the second load
establishes its baseline, then apply them to the loaded record before the first
write. Do not queue a full record computed from defaults. Add regression tests
with a deferred content-side load and a gameplay event before the load resolves;
the persisted record must retain existing best times, mute settings, counters,
and other durable fields that are not changed by that event.

### T20G-R3 - prepared Mossy save loaders never dispose their stores

Priority: medium. The three async hydration loaders create a new
`GameSaveStore`, await one load, and then return without calling `dispose()`.

Evidence:

- `apps/playground/src/screens/mossy-cavern/mossyCavernData.ts:287`
- `apps/playground/src/screens/mossy-cavern/mossyCavernData.ts:289`
- `apps/playground/src/screens/mossy-cavern-2/mossyCavern2Save.ts:63`
- `apps/playground/src/screens/mossy-cavern-2/mossyCavern2Save.ts:65`
- `apps/playground/src/screens/mossy-cavern-3/mossyCavern3Save.ts:67`
- `apps/playground/src/screens/mossy-cavern-3/mossyCavern3Save.ts:69`

Why it matters: the current store implementation only holds in-memory queues, so
this is not an immediate native leak, but the public storage contract includes
`dispose()`, and every shell retry/open can allocate another short-lived store.
The loader path must model the same lifecycle discipline that content components
already use.

Fix approach: wrap each loader in `try/finally` and dispose the local store after
the load attempt. Check `signal.aborted` before constructing the store and again
after the load resolves. Add a focused loader test with an instrumented adapter
or store seam if practical; otherwise, cover it through code review because the
runtime behavior is straightforward and the public API currently does not expose
store disposal counters.

### T20G-R4 - MC3 hydration keeps an impossible checkpoint id

Priority: medium. The save schema normalizes unknown checkpoint ids to `null` at
`apps/playground/src/screens/mossy-cavern-3/mossyCavern3Save.ts:38`, but the
simulation constructor keeps a raw unknown id in state while falling back to the
authored spawn at
`apps/playground/src/screens/mossy-cavern-3/mossyCavern3Simulation.ts:141`. The
new hydration test asserts that impossible state at
`apps/playground/src/screens/mossy-cavern-3/mossyCavern3Hydration.test.ts:70`.

That contradicts the stated "validated save" contract and can leak a stale
checkpoint id into snapshots, content saves, and future comparisons even though
the player is not actually at that checkpoint.

Fix approach: normalize at the session boundary or inside
`createMossyCavern3State()`. An unknown id should either become `null` before it
reaches simulation state, or the constructor should call the same normalization
helper used by the save schema. Update the hydration test to prove the normalized
value and authored-spawn fallback agree.

### T20G-R5 - completion comments still describe the old sync-start model

Priority: low. Some Mossy content comments still say the shell creates sessions
synchronously and that restoring the live checkpoint is not claimed, which is no
longer true after the T20F-R3 shell hydration change.

Evidence:

- `apps/playground/src/screens/mossy-cavern/MossyCavernContent.tsx:264`
- `apps/playground/src/screens/mossy-cavern-2/MossyCavern2Content.tsx:137`
- `apps/playground/src/screens/mossy-cavern/MEMO.md:31`
- `apps/playground/src/screens/mossy-cavern-2/MEMO.md:39`
- `apps/playground/src/screens/mossy-cavern-3/MEMO.md:63`

Fix approach: update the comments so future work does not preserve the obsolete
mental model. The content-side loads are now HUD/settings/profile refreshes; the
live session state is seeded by the shell's async factory before the ready slot
publishes. Add a dated entry to each required build memo recording the positive
result, the serial asset-then-save ordering, and any remaining duplicate-load
friction. Do not erase the earlier diary entries; mark them as superseded.

### T20G-R6 - MC3 hydration aliases and freezes caller-owned save data

Priority: low. `createMossyCavern3State()` assigns
`save.collectedCrystalIds` directly to scene state, and the initial snapshot
returns the same array. `createGameSession()` deep-freezes that snapshot, so a
mutable array owned by a direct caller becomes frozen as a side effect of session
construction. The production storage path returns engine-owned validated data,
but the exported session builder also accepts ordinary caller-owned values.

Evidence:

- `apps/playground/src/screens/mossy-cavern-3/mossyCavern3Simulation.ts:165`
- `apps/playground/src/screens/mossy-cavern-3/mossyCavern3Game.ts:148`
- `packages/gamekit/src/core/session/createGameSession.ts:230`

Fix approach: clone the collected-id array at the state boundary. Add a focused
test proving session construction neither freezes nor later observes mutation of
the caller's array.

### R3/R5 disposition

Do not close T20F-R5 until T20G-R1 proves the real React asset-ready path rather
than a direct controller call. Do not close T20F-R3 until T20G-R2 proves hydrated
durable data cannot be overwritten by an early content event, T20G-R3 disposes
the one-shot loader stores, and T20G-R4 normalizes MC3 checkpoint state. T20G-R5
and T20G-R6 can ride with those fixes. After those automated items close, the
required physical iOS and Android rows in `plans/task-20-device-smoke.md` remain
the only native-runtime completion gate. The untracked Mossy work must be
committed or otherwise snapshotted before more broad edits.

## T20G fix disposition (2026-09-02)

- T20G-R1 (closed) — `GameAssetAcquirer` was extracted to
  `apps/playground/src/shell/gameAssetAcquirer.tsx` and the shell consumes the
  extracted component. The mounted Strict Mode integration
  (`apps/playground/src/shell/asyncPreparation.integration.test.tsx`) now
  drives the real acquirer effect with a mocked `useGameAssets` and never
  calls `controller.assetReady()` directly. It counts ready publications by
  distinct generation (the T8.4 retirement-drain republish is not a second
  publication) and asserts one preparation, one binding, one ready
  publication carrying exactly one session, one presentation release, and one
  session dispose. The "Required tests" section above now states the serial
  startup contract.
- T20G-R2 (closed) — each Mossy shell entry registers the loaded projection
  against its session (a per-entry WeakMap), and the controller publishes the
  entry's derived projection on the ready slot as `startupSave` metadata
  (carried by both ready reducers). `GameSurface` forwards it to content.
  MC1/MC2/MC3 initialize their durable baselines from the projection before
  event listeners register (`readStartupMossyCavernSave`,
  `readStartupMossyCavern2Profile`, `readStartupMossyCavern3Save`); the
  content-side loads are display refresh plus a recovery path when no
  projection exists. Regression: `mossyStartupSaves.test.tsx` gates the
  storage read, fires gameplay events before it resolves, and proves hydrated
  best times, mute settings, counters, and the music preference survive; the
  recovery-path test proves the `persistedBeforeLoad` guard is load-bearing
  (verified red without it).
- T20G-R3 (closed) — the three one-shot loaders abort before store
  construction on an already-aborted signal, re-check after the load resolves,
  and dispose the store in a `finally` block. Regression:
  `mossyStartupLoaders.test.ts` instruments store creation and observes the
  public `disposed` flag for the success, read-failure fail-open, pre-aborted,
  and abort-racing paths.
- T20G-R4 (closed) — `createMossyCavern3State` normalizes an unknown
  checkpoint id to `null` before it reaches simulation state; the hydration
  test proves the normalized id and the authored-spawn fallback agree.
- T20G-R5 (closed) — content comments describe the async shell startup; all
  three build memos carry dated 2026-09-02 entries recording the result, the
  serial asset-then-save ordering, and the remaining duplicate-load friction,
  with the earlier synchronous-startup entries marked superseded rather than
  erased.
- T20G-R6 (closed) — `createMossyCavern3State` clones the collected-id array
  at the state boundary; the hydration test proves session construction
  neither freezes nor later observes the caller's array.
- Incident note (disclosure): while restructuring MC1 content effects, an
  edit truncated the JSX/style tail of `MossyCavernContent.tsx` (lines after
  the save-store effect). The logic survived and was verified unchanged; the
  JSX and styles were rebuilt against the surviving code, the smoke plan's
  testID contract, and the captured style fragments. Behavior is covered by
  typecheck, lint, and the mounted gates; the layout is a faithful rebuild,
  not a byte-for-byte restore.
- Gates: playground 251 + 50 tests pass with typecheck clean and lint
  reporting zero problems; gamekit 769 tests pass with typecheck and lint
  clean; `git diff --check` clean.
- Remaining: the physical iOS and Android rows in
  `plans/task-20-device-smoke.md` are the only native-runtime completion gate.
