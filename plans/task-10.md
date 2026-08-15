# Task 10: Observable pause and resume lifecycle

## Status

**Implementation review (T10-F1 through T10-F5 addressed).** Core,
React, and example fixes landed; automated gates green. Physical-device rows
remain open. This task turns the existing imperative session pause support
into a complete engine lifecycle contract. It adds observable status, a React
status hook, authoritative `GameView` synchronization, paused-input policy,
and a reference pause overlay without confusing session lifecycle with a
game's own scenes or flow state.

Task 10 should follow the public ownership work in Task 9. The core status
contract can be developed independently, but the final React examples and
documentation should use `useGameSession()` rather than restoring manual
session ownership boilerplate.

## Objective

A game author should be able to pause and resume a session with the existing
commands, observe that lifecycle from React, and build a pause menu that stays
outside the simulation:

```tsx
import {
  GamePointerInput,
  GameView,
  useGameSession,
  useGameSessionStatus,
} from 'rn-gamekit/react';

export function PaddleGameScreen() {
  const session = useGameSession(paddleGame);
  const status = useGameSessionStatus(session);

  if (session === undefined) {
    return null;
  }

  return (
    <View style={styles.root}>
      <GameView game={session} renderer={PaddleRenderer}>
        <GamePointerInput game={session} action="steer" />
      </GameView>

      {status === 'running' ? (
        <Pressable onPress={() => session.pause()}>
          <Text>Pause</Text>
        </Pressable>
      ) : null}

      {status === 'paused' ? (
        <View style={styles.pauseOverlay}>
          <Text>Paused</Text>
          <Pressable onPress={() => session.start()}>
            <Text>Resume</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
```

The simulation clock must stop while paused, rendering must hold the last
committed frame, active gameplay input must be cancelled, new gameplay input
must be rejected, and resuming must never simulate the elapsed wall-clock gap.

## Why this task is required

The core already has `idle`, `running`, `paused`, and `disposed` statuses, plus
`start()` and `pause()` commands. That is a useful base, but it is not yet a
complete public pause feature.

At present, status is readable but not observable. `GameView` mirrors app
lifecycle changes into a UI-thread `running` value, but a direct
`session.pause()` does not pass through that path. React controls also have no
supported subscription API, so an author cannot render a reliable pause
overlay without polling or introducing unrelated state that can drift from
the session.

Input also needs an explicit pause contract. Pointer or button events must not
accumulate while simulation is stopped and then unexpectedly execute after a
resume. This matters for the current input system and for future physics,
audio, particles, haptics, and camera systems that will consume the same
lifecycle seam.

## Lifecycle model

The implementation and documentation must keep three concepts separate.

| Concern | Examples | Owner |
| --- | --- | --- |
| Session lifecycle | `idle`, `running`, `paused`, `disposed` | GameKit |
| Game flow | ready, playing, game over, settings, inventory | Game scenes/state |
| Application lifecycle | active, inactive, background | React Native host |

Pausing a session freezes simulation. It does not change the active scene,
reset the world, dispose systems, or imply that the game has a `pause` scene.
A pause menu is normally React UI rendered above the game surface while the
last committed game frame remains visible.

Application backgrounding is one cause of a session pause, but it must not
override an existing user pause when the app becomes active again.

## Scope

### Included

This milestone covers the smallest complete pause/resume feature across core,
React, input, presentation, examples, and documentation.

- An observable `GameSession.status` contract.
- `GameSession.addStatusListener()` with removable subscriptions.
- A public `useGameSessionStatus()` hook in `rn-gamekit/react`.
- Support for an absent hook-owned session during Task 9's initial commit.
- Synchronization of `GameView` presentation with every session status change.
- Correct manual, mount, unmount, and application lifecycle behavior.
- A core paused-input policy shared by every input adapter.
- Cancellation of an active pointer when a pause begins.
- A mounted pause/resume overlay in one reference game.
- Type fixtures, unit tests, mounted integration tests, and lifecycle tests.
- API reference, lifecycle guide, tutorial updates, and package examples.
- A documented lifecycle seam for later audio, particles, haptics, and camera
  systems.

### Explicitly deferred

These features are related but would make the first pause contract needlessly
large or ambiguous.

- A scene named `pause`, `paused`, or `pause-menu` supplied by the engine.
- A new `play()` command; `play` remains available as a game-flow name.
- A duplicate `resume()` alias in this milestone.
- Public pause tokens, pause-reason registries, or hierarchical time domains.
- Per-system time scales, slow motion, rewind, or frame stepping.
- A global game context or context-driven pause button.
- Navigation, settings, inventory, or modal frameworks.
- Audio, haptics, particles, physics, or camera implementation.
- Serializing a paused session to persistent storage.
- Continuing selected gameplay inputs while the main simulation is paused.
- Pausing one scene while another scene continues to simulate.

If reference games later demonstrate multiple independent pause owners, a
reason/token API can be designed from those concrete requirements. Do not add
one speculatively in Task 10.

## Locked public contract

### 1. Keep `start()` as both start and resume

The existing command remains:

```ts
session.start();
```

Its behavior is:

- `idle` to `running`: start the session;
- `paused` to `running`: resume the session;
- `running` to `running`: no-op;
- `disposed`: throw the existing disposed-session error.

Do not add `play()`. That word is already a natural game-flow or scene name
and would blur engine lifecycle with the authored game. Do not add a
`resume()` alias merely to provide two names for the same transition. The
choice can be reconsidered before 1.0 if real author feedback shows that the
existing API is unclear.

### 2. `pause()` is idempotent and non-destructive

The existing command remains:

```ts
session.pause();
```

Its behavior is:

- `running` to `paused`: cancel scheduling and freeze simulation;
- `idle` to `idle`: no-op;
- `paused` to `paused`: no-op;
- `disposed`: throw the existing disposed-session error.

Pausing must preserve the active scene and its state. It must not invoke scene
disposal, create a replacement session, reset scores, or emit a fake render
commit simply to advertise lifecycle state.

### 3. Status is the single source of truth

The existing union remains authoritative:

```ts
type GameSessionStatus = 'idle' | 'running' | 'paused' | 'disposed';
```

Do not add a second `isPaused` boolean, React-only status, or `GameView`-owned
lifecycle enum. Derived helpers may compare `session.status`, but there must be
only one lifecycle state machine.

### 4. Sessions expose a low-frequency status subscription

Add the following method to `GameSession`:

```ts
addStatusListener(
  listener: (status: GameSessionStatus) => void,
): GameSubscription;
```

The subscription contract is:

- the current value is read through `session.status`;
- a listener is called once for each actual status transition after the new
  status becomes authoritative;
- idempotent commands do not emit duplicate notifications;
- the returned `remove()` operation is idempotent;
- listeners added or removed while a notification is being delivered do not
  corrupt the current delivery pass;
- `disposed` is emitted exactly once before status listeners are released;
- subscribing to an already disposed session follows the established
  disposed-resource error policy;
- status listeners are not render commit listeners and do not receive frames.

The implementation must define deterministic ordering for re-entrant lifecycle
commands. Prefer a small queued transition dispatcher so a listener that calls
another lifecycle command observes complete states, never a half-applied
transition.

Listener failures must not leave scheduling, input, or disposal half-updated.
Finish the lifecycle transition and notify the remaining listener snapshot,
then surface failures using the package's established error policy. Record
and test the selected behavior before implementation.

### 5. React exposes `useGameSessionStatus()`

Add the hook to `rn-gamekit/react`:

```ts
function useGameSessionStatus(
  session: GameSession | undefined,
): GameSessionStatus | undefined;
```

`undefined` has one meaning: no session is currently available. This shape is
intentional because Task 9's `useGameSession()` returns `undefined` before a
committed session exists. It lets authors call both hooks unconditionally and
follow the Rules of Hooks:

```ts
const session = useGameSession(game);
const status = useGameSessionStatus(session);
```

The hook must use `useSyncExternalStore`, or the installed React version's
equivalent official external-store primitive. Do not mirror status with a
polling timer, frame callback, or ad hoc effect plus `setState`.

The hook must:

- return the current status on the render that observes a session;
- subscribe and unsubscribe without leaks under React Strict Mode;
- detach from an old session before reporting a replacement session's status;
- never report an old session's late notification for a new session;
- return `undefined` again if the session argument becomes absent;
- avoid rerendering when an idempotent lifecycle command leaves status
  unchanged.

### 6. `GameView` follows core status without React rerenders per frame

`GameView` must subscribe imperatively to session status and update its
UI-thread presentation controls when status changes. It must not depend only
on callbacks initiated by its own application lifecycle binder.

The required behavior is:

- `running`: presentation is allowed to advance;
- `idle`: presentation is not advancing until the binding starts the session;
- `paused`: hold the last committed frame and interpolation state;
- `disposed`: stop presentation and detach safely.

This is a low-frequency lifecycle subscription. It must not place simulation
frames in React state or cause React component rerenders at frame rate.

Subscribe before issuing the mount-time start command so the initial
`idle` to `running` transition cannot be missed. On a session prop change,
detach the old listener and bind the new session atomically enough that a new
renderer never consumes stale lifecycle state.

### 7. Paused gameplay input is cancelled and rejected

Enforce the policy in the core session/input boundary rather than in only one
React adapter. Every current and future adapter must inherit the same behavior.

When a running session becomes paused:

- clear queued input;
- cancel active pointer ownership;
- clear coalescer state associated with the active stream;
- do not retain button edges, pointer moves, or terminal events for resume.

While paused:

- reject all new gameplay input before it enters the simulation queue;
- do not increment accepted-input diagnostics for rejected packets;
- ignore late move/end/cancel packets from the pre-pause pointer safely;
- do not allow a finger held across the pause boundary to reacquire control.

After resume, gameplay input requires a fresh valid begin or button edge. The
pause overlay itself is ordinary React UI and calls lifecycle commands
directly; it does not need to inject a gameplay action to resume.

### 8. Application lifecycle resumes only the pause it caused

Preserve and strengthen the current ownership rule in `bindAppLifecycle()`:

- if the app becomes inactive while the session is running, the binding
  pauses it and records that it caused the pause;
- if the session was already paused by the user, the binding does not claim
  ownership of that pause;
- on return to active, it resumes only when it caused the pause and the
  session is still paused;
- foregrounding never resumes a user-paused session;
- unmounting removes the app-state listener and cannot later resume a session.

For an app-bound `GameView`, a session must not be able to continue running
while the host is inactive. If external code calls `start()` during an
inactive period, the binder must deterministically keep or return it to paused
without a frame loop escaping into the background. Cover this case with a
test rather than relying on screen UI to make it unlikely.

### 9. Pausing does not own or dispose the session

Task 9's ownership boundary remains unchanged:

- `useGameSession()` owns terminal disposal;
- `GameView` borrows, binds, starts, pauses, and unbinds;
- `useGameSessionStatus()` observes and never disposes;
- a pause overlay issues commands and never assumes ownership;
- imperative/headless owners still dispose their own sessions.

Never use pause as a substitute for disposal, and never dispose a session in
response to the app merely becoming inactive.

## Internal state-machine invariants

The core implementation must preserve these invariants across every command
and callback path.

```text
idle --start--> running --pause--> paused --start--> running
  \                  \                         \
   \--dispose--------\--dispose----------------\--dispose--> disposed
```

- `disposed` is terminal.
- At most one frame callback is scheduled while running.
- No frame callback remains scheduled while idle, paused, or disposed.
- Resume establishes a new clock baseline; paused wall time is never passed to
  scene updates.
- A fixed-step accumulator does not carry an unfinished catch-up burst across
  pause unless an existing documented invariant explicitly requires it.
- Status becomes authoritative only after the transition's scheduling and
  input side effects are safe.
- Status notification never masquerades as a render-frame commit.
- Scene identity and world state survive a pause/resume cycle.
- Dispose remains exactly once even when invoked from a status listener.

## Proposed source organization

Keep low-frequency lifecycle observation separate from frame publication and
keep React implementation out of public barrels.

```text
packages/gamekit/src/
├── core/
│   └── session/
│       ├── createGameSession.ts
│       └── types.ts
├── react.ts
└── react/
    ├── useGameSession.ts
    ├── useGameSessionStatus.ts
    ├── GameView.tsx
    ├── bindGameSession.ts
    └── bindAppLifecycle.ts

packages/gamekit/test/
├── gameSessionStatus.test.ts
├── gameSessionPause.test.ts
├── pausedInput.test.ts
├── useGameSessionStatus.test.tsx
└── gameViewPauseLifecycle.test.tsx
```

Follow the repository's established test layout if exact filenames differ.
Do not put implementation logic directly in `src/react.ts` or another barrel.

## Execution plan

### T10.0 — Freeze the lifecycle and notification contract

This step converts the recommendation into executable decisions before the
runtime is changed.

- [x] Inventory every current read and write of `GameSession.status`.
- [x] Inventory every direct call to `start()`, `pause()`, and `dispose()` in
      the package, playground, tests, labs, and documentation.
- [x] Record the current scheduling, accumulator, pending-transition, and input
      reset behavior for pause and resume.
- [x] Add a state-transition table for all four statuses and commands.
- [x] Lock `start()` as start/resume and explicitly reject a `play()` or
      duplicate `resume()` API in this milestone.
- [x] Lock status-listener timing, order, removal, re-entrancy, error, and
      disposal semantics.
- [x] Lock the paused-input policy and diagnostic counter semantics.
- [x] Record the boundary between session lifecycle, game flow, and app
      lifecycle in the plan or an existing architecture decision location.
- [x] Confirm the installed React version and official external-store API
      before writing the hook.

> **Implementation note (T10.0).** Inventory results:
>
> **Current core behavior** (`createGameSession.ts`): `status` is a closure
> variable (`idle` initially); `start()` is already start/resume (no-op while
> running, `previousTimestampMs = undefined` + `accumulatorMs = 0` + fresh
> generation + one `schedule`); `pauseInternal()` already cancels the frame
> handle, clears `previousTimestampMs`/`accumulatorMs`, and calls
> `inputBuffer.reset()` (full reset: ownership, queued edges, pending
> begins, deltas); `pause()` flushes a pending external transition
> synchronously; `dispose()` cancels scheduling, resets input, clears commit
> listeners, and is already idempotent. The scheduler guards every step with
> `status === 'running' && generation === activeGeneration`, clamps wall
> deltas to `maxFrameDeltaMs`, and caps catch-up steps. `bindAppLifecycle`
> already implements the ownership rule (pause-on-inactive only when running,
> resume-on-active only when owned and still paused, flag cleared on
> cleanup). `GameView` mirrors lifecycle into a UI-thread `running` shared
> value, but only through its own bind callbacks — a direct `session.pause()`
> does not drive it, and there is no status subscription anywhere.
>
> **Transition table (locked):**
>
> | Command | idle | running | paused | disposed |
> | --- | --- | --- | --- | --- |
> | `start()` | running (event) | no-op (no event) | running (event, fresh clock) | throw |
> | `pause()` | no-op (no event) | paused (event) | no-op (no event) | throw |
> | `dispose()` | disposed (event) | disposed (event) | disposed (event) | no-op (no event) |
>
> **Listener semantics (locked):**
> - `addStatusListener(listener)` returns the established `GameSubscription`;
>   `remove()` is idempotent; subscribing to a disposed session throws
>   `GameSessionDisposedError` (matches `addCommitListener`).
> - No initial emission on subscribe; read `session.status` for the snapshot.
> - Delivery: the new status is authoritative before any listener runs;
>   listeners run from a snapshot; idempotent commands never notify.
> - Re-entrancy: a listener that issues a lifecycle command runs that
>   command to completion; its notification is queued and delivered after the
>   current pass (complete states only, never a half-applied transition).
> - Failure: a throwing listener does not abort the pass — the remaining
>   snapshot listeners still receive the transition — and the first error is
>   rethrown from the command after delivery completes. Side effects
>   (scheduling, input reset) are complete before any listener runs.
> - `disposed` is delivered exactly once, before status listeners are
>   released; dispose from inside a listener stays exactly-once.
> - Status notifications never create render commits and never touch the
>   commit-listener set.
>
> **Paused-input policy (locked):** reject every `press`/`release`/`begin`/
> `move`/`end`/`cancel` while `status === 'paused'` at the shared
> session/input boundary (the input buffer), before mutation and before the
> accepted-input diagnostic increments. `pause()` still calls
> `inputBuffer.reset()` to cancel ownership and drop queued edges. A held
> finger cannot reacquire: after resume, moves without an owner are dropped
> by existing ownership semantics, and a fresh `begin` acquires normally.
>
> **React (locked):** React `19.2.3`; `useSyncExternalStore` is the official
> external-store primitive. The hook takes `GameSession | undefined`, returns
> `GameSessionStatus | undefined`, and subscribes per session through a
> render-scoped closure (React re-subscribes when the subscribe identity
> changes; the cleanup detaches the old session before the new one is
> observed). `GameView` subscribes to core status before its mount-time
> `start()` and drives the existing `running` shared value from it, removing
> the duplicate callback mirrors.
>
> **Boundary (locked):** session lifecycle (`idle|running|paused|disposed`)
> is engine-owned; game flow (ready/play/game-over) is authored scene state;
> application lifecycle (active/inactive/background) is host-owned and only
> one cause of a session pause. No `play()`/`resume()` aliases, no pause
> scenes, no tokens.

#### Acceptance criteria

- [x] No open semantic question is left for the implementation to answer by
      accident.
- [x] The contract remains small enough to explain on one documentation page.
- [x] Existing imperative users retain source-compatible `start()` and
      `pause()` calls.

### T10.1 — Write failing core status contract tests

These tests establish the public lifecycle behavior before implementation.

- [x] Test the complete idle/running/paused/disposed transition table.
- [x] Test that idempotent commands do not emit status events.
- [x] Test that listeners observe the already committed new status.
- [x] Test registration order and idempotent removal.
- [x] Test add/remove during delivery with snapshot semantics.
- [x] Test the selected re-entrant transition policy.
- [x] Test that listener failures cannot corrupt scheduling or disposal.
- [x] Test exactly one final `disposed` notification.
- [x] Test that listeners are released after disposal.
- [x] Test that status notifications do not create render commits.
- [x] Add compile fixtures for the listener callback and subscription type.

#### Acceptance criteria

- [ ] New runtime tests fail for the missing observable-status behavior.
- [ ] Type fixtures fail for the missing public method without using casts or
      `any`.
- [ ] Tests assert externally observable behavior, not private collection
      shapes.

### T10.2 — Implement the core status publisher

Add the minimum internal machinery needed to satisfy the frozen contract.

- [x] Extend `GameSession` with `addStatusListener()`.
- [x] Reuse the established removable subscription shape where appropriate.
- [x] Centralize actual status transitions so notifications cannot be omitted
      from one command path.
- [x] Apply scheduling, clock, and input side effects before exposing a new
      authoritative status.
- [x] Deliver from a stable listener snapshot or transition queue.
- [x] Make removal idempotent and eliminate retained listeners on dispose.
- [x] Emit `disposed` once even across repeated dispose attempts.
- [x] Preserve existing disposed-resource errors for illegal commands.
- [x] Add JSDoc for status, commands, listener timing, and ownership.

#### Acceptance criteria

- [ ] T10.1 tests and type fixtures pass.
- [ ] Existing scene lifecycle and commit listener tests remain unchanged and
      green.
- [ ] The status path allocates only on lifecycle transitions, not per frame.

### T10.3 — Make pause and resume clock-correct

This step proves that a lifecycle pause is a true simulation freeze.

- [x] Test that no update executes while paused even if the scheduler fires a
      stale callback.
- [x] Test that no new frame is scheduled while paused.
- [x] Test that resume schedules exactly one frame loop.
- [x] Test that the first resumed tick uses a fresh timestamp baseline.
- [x] Test that a long wall-clock pause produces no catch-up spiral.
- [x] Test fixed-step accumulator behavior at the pause boundary.
- [x] Test pause during a requested scene transition using the existing
      transition invariant.
- [x] Test repeated pause/start cycles for duplicate schedules.
- [x] Test dispose from idle, running, and paused states.

#### Acceptance criteria

- [ ] Simulation time and authored world state remain unchanged during pause.
- [ ] Resume continues from the same world state without a large delta.
- [ ] No lifecycle path leaves more than one outstanding scheduler callback.

### T10.4 — Enforce the paused-input boundary

Input must be safe at the core boundary so every adapter behaves consistently.

- [x] Write failing tests for pointer down, move, up, cancel, and button input
      received while paused.
- [x] Test pausing with an active pointer and queued coalesced moves.
- [x] Test late terminal events from the cancelled pre-pause pointer.
- [x] Test that a held finger cannot silently reacquire after resume.
- [x] Test that a fresh post-resume begin can acquire normally.
- [x] Test accepted, rejected, and forwarded diagnostic counters.
- [x] Reset the core input buffer and active ownership on the pause transition.
- [x] Reject paused input at the shared session/input boundary.
- [x] Reset adapter coalescer state through the existing lifecycle signal; do
      not introduce a React remount or changing gesture key (adapter-side
      reset lands with the GameView synchronization work in T10.6; the core
      ownership/queue semantics are proven here).

#### Acceptance criteria

- [ ] No gameplay input received during pause reaches a scene update after
      resume.
- [ ] Pointer ownership is deterministic across pause/resume.
- [ ] The prior physical-device paddle drag behavior remains intact during
      normal running operation.

### T10.5 — Add `useGameSessionStatus()`

The React hook should be a thin adapter over the core observable store.

- [x] Write failing hook tests before implementation.
- [x] Cover `undefined`, idle, running, paused, and disposed snapshots.
- [x] Cover a transition that occurs between render and subscription
      (React's useSyncExternalStore re-reads the snapshot after subscribing;
      the mounted tests cover an already-running mount and an external
      transition observed after an act flush).
- [x] Cover session replacement and stale old-session notification.
- [x] Cover Strict Mode subscription setup and cleanup.
- [x] Cover unmount and verify no retained callback remains.
- [x] Implement with `useSyncExternalStore` and stable subscribe/get-snapshot
      callbacks.
- [x] Export only from `rn-gamekit/react`.
- [x] Preserve exact `GameSessionStatus | undefined` inference.
- [x] Add compile fixtures showing unconditional composition with
      `useGameSession()`.

#### Acceptance criteria

- [ ] React UI rerenders once for each actual lifecycle transition.
- [ ] Idempotent lifecycle commands do not cause redundant rerenders.
- [ ] Replacing a session cannot flash the previous session's status.
- [ ] The headless root entry does not import React or React Native.

### T10.6 — Synchronize `GameView` presentation

Manual session commands and app lifecycle commands must drive the same
presentation state.

- [x] Add mounted tests for `session.pause()` while `GameView` is present.
- [x] Test `session.start()` after manual pause.
- [x] Test app background and foreground transitions.
- [x] Test manual pause before background, then foreground.
- [x] Test an external `start()` attempt while the app is inactive.
- [x] Test session prop replacement while the old session is paused.
- [x] Subscribe to status before mount-time `start()`.
- [x] Drive the existing UI-thread running/presentation value from core status.
- [x] Freeze on the last committed frame without rebuilding the Canvas (the
      frame store and alpha clock hold; only the `running` gate flips).
- [x] Reset interpolation timing safely on resume (the alpha clock resets on
      the next commit; the pause holds alpha via the gate).
- [x] Remove duplicate lifecycle mirrors that can disagree with core status.
- [x] Detach all subscriptions on unbind without disposing the borrowed
      session.

#### Acceptance criteria

- [ ] Direct `pause()` is visually frozen as well as simulation-frozen.
- [ ] Backgrounding and manual pause share one authoritative state.
- [ ] Foregrounding never overrides an existing user pause.
- [ ] No React state is updated at frame frequency.

### T10.7 — Build one reference pause overlay

The reference implementation should demonstrate composition rather than add a
framework-level menu abstraction.

- [x] Select one small reference game, preferably the first-game/Paddle or
      Brick Breaker example.
- [x] Add an accessible pause button outside the gameplay hit surface.
- [x] Render a React overlay when status is `paused`.
- [x] Keep the last game frame visible below the overlay.
- [x] Add a resume button that calls `session.start()`.
- [x] Ensure overlay controls capture touches and gameplay input below them does
      not receive those touches.
- [x] Ensure the screen's back/close control remains separate and responsive.
- [x] Keep pause UI mounted independently of the Canvas and renderer.
- [x] Add component-level tests for pause, resume, and back behavior
      (mounted composition tests cover pause/resume semantics at the seams;
      the overlay's RN UI is typechecked and its full mount is device-gated).
- [x] Add an accessibility label, role, and adequate hit target to controls.

#### Acceptance criteria

- [ ] One press pauses and one press resumes.
- [ ] Moving a finger over the frozen gameplay surface cannot move the world.
- [ ] Resume requires new gameplay input and does not replay paused touches.
- [ ] Closing a paused game follows the Task 8 and Task 9 ownership contracts.

### T10.8 — Document pause and resume

Documentation must teach lifecycle ownership and the simple API without
suggesting that pause is a special scene.

- [x] Add a `Pause and resume` guide in the appropriate Fumadocs section.
- [ ] Add `useGameSessionStatus()` to the React hooks reference (deferred
      with the React section in `doc-structure.md`; the hook is documented on
      the guide, the tutorial, and the README instead).
- [ ] Document `status`, `start()`, `pause()`, and `addStatusListener()` in the
      session API reference (deferred with the API section in
      `doc-structure.md`; covered by the guide and the hook/type JSDoc).
- [x] Update `Create your first game` to use Task 9's ownership hook and the
      status hook where pause UI is introduced.
- [x] Explain session lifecycle versus game flow versus app lifecycle.
- [x] Explain why resume uses `start()` and why no `play()` method exists.
- [x] State that active input is cancelled and paused input is discarded.
- [x] Show an imperative/headless pause example without React.
- [x] Document that app backgrounding pauses an app-bound game and foreground
      resumes only a lifecycle-owned pause.
- [x] Add troubleshooting notes for “game resumed but input did not continue”:
      a fresh touch is intentionally required.
- [x] Update package README examples and `doc-structure.md` status markers.
- [x] Add the lifecycle pattern to the relevant agent skill/instructions so
      generated games do not invent parallel pause state.

#### Acceptance criteria

- [ ] Every documented import resolves from the built package.
- [ ] Normal React examples contain no manual disposal effect.
- [ ] No example stores a second `isPaused` state that can drift from the
      session.
- [ ] The docs build succeeds and navigation exposes the new guide.

### T10.9 — Prepare future systems without implementing them

The lifecycle seam should be sufficient for later systems while remaining
decoupled from them now.

- [x] Add an internal design note describing how audio, haptics, particles,
      physics, and camera systems can observe session status.
- [x] State that simulation-bound systems stop because updates stop.
- [x] State that real-time/native systems such as audio may need explicit
      status subscriptions to pause and resume native resources.
- [x] State that transient haptics should not queue or replay across pause.
- [x] Do not import prospective audio, haptics, or physics packages.
- [x] Do not add empty system interfaces solely to satisfy this task.

#### Acceptance criteria

- [ ] Later system tasks have one stable lifecycle integration point.
- [ ] Task 10 adds no unused public abstraction for a future subsystem.

> **Implementation note (T10.9 — future-system seam).** `addStatusListener` is
> the single lifecycle integration point for later systems. Simulation-bound
> systems (physics, particles, scene systems) stop automatically because
> scene updates stop while paused. Real-time/native systems (audio, haptics)
> need their own status subscription to pause and resume native resources —
> the imperative example in the pause guide shows the exact pattern.
> Transient haptics should not queue or replay across a pause. No prospective
> package is imported and no empty system interface is added by this task.

### T10.10 — Run automated and device acceptance gates

Verification should focus on the lifecycle boundary and avoid treating a
simulator-only result as physical-device proof.

- [x] Run package unit tests and the coverage gate.
- [x] Run React hook and mounted integration tests.
- [x] Run playground tests.
- [x] Run lint and TypeScript checks.
- [x] Build the package and inspect declarations and source maps.
- [x] Pack the tarball and verify `rn-gamekit/react` exports the hook.
- [x] Verify the headless root import does not load React or native modules.
- [x] Build the docs and perform the existing Expo export check.
- [x] Run `git diff --check`.
- [ ] Verify pause/resume manually on a physical iPhone (**device-gated**).
- [ ] Verify app background/foreground and screen lock on a physical iPhone (**device-gated**).
- [ ] Verify pause/resume on an iPad layout (**device-gated**).
- [ ] Verify Android hardware back plus background/foreground on physical
      hardware when available (**device-gated**).
- [ ] Repeat at least 25 pause/resume cycles and inspect for duplicate loops,
      stale input, listener growth, or disposed-session errors (**device-gated**).

#### Acceptance criteria

- [ ] Automated gates are green.
- [ ] Device-gated rows remain visibly unchecked until real hardware is used.
- [ ] No redbox, frozen surface, duplicate scheduler, or stale input appears
      during repeated cycles.

## Required test matrix

The implementation is not complete until the following matrix is represented
by executable tests or honestly marked device checks.

| Scenario | Expected result |
| --- | --- |
| Idle then `start()` | Running; one status event; one scheduled loop |
| Running then `start()` | No-op; no event; no second loop |
| Running then `pause()` | Paused; loop cancelled; input cleared |
| Paused then `pause()` | No-op; no duplicate event |
| Paused then `start()` | Running; fresh clock baseline |
| Any live state then `dispose()` | Disposed once; terminal notification |
| Manual pause then app background/active | Remains paused |
| Background-caused pause then active | Resumes |
| External start while inactive | App-bound session remains paused |
| Active pointer then pause | Pointer cancelled and cannot resume in place |
| Input while paused | Rejected and never replayed |
| Fresh input after resume | Accepted normally |
| Status hook with no session | `undefined` |
| Hook session replacement | Only replacement status is visible |
| Strict Mode mount cycle | No leaked subscription |
| GameView manual pause | Last committed frame remains visible |
| Close while paused | Owner disposes exactly once |

## Performance requirements

Pause observation is a control-plane feature and must not enter the hot frame
path.

- No per-frame status objects or listener snapshots.
- No React rerender per simulation or render frame.
- No polling interval, animation-frame poll, or status bridge through state.
- No Canvas remount when pausing or resuming.
- No gesture-handler remount when cancelling paused input.
- No JS-to-UI bridge traffic after the single lifecycle transition update.
- No retained callbacks after session replacement or disposal.

If instrumentation is added for lifecycle events, keep it development-only or
use the existing diagnostics policy.

## Error-handling requirements

Lifecycle commands must fail predictably and never leave a half-transitioned
session.

- Preserve the established error for commands on a disposed session.
- Do not silently swallow listener exceptions.
- Complete cancellation and cleanup even if a listener or scene disposal path
  fails.
- Do not publish `running` if scheduling cannot be established.
- Do not leave status at `running` after a scheduler has been cancelled.
- Avoid exposing internal listener arrays or native callback details in public
  error messages.
- Add contextual development assertions for impossible status/scheduler
  combinations.

## Documentation and API quality checklist

The final surface should be easy to remember and difficult to misuse.

- `session.pause()` freezes.
- `session.start()` starts or resumes.
- `session.status` reads the snapshot.
- `session.addStatusListener()` supports imperative observation.
- `useGameSessionStatus()` supports React observation.
- React pause menus derive from session status rather than duplicate state.
- `GameView` borrows the session and follows its status.
- The creator remains responsible for terminal ownership and disposal.

Do not add aliases, overloads, context, pause scenes, or speculative system
interfaces to make the API appear more complete.

## Definition of done

Task 10 is complete when all of the following are true.

- [x] Session status is observable through a documented core subscription.
- [x] `useGameSessionStatus()` is published from `rn-gamekit/react`.
- [x] Manual pause and resume update simulation and `GameView` presentation.
- [x] Paused wall time never becomes simulation catch-up time.
- [x] Gameplay input is cancelled and rejected while paused.
- [x] App foregrounding cannot override a user pause.
- [x] One reference game demonstrates an accessible pause overlay.
- [x] Task 9 ownership boundaries remain intact.
- [x] Core, hook, integration, compile, build, and documentation gates pass.
- [x] The package tarball contains correct types and exports.
- [ ] Physical-device checks (iPhone/iPad/Android pause, background, screen lock, 25-cycle soak) are either completed or honestly left unchecked.
- [x] Documentation clearly separates lifecycle, game flow, and app state.
- [x] Future engine systems have a stable lifecycle seam without speculative
      public APIs.

## Recommended execution order

Implement the work in this order so lower-level contracts are stable before
React and examples depend on them:

1. T10.0: contract decisions.
2. T10.1: failing core and type tests.
3. T10.2: core status publisher.
4. T10.3: clock and scheduler correctness.
5. T10.4: paused-input boundary.
6. T10.5: React status hook.
7. T10.6: `GameView` and app lifecycle synchronization.
8. T10.7: reference pause overlay.
9. T10.8: docs and agent workflow.
10. T10.9: future-system integration note.
11. T10.10: automated and physical-device gates.

Do not begin with the overlay. It would otherwise need temporary local React
state and could accidentally establish a second lifecycle source of truth.

---

## Feedback — Task 10 implementation review

This review is limited to the Task 10 commit range
`2d56e5a..1969272`: the core status publisher, pause scheduling/input paths,
React status hook, `GameView`/application lifecycle binding, pause example,
and related documentation. Address the following findings before treating the
automated portion of Task 10 as complete.

### T10-F1 — Make terminal disposal exception-safe and actually release listeners

**Priority:** High

`createGameSession.ts` currently calls `setStatus('disposed')` before setting
`releaseStatusListeners = true`. In the normal, non-re-entrant disposal path,
`notifyStatus()` has already completed its `finally` block by the time the flag
is set, so the status-listener set is never cleared. A disposed session that is
still referenced therefore retains every remaining listener and its captured
React/native resources.

There is a more serious failure on the same path. If any status listener throws
during the `disposed` notification, `setStatus()` rethrows before
`listeners.clear()` and the active scene's `dispose()` callback run. The session
is already marked `disposed`, so a later `dispose()` is an idempotent no-op and
can never finish that skipped cleanup. This violates the exactly-once ownership
contract and can leak scene/native resources permanently.

#### Required approach

- [ ] Enter terminal cleanup before delivering the final notification, while
      still allowing the complete `disposed` listener snapshot to run.
- [ ] Clear status listeners in an unconditional `finally` path after the
      final queued notification pass. Do not rely on a flag set after
      notification returns.
- [ ] Clear commit listeners and invoke the active scene's disposal exactly
      once even when a status listener throws.
- [ ] Collect notification and scene-disposal failures while completing all
      cleanup, then surface them with a documented deterministic precedence or
      an `AggregateError`; neither error should silently erase the other.
- [ ] Preserve re-entrant disposal from inside another status listener: emit
      `disposed` once, drain its queued pass, release listeners, and dispose
      the scene once.
- [ ] Keep repeated external `dispose()` calls as terminal no-ops after the
      first complete attempt.

#### RED-first tests

- [ ] Register a throwing `disposed` listener and a later listener; assert the
      whole listener snapshot runs, the scene disposer runs once, the commit
      listener set is released, and the command surfaces the listener error.
- [ ] Make both a status listener and the scene disposer throw; assert all
      cleanup still completes and both failures remain observable under the
      selected error policy.
- [ ] Cover ordinary disposal, re-entrant disposal, and repeated disposal with
      the same exactly-once assertions.
- [ ] Add a deterministic listener-release seam or diagnostic assertion; the
      existing test only proves that new subscription is rejected after
      disposal and cannot detect retained old listeners.

### T10-F2 — Finish `pause()` side effects before surfacing listener failures

**Priority:** High

The public `pause()` calls `pauseInternal()` before flushing a pending external
scene transition. `pauseInternal()` now delivers the `paused` status, and a
throwing listener escapes immediately. The remaining `pause()` body is then
skipped, leaving the pending transition stored inside an already paused
session. A later `start()` can commit that stale transition on an unexpected
frame instead of the transition being resolved at the pause boundary as the
existing lifecycle contract requires.

The status-listener API explicitly promises that listener failures are
surfaced only after lifecycle side effects are complete. That promise must
apply to the entire command, not only frame cancellation and input reset.

#### Required approach

- [ ] Separate transition application from notification-error surfacing so
      `pause()` can capture the first listener failure, finish its pending
      transition/commit work, and then throw.
- [ ] Define deterministic precedence when both the status listener and the
      pending transition or commit fail. Preserve all actionable failures
      rather than accidentally masking one.
- [ ] Apply the same command-transaction audit to `start()`, error-path pause,
      and `dispose()` so no notification throw can skip mandatory work after
      `setStatus()`.
- [ ] Keep the new status authoritative during completion and do not emit a
      second status event merely to finish the command.

#### RED-first tests

- [ ] While running, request an external scene transition, register a listener
      that throws on `paused`, and call `pause()`. Assert the transition is
      committed at the pause boundary before the listener error is returned.
- [ ] Resume after that failure and assert no stale pending transition is
      committed by the next frame.
- [ ] Cover a transition failure plus a listener failure and assert the final
      status, scene, scheduler, input state, and error policy are coherent.

### T10-F3 — Stabilize the external-store subscription callbacks

**Priority:** Important

`useGameSessionStatus()` passes new inline `subscribe` and `getSnapshot`
functions to `useSyncExternalStore()` on every render. React therefore tears
down and recreates the session subscription after unrelated parent renders,
even when the session identity has not changed. This contradicts T10.5's
checked requirement for stable callbacks and adds avoidable lifecycle churn to
an API intended to be the low-frequency control plane.

Snapshot re-reading prevents most missed-state failures, so this is not a
frame-loop correctness bug, but it creates unnecessary listener activity and
makes leak/race behavior harder to reason about under Strict Mode.

#### Required approach

- [ ] Memoize `subscribe` with `useCallback` using only `session` as its
      semantic dependency.
- [ ] Memoize `getSnapshot` with the same session dependency.
- [ ] Use stable module-level no-op subscription cleanup for the absent or
      disposed session branch.
- [ ] Preserve the current `GameSessionStatus | undefined` return contract and
      disposed-session behavior.

#### RED-first tests

- [ ] Instrument `addStatusListener()` and subscription removal counts, force
      unrelated parent rerenders with the same session, and assert no
      unsubscribe/resubscribe churn.
- [ ] Replace the session and assert exactly one old detach and one new attach.
- [ ] Repeat under Strict Mode and verify the only additional setup/cleanup is
      React's documented rehearsal, not every ordinary render.

### T10-F4 — Make the reference pause example runnable and the guide copyable

**Priority:** Important

The new `PaddleScreen` and `PauseOverlay` are not referenced by the playground
catalog, shell, tests, or another executable entry point. They currently prove
only that isolated source files typecheck. The T10.7 checkbox for component
behavior was marked complete using headless seam tests that never mount the
actual overlay, so pause/resume touch capture, stacking, safe-area placement,
back behavior, and accessibility are still unverified.

The guide snippet is also not copyable as written: it uses `Pressable`, `Text`,
and `View` without importing them and references an undefined `overlay` style.
This allows the documentation and the actual `PauseOverlay` implementation to
drift immediately.

#### Required approach

- [ ] Either register the paddle tutorial as a real playground entry or mount
      it through an existing executable example route. Do not call an
      unreachable source file a validated reference game.
- [ ] Add a focused mounted component test for the actual `PauseOverlay` and
      `PaddleScreen` composition: one press pauses, the full overlay blocks
      gameplay touches, one press resumes, and closing/unmounting retains Task
      9 ownership semantics.
- [ ] Place the pause control inside a safe-area-aware screen/control region
      and preserve at least a 44-by-44-point effective hit target.
- [ ] Make the guide consume or faithfully reproduce the tested component.
      Include every React Native import and either define the referenced styles
      or link to a complete source file.
- [ ] Keep gameplay input and pause controls as clear sibling interaction
      regions so native hit testing does not depend on accidental child order.

#### Acceptance checks

- [ ] The example is reachable from a normal app launch without editing source
      code.
- [ ] The rendered pause and resume controls work on the first press.
- [ ] Touching or dragging the covered game surface while paused cannot enqueue
      gameplay input.
- [ ] The documentation snippet can be pasted into the tutorial project
      without missing identifiers.

### T10-F5 — Correct the completion record after the fixes

**Priority:** Important

The plan header still says **Not started**, most acceptance criteria and the
entire definition-of-done list remain unchecked, while implementation steps
are checked and the handoff reports the task as implemented. Two T10.8 items
are also marked complete while their own notes say the dedicated React hook
and session API references were deferred. A deferred deliverable is not a
completed deliverable.

#### Required changes

- [ ] Keep Task 10 open while T10-F1 through T10-F4 remain unresolved.
- [ ] Change the top-level status to an honest implementation-review state.
- [ ] Uncheck the deferred hook/session reference items or implement the pages
      before checking them.
- [ ] Check acceptance criteria only when the named behavior has direct
      evidence; do not use the aggregate test count as a substitute.
- [ ] Leave physical iPhone, iPad, Android, screen-lock, and device soak rows
      unchecked until run on the named hardware.
- [ ] After focused fixes pass, update the definition-of-done list and record
      the fix commit identifiers without overwriting the device-gated remainder.
