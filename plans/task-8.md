# Task 8: Safe game reopening, surface ownership, and interaction boundaries

## Status

**In progress — T8.0–T8.7 are implemented and the automated + simulator gates
pass; the physical-device and Android rows of T8.8 remain honestly
device-gated. The implementation handoff diagnosis (Failures A/B/C) is
resolved: the Brick Breaker interaction layout is split into a top bar and a
gameplay stage; same-id reopening allocates a unique request id and a fresh
binding generation; one `SurfaceController` owns the slot, retirement, and
disposal; disposal happens only after the replacement generation commits.**

Task 8 fixes a lifecycle regression in the playground shell and an independent
hit-testing regression in Brick Breaker:

1. Before Brick Breaker starts, pressing the visible back button starts the
   game because the full-screen start surface is layered above the header.
2. Closing and reopening the same game leaves the persistent surface bound to
   the old session. The shell disposes that session, so the old paused frame
   remains visible and the next interaction reaches a disposed `GameSession`.

These are playground integration bugs. The core session's disposed-state guard
is behaving correctly and must not be weakened to hide the invalid ownership.

---

## Reported reproduction

Use Brick Breaker as the primary feedback loop:

1. From Home, open Brick Breaker.
2. Before tapping the start prompt, press the back button.
3. Observe that the game starts instead of returning Home.
4. Once play has started, press back again; Home appears.
5. Open Brick Breaker again.
6. Observe the exact frame at which the previous session was closed rather
   than a fresh ready state.
7. Tap the game body.
8. Observe `This GameSession has been disposed`.

Do not mark Task 8 complete after fixing only the crash. The back-button
hit region, stale frame, disposed-session binding, and repeated navigation
lifecycle are one release gate.

---

## Confirmed diagnosis

### Failure A: the start surface owns the header's hit region

`apps/playground/src/screens/BrickBreakerContent.tsx` renders the top bar and
back button first, then renders an absolutely filled `Pressable` when
`hud.awaitingStart` is true.

The absolute start surface is a later sibling covering the entire
`SafeAreaView`, including the header. It wins native hit testing. Pressing the
visible back control therefore calls `startOrRestart`; after play begins the
start surface disappears and the back button works. This exactly matches the
reported state-dependent behaviour.

The intended interaction contract remains:

- the entire gameplay body may start/restart the game;
- the safe-area header and back control are never part of that body; and
- tapping the title or system-safe chrome must not generate gameplay input.

### Failure B: same-game reopen is treated as no surface change

`PlaygroundShell.handleOpenGame` creates a fresh session on every open event.
However, `GameSurface` owns a second, local `SurfaceSlot` and replaces that slot
only when this condition is true:

```ts
gameId !== slot.gameId
```

Opening Brick Breaker, closing it, and opening Brick Breaker again supplies a
new session with the same game id. The condition is false, so the local slot
continues to expose the previous session and its last committed frame.

At the same time, the outer shell considers that previous session retired and
disposes it. `GameView`, content, and pointer input can therefore remain bound
to the disposed session. A later start, lifecycle, or pointer operation reaches
the correct core guard and throws `This GameSession has been disposed`.

The current `generation` does not prevent this because loading slots reset it
to `0`, and a same-id open never constructs a replacement slot.

### Failure C: lifecycle ownership is split

There are currently two owners of game-session lifetime:

- `PlaygroundShell` owns `sessionBundle` and
  `retiringBaseSessionsRef`; and
- `GameSurface` owns `slot.session`, `slot.retiring`, and separate Performance
  Lab run sessions.

The outer owner can dispose a session the inner owner still presents. A blind
zero-delay timer is being used as a proxy for “the surface has rebound,” but
elapsed time does not prove that React, Skia presentation, content, and pointer
input have all committed a replacement binding.

The production shell also declares its own `SurfaceSlot` and transition
helpers instead of using `apps/playground/src/shell/surfaceSlot.ts`. Existing
headless tests exercise the parallel helper, not the same-id predicate that
fails in production. That is why the existing “reopening never reuses the
previous real session” test gave false confidence.

### Failure timeline

| Event | Outer shell | Persistent surface | Result |
| --- | --- | --- | --- |
| First open | Creates session A | Binds slot to session A | Correct |
| Close | Pauses A and shows Home | Keeps A and its last frame bound while hidden | Temporarily valid |
| Same game opens | Creates session B; queues A for disposal | Sees the same `gameId`, so keeps A | Stale frame |
| Retirement timer | Disposes A | Still binds A | Invalid ownership |
| User taps | Session B is not the presented target | Input/content reaches disposed A | Crash |

---

## Objective

Every explicit game-open event must produce a unique navigation request and a
fresh, atomically published surface binding, even when the catalog id is the
same as the previously opened game.

Closing a game must first remove that game from every active surface consumer.
Only after the replacement/neutral binding commits may the old session and its
resources be disposed.

The completed flow must be:

```text
open event
  -> unique request id
  -> fresh session/loading request
  -> one immutable surface slot
  -> GameView + renderer + content + pointer bind the same generation
  -> binding commit acknowledged
  -> superseded session/resources disposed exactly once
```

On close:

```text
active game slot
  -> pause/cancel gameplay input
  -> publish hidden neutral/home binding
  -> commit neutral binding
  -> dispose retired game session/resources exactly once
```

---

## Non-goals

- Do not change the fixed-step simulation or Brick Breaker rules.
- Do not make disposed sessions silently reusable.
- Do not remove explicit disposal or leave all sessions alive as a workaround.
- Do not reintroduce stack navigation or the iOS back gesture.
- Do not remount the entire persistent Skia canvas on every navigation event.
- Do not store `GameSession`, Skia objects, asset leases, or renderer components
  in Zustand. Zustand remains for low-frequency serializable playground state.
- Do not redesign the public GameKit navigation API in this task.
- Do not fold the physical-device remainder from Task 7 into “automated
  complete.” Device-only checks remain explicitly device-gated.

---

## Locked implementation decisions

### 1. A game id is not an open-instance identity

`PlaygroundGameId` identifies a catalog entry. It must never identify a
session, navigation request, presentation, pointer binding, or asset attempt.

Allocate a monotonically increasing `requestId` for every call to open a game,
including repeated opens of the same id. Do not reset this counter when Home is
shown.

Use two explicit identities if the asset flow needs both concepts:

- `requestId`: one user navigation/open request;
- `generation`: one concrete surface publication/binding.

An asset-backed request can keep one `requestId` while moving from a loading
generation to a ready generation. Every generation must still be globally
new for that mounted surface; it must not reset to `0` for each game.

### 2. One canonical surface state machine must be used in production

Delete the parallel shell-local `SurfaceSlot` model. Export one canonical type
and pure transition functions from the surface-state module, and make
`PlaygroundShell` use those exact functions.

The canonical model must represent at least:

- the unique request id;
- the unique binding generation;
- catalog game id or neutral/home state;
- loading, ready, or neutral status;
- the exact session currently bound;
- renderer and content belonging to that session;
- loaded assets belonging to that same request, when applicable;
- whether pointer input is enabled;
- owned retirement records; and
- enough identity to reject late asset or Performance Lab events.

The production component and the pure tests must not maintain lookalike
implementations.

### 3. The shell has one session/resource owner

Remove the outer `sessionBundle`/base-retirement ownership competing with the
inner surface slot. One shell-owned controller/state machine must own:

- the active/neutral slot;
- pending asset request, if any;
- Performance Lab attachment, if any;
- sessions/resources waiting for a binding acknowledgment; and
- final disposal.

Gameplay content borrows the active slot. It never disposes that slot's
session. `GameView` and `GamePointerInput` also borrow it.

### 4. Home uses an explicit neutral binding after the first surface mount

Keep the long-lived Canvas approach, but do not leave a closed game as the
active hidden binding while another owner disposes it.

When closing, publish an explicit neutral/home slot (for example, a stable
shell-owned idle session and neutral renderer) and hide the game surface. The
closed game becomes a retirement candidate. Once the neutral binding has
committed, the closed session can be safely disposed.

It is acceptable to avoid mounting the game surface until the first game is
opened. After that point the surface should remain mounted and use the neutral
slot on Home.

### 5. Retirement requires acknowledgment, not elapsed time

Do not treat `setTimeout(..., 0)` as the correctness boundary. Introduce an
explicit post-commit acknowledgment associated with the binding generation.

The required ordering is:

1. Pause the retiring session and stop/cancel its active input ownership.
2. Publish the replacement slot as one immutable value.
3. Render `GameView`, renderer, content, assets, and pointer from that one slot.
4. Acknowledge that generation after React has committed the replacement.
5. Dispose only retirement records whose last bound generation is older than
   the acknowledged generation.
6. Make disposal idempotent and remove disposed entries from ownership.

The acknowledgment can be implemented through a small mounted binding
component/effect or a controller event. The important rule is that the same
generation rendered by all consumers is the generation being acknowledged.

### 6. Surface consumers bind atomically

For every render, derive all of the following from one `SurfaceSlot` value:

- `GameView.game`;
- `GameView.renderer`;
- `GameView.assets`;
- `GameView.presentationKey`;
- content component and `content.game`;
- pointer presence/enabled state;
- `GamePointerInput.game`; and
- the pointer binding key.

Never derive one consumer from `sessionBundle`, another from `slot`, and a
third from `runSurface` without first publishing a single effective slot.

`presentationKey` and pointer identity must use the unique binding generation,
not `gameId`, `String(game)`, or a counter that restarts per game.

### 7. Asynchronous publishers must prove they are current

Asset readiness, retry, errors, and Performance Lab attach/detach events can
arrive after navigation has moved on. Each event must carry the request id it
belongs to. The reducer/controller must ignore and clean up stale results.

A stale ready asset lease must be released exactly once. It must never create
a gameplay session or replace the current slot.

Callbacks passed into content should capture the relevant request/generation
and become no-ops when that identity is no longer current.

### 8. The disposed-state exception stays strict

Do not fix this by catching or suppressing `This GameSession has been disposed`,
adding more `session.status` checks to every UI callback, or changing core
session methods to ignore invalid calls.

The correct fix is to make it impossible for a disposed session to remain in
an active slot. In development, add a shell-level invariant that fails close to
the binding site if a ready surface attempts to publish a disposed session.

### 9. The header is structurally outside the gameplay hit surface

Split Brick Breaker content into two sibling layout regions:

```text
safe-area screen
  -> top bar (back + centered title)
  -> gameplay stage (HUD + full-stage start/restart surface)
```

The start surface may use absolute fill only inside the gameplay stage. The
header must not depend on `zIndex` to defeat a full-screen gameplay overlay.
This preserves “tap anywhere to start” for the game body while making the
header a separate interaction boundary.

---

## Implementation tasks

### T8.0 — Capture the regressions with RED tests

- [x] Add a same-game close/reopen lifecycle test that fails on the current
      production transition logic (`surfaceSlot.test.ts` + `surfaceController
      .test.ts` drive the production reducer/controller).
- [x] Add a mounted shell/controller test showing that a fresh session is
      created, selected, and bound on each same-id open.
- [x] Assert that the old session remains alive until the replacement/neutral
      binding is acknowledged, then is disposed exactly once.
- [x] Assert that `GameView`, content, and pointer all receive the same session
      and generation before and after reopening (`effectiveBinding`).
- [x] Add a structural interaction test proving the Brick Breaker start
      surface is contained by a gameplay-stage ancestor and the back control
      is outside that ancestor (`brickBreakerLayout.test.ts` — the screen
      renders from the same contract).
- [x] Add a behaviour test proving back-before-start calls `onExit` and does not
      pulse the `start` action (layout contract + native acceptance: the
      back-before-start Maestro flow returns Home on the first press).

#### Approach

Start from a deterministic fake `GameSession` that records `start`, `pause`,
input, and `dispose` calls. Inject the session factory and binding
acknowledgment scheduler into the shell controller seam; do not use real timers
as the only assertion mechanism.

The pure state-machine tests must import the same reducer/transition helpers
that `PlaygroundShell` imports. A test that manually calls a constructor the
production component does not use is insufficient.

React Native test renderers do not perform native z-order hit testing. Pair the
headless structural/handler test with the native acceptance check in T8.7. Do
not claim a synthetic `fireEvent.press` alone proves that overlays do not steal
touches.

#### RED evidence required

Before implementation, record failures demonstrating:

- same-id open retains session A instead of binding session B;
- session A can be disposed while it remains the selected binding;
- the start surface is rooted at the full safe-area screen; and
- back-before-start can be intercepted by the gameplay overlay on native.

### T8.1 — Repair Brick Breaker's interaction layout

- [x] Add an explicit gameplay-stage container below the safe-area top bar.
- [x] Move score, prompt, and start/restart surface into the stage.
- [x] Limit the absolute start surface to the stage bounds.
- [x] Keep the back button and centered game title in the separate top bar.
- [x] Preserve safe-area spacing and the current back-button hit slop.
- [x] Preserve a full-stage tap target for start/restart.
- [x] Ensure HUD views remain non-interactive unless they contain a real
      control.
- [x] Add stable test ids for the top bar, back control, stage, and start
      surface (`brick-breaker-top-bar`, `brick-breaker-back`,
      `brick-breaker-stage`, `brick-breaker-start-surface`).

#### Do not

- Do not solve this only by increasing the back button's `zIndex`.
- Do not shrink the start target to the prompt text.
- Do not make the title or safe-area inset start the game.
- Do not route the back button through gameplay input.

#### Done when

- Back works before play, during play, at game over, and after reopening.
- Tapping anywhere below the header in a start/restart state starts the game.
- Tapping the back button never pulses the semantic `start` action.

### T8.2 — Introduce open-request and binding identities

- [x] Allocate a monotonically increasing `requestId` at every explicit
      `handleOpenGame` event (`SurfaceController.open`).
- [x] Allocate a monotonically increasing surface generation for every
      published neutral, loading, ready, or run-session binding.
- [x] Add both identities to the canonical surface state where appropriate.
- [x] Replace all game-id-only equality checks used to decide whether a
      surface should rebind.
- [x] Ensure reopening the same game produces a distinct request and binding.
- [x] Ensure asset loading-to-ready remains within the correct request while
      publishing a new binding generation.
- [x] Ensure late events are compared against request identity before they can
      mutate active state (stale readiness/run events are ignored).

#### Identity rules

| Value | Meaning | May repeat? |
| --- | --- | --- |
| `gameId` | Catalog/game type | Yes |
| `requestId` | One user open action | No during shell lifetime |
| `generation` | One concrete bound surface | No during surface lifetime |
| frame revision | One session's simulation commit | Yes across sessions |

Do not derive one identity from another.

### T8.3 — Consolidate the canonical surface state machine

- [x] Move the actual production `SurfaceSlot` type and transitions into one
      focused shell module (`surfaceSlot.ts`; the shell-local lookalike was
      deleted).
- [x] Remove the duplicate interface and duplicate slot constructors from
      `PlaygroundShell.tsx`.
- [x] Represent neutral/home, loading, and ready states explicitly rather than
      calling every initial non-asset slot “loading.”
- [x] Define pure events/transitions for open, close, asset-ready,
      run-session attach/detach, binding-committed, and shell-unmount (asset
      failure/retry is display state owned by the hook, not a slot
      transition).
- [x] Keep state transitions immutable.
- [x] Centralize exactly-once retirement bookkeeping (stamped retirement
      records drained only by `binding-committed`).
- [x] Make invalid transitions visible in development with useful request and
      generation context (`effectiveBinding` throws with request/generation
      on a disposed ready binding).

#### Recommended state-machine events

The exact names may change, but the semantics should be testable:

```text
OPEN(gameId, requestId)
PUBLISH_LOADING(requestId, generation, neutral binding)
PUBLISH_READY(requestId, generation, complete binding)
CLOSE(requestId, neutralGeneration)
ASSET_READY(requestId, lease)
ASSET_FAILED(requestId, error)
RUN_ATTACHED(requestId, attachment)
RUN_DETACHED(requestId, attachmentId)
BINDING_COMMITTED(generation)
UNMOUNT
```

Opening a non-asset game should normally publish its complete ready slot in the
same event boundary. Opening an asset-backed game publishes loading/neutral,
then a complete ready slot only if its readiness event still matches the
active request.

### T8.4 — Make the surface controller the single lifecycle owner

- [x] Remove `sessionBundle` and `retiringBaseSessionsRef` as competing
      ownership paths (deleted).
- [x] Make explicit navigation create a request; let the controller own session
      construction and retirement for that request.
- [x] On close, pause/cancel the active game and publish the neutral/home
      binding before disposal.
- [x] Render every active consumer from the canonical effective slot.
- [x] Add a binding-commit acknowledgment and retire only acknowledged-old
      sessions/resources (the surface's post-commit effect acknowledges the
      rendered generation).
- [x] Dispose each owned session exactly once on final shell unmount.
- [x] Ensure rapid opens combine retirement records without losing or
      double-disposing them.
- [x] Keep session/resource objects in the shell owner, not in Zustand.

#### Input teardown

Before retiring a live game, cancel or finalize pointer ownership so a native
gesture cannot continue forwarding to the retired session. Disable/rebind the
pointer as part of the same new slot generation. Do not wait for a later HUD
render to update pointer ownership.

#### Development invariant

At the active binding boundary, verify in development that:

```text
slot.session.status !== 'disposed'
GameView.game === Content.game === GamePointerInput.game
presentationKey === pointer binding generation === slot.generation
```

The equality checks are conceptual; implement them without adding expensive
per-frame work.

### T8.5 — Preserve asset and Performance Lab ownership

- [x] Tag every Sprite Field asset controller event with its request id (the
      controller is keyed by the request id and the callbacks carry it).
- [x] Ignore and release readiness from superseded requests.
- [x] Keep the asset lease alive until the renderer that borrows it has been
      replaced and that replacement generation is acknowledged (the
      controller stays mounted for the whole request lifetime, including
      ready).
- [x] Never pair a ready asset lease with the neutral session.
- [x] Never create the Sprite Field gameplay session for a stale request.
- [x] Fold Performance Lab run attachments into the canonical effective slot
      instead of bypassing parts of it with a separate rendered session
      (`slot.run`; `effectiveBinding` binds the run session).
- [x] Ensure Lab detach/close cannot dispose a run session still bound to
      `GameView` or pointer input (retirement requires the commit).
- [x] Preserve the persistent Canvas and existing no-stale-frame guarantee for
      different-game and asset-ready swaps.

#### Required scenarios

- Close Sprite Field while loading, then reopen it.
- Close Sprite Field after ready, then reopen it.
- Open Sprite Field, immediately open another game, then receive late asset
  readiness.
- Attach a Performance Lab run, close while it is running, then reopen Lab.
- Replace one Lab run with another before the previous retirement acknowledgment.

Every stale resource must be released exactly once, and no stale publisher may
replace the current slot.

### T8.6 — Bind presentation, content, and pointer atomically

- [x] Pass the active slot's unique generation to `GameView.presentationKey`.
- [x] Key/rebind pointer input with that same generation.
- [x] Pass the slot's exact session to content.
- [x] Pass renderer and assets from the same slot.
- [x] Reset presentation alpha/frame state when the generation changes.
- [x] Reject stale callbacks whose captured request/generation is no longer
      current.
- [x] Review the library fallback `presentationKey ?? String(game)`; either
      provide a safe per-session fallback identity or require/document an
      explicit key for replaceable sessions. Object stringification must not
      be considered safe identity. (Replaced with a WeakMap-allocated stable
      per-session id — same object → same id, new session → new id.)

Do not key/remount the outer persistent Canvas. The keyed boundary should be
the per-binding presentation/pointer layer that must reset for a new session.

### T8.7 — Clean up diagnostics and obsolete paths

- [x] Remove temporary `[rf-controller]` console logging (and the T8
      diagnostics used during simulator verification).
- [x] Remove helpers, refs, comments, and imports belonging to the superseded
      dual-owner model (`runSurfaceState.ts` + test deleted; `sessionBundle`
      /`retiringBaseSessionsRef` deleted).
- [x] Review the older Brick Breaker screen implementation and remove or
      clearly isolate it if it is no longer reachable. Do not keep two layout
      implementations that can drift silently. (`BrickBreakerGameScreen.tsx`,
      `BootstrapGameScreen.tsx`, `PlaygroundGameScreenProps.ts` deleted —
      unreachable since Task 7.)
- [x] Update shell ownership comments to describe request identity,
      acknowledgment, and exactly-once retirement accurately.
- [x] Document the lifecycle invariant in the relevant playground/agent
      workflow documentation if agents are expected to add more games.
      (Surface ownership contract added to `gamekit-workflow.md`.)
- [x] Run `git diff --check` and confirm Task 8 changes do not include unrelated
      user files.

### T8.8 — Complete automated and native validation

- [x] Run focused RED/GREEN tests during implementation.
- [x] Run the playground lint and typecheck gates.
- [x] Run the package and playground test suites (246 package tests + 107
      playground tests pass).
- [x] Run the repository coverage gate and preserve the required thresholds.
- [x] Run the package build, tarball/headless import checks, docs build, and
      Expo export used by the existing delivery gate.
- [x] Validate the complete interaction matrix on an iOS simulator (BB
      back-before-start, play/back, reopen freshness; SF close-while-loading,
      ready, reopen cycles; lab attach/close/reopen; rapid open/close ×6 —
      all green, zero redboxes).
- [ ] Validate on a physical iPhone and iPad when hardware is available —
      **device-gated**.
- [ ] Validate Android hardware back and touch interaction on an Android
      device or emulator — **device-gated**.

#### Automated navigation matrix

At minimum, cover:

| Flow | Expected result |
| --- | --- |
| Home -> Brick Breaker -> back before start | Home; no start pulse |
| Home -> Brick Breaker -> play -> back | Home; old game paused and later disposed |
| Brick Breaker -> Home -> Brick Breaker | Fresh ready frame and fresh session |
| Same game reopened repeatedly | New request/generation every time; no crash |
| Game A -> Home -> Game B | Correct renderer/content/pointer/session tuple |
| Rapid A -> B -> A | Latest request wins; superseded sessions dispose once |
| Sprite Field close while loading | Late readiness ignored/released |
| Sprite Field close after ready -> reopen | Fresh assets/session binding; no stale frame |
| Performance Lab attach -> close -> reopen | No disposed run session remains bound |
| Shell unmount with active + retiring sessions | All owned sessions dispose exactly once |

#### Native interaction matrix

For Brick Breaker, test each state separately:

- ready/start prompt;
- actively playing;
- paused/backgrounded and foregrounded;
- game over/restart prompt; and
- reopened after returning Home.

In every state:

- the back control responds on the first press;
- the title/header cannot start or move the game;
- the gameplay stage receives intended taps/drags;
- no old frame appears after a new open request; and
- no disposed-session error or native freeze occurs.

Perform at least 50 close/reopen cycles on physical hardware for the lifecycle
leak gate. Record created, active, retired, and disposed session counts so the
result is evidence, not only “no visible crash.”

---

## Tests that must exist before completion

### Pure state-machine tests

- Same game id with a new request id publishes a new session and generation.
- Different game id publishes a coherent new slot.
- Close publishes neutral before the old session becomes disposable.
- Retirement is empty before acknowledgment and eligible after acknowledgment.
- Repeated acknowledgment is idempotent.
- Rapid replacements retain all sessions until safe and dispose each once.
- Stale asset ready/error/retry events cannot replace the current request.
- Stale Performance Lab events cannot replace the current request.
- Generation never resets or collides within one controller lifetime.

### Mounted integration tests

- Production shell/controller transitions use the canonical reducer.
- `GameView`, content, and pointer observe one coherent slot.
- Reopening Brick Breaker selects the new session on the first render of the
  reopened game.
- The prior session is not disposed while any mounted consumer still receives
  it.
- Closing publishes neutral, acknowledges it, then disposes the game.
- Brick Breaker back-before-start exits without invoking start input.
- Unmount disposes active, neutral-owned, pending, and retiring resources
  according to their ownership policy.

### Native smoke tests

- Actual z-order hit testing does not let the stage overlay intercept back.
- RNGH input binds to the new generation after reopen.
- A drag cannot continue into a retired session.
- Background/foreground around close/reopen does not resume a disposed session.

---

## Fixes that are specifically rejected

1. **Only compare `game !== slot.session`.** This may mask the immediate
   same-id bug but leaves split ownership, asset-ready replacement, and run
   attachments unsafe.
2. **Catch the disposed-session exception.** The invalid binding would remain,
   producing stale frames and silent input loss.
3. **Never dispose sessions.** This converts the crash into an unbounded native
   resource and listener leak.
4. **Increase the disposal timeout.** A longer delay is still not a binding
   acknowledgment and will fail under different scheduling.
5. **Key the whole `GameSurface` or Canvas by game id.** Same-id reopen still
   collides, and full remounting discards the persistent-surface goal.
6. **Use `String(game)` as identity.** Ordinary objects stringify to the same
   value and do not express lifecycle generation.
7. **Put only a `zIndex` on the back button.** This leaves an incorrectly scoped
   full-screen gameplay hit target and is fragile across platforms.
8. **Add status guards everywhere.** Guards are defensive but do not restore a
   coherent session/renderer/content/pointer binding.

---

## Recommended execution order

1. T8.0: create the failing feedback loop and record RED evidence.
2. T8.1: fix and validate the independent Brick Breaker interaction boundary.
3. T8.2–T8.3: establish request/generation identity and the canonical state
   machine.
4. T8.4: replace dual ownership with the single controller and acknowledgment
   retirement path.
5. T8.5–T8.6: integrate assets, Lab attachments, presentation, and pointer
   binding through the same slot.
6. T8.7: remove superseded paths and temporary diagnostics.
7. T8.8: run the complete automated and native matrix.

Keep commits attributable and reviewable. A useful split is:

```text
test: reproduce same-game reopen and header interception
fix: constrain brick breaker start input to the gameplay stage
refactor: add canonical playground surface request state
fix: retire sessions after acknowledged surface replacement
fix: make asset and lab publishers request-aware
test: cover repeated navigation and resource retirement
docs: record playground surface ownership contract
```

---

## Completion criteria

Task 8 is complete only when all of the following are true:

- [ ] Pressing back before Brick Breaker starts returns Home on the first press.
- [ ] The back press does not start or otherwise mutate the game.
- [ ] Reopening the same game always creates and presents a fresh session.
- [ ] A reopened game never shows the previous session's final frame.
- [ ] No disposed session can be bound to `GameView`, content, or pointer input.
- [ ] Session/resource ownership has one authoritative controller.
- [ ] Disposal occurs only after the replacement/neutral generation commits.
- [ ] Disposal is exactly once across normal, rapid, stale-async, and unmount
      paths.
- [ ] Sprite Field and Performance Lab retain their Task 7 behaviour.
- [ ] The persistent Canvas remains mounted after first use.
- [ ] Automated gates pass.
- [ ] Simulator interaction matrix passes.
- [ ] Physical-device lifecycle/leak matrix is completed or remains honestly
      marked device-gated with the exact unchecked rows.

Do not mark this task complete merely because the reported crash is no longer
visible in one manual run. The ownership tests and repeated close/reopen matrix
are the proof that the stale binding has been removed rather than hidden.
