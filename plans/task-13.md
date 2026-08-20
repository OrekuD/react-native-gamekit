# Task 13: Deterministic game events and effects

## Status

**Complete — v1 definition of done satisfied (headless), F1–F4 review findings fixed.** The deterministic event
boundary is implemented and the `c3f6c21` review findings (F1–F4) are now
addressed with the focused evidence in the fix record. The nine physical-device rows
remain honestly open; headless determinism does not require device hardware.
Task 13 introduces the shared
simulation-to-effects boundary required by audio, haptics, particles,
achievements, transient HUD updates, and checkpoint requests.

Task 13 is complete when the v1 definition of done is satisfied. The future
expansion backlog remains part of the roadmap, but it does not block Task 13
completion and must not be implemented without a separate approved task.

## Objective

Give simulation one deterministic and typed way to report discrete facts after
a successful fixed tick. Non-authoritative systems consume those facts without
running inside scene updates or changing authoritative state.

```ts
const events = defineGameEvents({
  'brick-hit': gameEvent<{
    brickId: string;
    point: Point2D;
    strength: number;
  }>(),
  'life-lost': gameEvent<{ remaining: number }>(),
});

const play = defineScene({
  actions: ['steer'],
  emits: ['brick-hit', 'life-lost'],
  create: createPlayState,
  update: ({ state, input, events }) => {
    const result = updatePlay(state, input);

    if (result.hit !== undefined) {
      events.emit('brick-hit', {
        brickId: result.hit.id,
        point: result.hit.point,
        strength: result.hit.strength,
      });
    }

    return result.state;
  },
  snapshot: snapshotPlay,
});
```

Consumers subscribe to committed events:

```ts
const subscription = session.addGameEventListener('brick-hit', (event) => {
  audio.play(brickHitSound);
  particles.emit(brickBurst, {
    position: event.payload.point,
    seed: seedGameEvent(event),
  });
});

subscription.remove();
```

The names remain provisional until T13.0 compile fixtures. The contract is
fixed at a higher level: simulation emits typed facts during one update, the
session publishes them only after the tick commits, and consumer failure never
changes gameplay state.

## Package boundary

Game events are part of the main `rn-gamekit` package entry point because they
belong to the core session contract.

- Publish one npm package: `rn-gamekit`.
- Export definitions, envelopes, subscriptions, and session event methods from
  `rn-gamekit`.
- Add a React hook to `rn-gamekit/react` only if the v1 examples demonstrate a
  real lifecycle need that the imperative subscription does not satisfy.
- Keep the root native-free. Events must not import React, React Native, Skia,
  Reanimated, audio, haptics, storage, or platform modules.
- Do not create a separate events package or a process-wide singleton bus.

## V1 scope

V1 includes the minimum complete boundary needed by later engine systems.

### Included in v1

- Literal typed event definitions and per-scene emission declarations.
- An update-scoped emitter that becomes invalid when the update finishes.
- Transactional staging: failed ticks publish no events.
- Immutable payloads and envelopes with deterministic tick ordering.
- Per-session subscriptions with idempotent cleanup.
- Post-tick delivery after authoritative state commits.
- Catch-up tick ordering without event collapse or duplication.
- Pause, transition, restart, replacement, and disposal semantics.
- Consumer failure isolation with an explicit reporting policy.
- Brick Breaker migration as the reference integration.
- Focused documentation, type fixtures, and deterministic tests.

### Deferred from v1

- A general effect-router framework.
- Event priorities, cancellation, propagation, or middleware.
- Automatic replay/history storage and trace-inspector UI.
- Global or cross-session event buses.
- Network replication, rollback netcode, and remote serialization.
- UI-runtime or native-thread event handlers.
- Continuous position or velocity streams; those remain snapshots.
- Provider integrations for achievements, analytics, audio, haptics,
  particles, or persistence.

## V1 contract

### Event definitions and typing

The public API must preserve literal event names and exact payload types from
definition through emission and subscription.

- `gameEvent<TPayload>()` is a type witness and owns no runtime resource.
- `defineGameEvents({...})` validates names and freezes declarations.
- `defineGame({ events })` associates one event map with a game definition.
- A scene's `emits` list narrows its update-scoped `events.emit()` method.
- A scene cannot emit an undeclared name or the wrong payload.
- A session listener can subscribe only to events declared by that game.
- Games without events retain a no-event fast path.

Avoid `emit(type: string, data: any)`, writable callback properties, service
objects in scene state, and events inferred from rendered snapshots.

### Transaction and ordering

Each update receives a fresh emitter with these rules:

1. Stage emissions in call order during the update.
2. Invalidate the emitter in `finally` when the update returns or throws.
3. Discard every staged event if update, freeze, transition resolution, or
   snapshot extraction fails.
4. Commit the staged events only with the successful authoritative tick.
5. Publish catch-up ticks by tick order, then emission order.

The minimum envelope is:

```ts
interface GameEventEnvelope<TName extends string, TPayload> {
  readonly name: TName;
  readonly payload: DeepReadonly<TPayload>;
  readonly tick: number;
  readonly scene: string;
  readonly sceneTick: number;
  readonly ordinal: number;
}
```

- `(tick, ordinal)` is unique within one live session.
- Identity never uses wall time, UUIDs, React renders, or display frames.
- Successful transition-tick events retain the source scene and source tick.
- Zero-step display callbacks publish nothing.

### Payload boundary

Payloads are game-owned plain values. V1 must accept finite numbers, strings,
booleans, optional `undefined`, arrays, and plain records. It must reject
functions, promises, symbols, cycles, sparse arrays, class instances, unsafe
prototypes, native handles, React elements, refs, sessions, and non-finite
numbers.

Clone and freeze accepted payloads when they are staged. Errors must identify
the event and exact payload path. Establish a bounded payload-size policy so
events cannot carry textures, audio buffers, level files, or saves.

### Delivery and cleanup

- Deliver events only after the source tick commits.
- Invoke listeners from a stable listener snapshot.
- A listener added during delivery receives only later events.
- Removing a listener prevents future deliveries and is idempotent.
- Pause produces no new simulation events and resume replays none.
- Disposal prevents future delivery and releases listeners once.
- A throwing listener does not suppress sibling listeners or alter session
  state. The contract freeze must choose a visible, non-recursive error sink.
- Simulation never awaits an async effect started by a listener.

## Forward-compatibility constraints

V1 must leave room for future effect tooling without exposing unfinished APIs.

- Keep event publication separate from consumer routing.
- Keep event identity stable enough for future trace comparison and seeded
  visual effects.
- Preserve multiple independent subscribers.
- Do not let consumer return values affect event delivery or simulation.
- Do not retain an unbounded history in production sessions.
- Do not add placeholders for priorities, middleware, replay, or networking.

## V1 implementation tasks

### T13.0 — Freeze the public contract

- [x] Inventory current discrete outcomes triggered by snapshot diffs, commit
      listeners, React state, or ad hoc callbacks.
- [x] Write compile fixtures for definitions, scene emission, subscriptions,
      payload errors, and cleanup.
- [x] Prove the API with Brick Breaker's brick-hit, life-lost, and game-over
      workflows.
- [x] Freeze envelope typing, payload grammar and size bounds, delivery timing,
      transition behavior, and listener-error policy.
- [x] Record the event/effect authority boundary in the task decision record.

- [x] Add focused files for definitions, envelopes, errors, and subscriptions.
- [x] Preserve literal inference without duplicate author-written unions.
- [x] Validate and clone payloads with exact structured error paths.
- [x] Freeze accepted declarations, payloads, and envelopes.
- [x] Re-export the public API from the native-free root barrel.

- [x] Give each scene update one narrowed, update-scoped emitter.
- [x] Stage events alongside the existing transition intent.
- [x] Invalidate the emitter on every success and failure path.
- [x] Commit or discard staged events atomically with the tick.
- [x] Preserve the allocation-free path for games/scenes without events.

- [x] Add typed per-session listener registration and idempotent removal.
- [x] Publish successful tick events once, in deterministic order.
- [x] Freeze add/remove/re-entrant behavior through listener snapshots.
- [x] Isolate and report listener failures without changing simulation.
- [x] Clear staged or unpublished events on terminal failure and disposal.

- [x] Add Brick Breaker event declarations and emit semantic outcomes from
      authoritative update code.
- [x] Consume at least one event outside simulation without changing score,
      collision, or scene-transition authority.
- [x] Prove rerenders, interpolation frames, pause/resume, and catch-up do not
      duplicate events.
- [x] Preserve all existing deterministic Brick Breaker checkpoints.

- [x] Add the Events and effects engine-system page.
- [x] Add a guide for emitting and subscribing to one typed event.
- [x] Explain events versus inputs, snapshots, lifecycle status, and effects.
- [x] Compile-check the documented call sites.
- [x] Run focused type, transaction, ordering, failure, and cleanup tests.
- [x] Run package typecheck/build and root-import isolation checks.
- [x] Run the broader repository gate only after focused evidence is green.
- [x] Mark physical-device event/effect rows honestly when hardware is
      unavailable; headless determinism does not require device hardware.

- [x] Event names and payloads remain literal and typed end to end.
- [x] Failed ticks publish no events.
- [x] Catch-up ticks preserve tick and ordinal order without duplication.
- [x] Payloads and envelopes are immutable, validated, bounded, and native-free.
- [x] Listener failures cannot alter simulation or suppress siblings.
- [x] Pause, transition, restart, replacement, and disposal are defined and
      tested.
- [x] Games without events retain the measured fast path.
- [x] Brick Breaker uses the public event API without checkpoint changes.
- [x] Documentation teaches the post-tick effects boundary.
- [x] Focused automated gates pass.

## Future expansion backlog

The following roadmap items remain intentionally preserved. They do not block
Task 13 completion and require a new task before implementation.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| EVENT-F1 | Declarative effect routers and React binding helpers | Several systems repeat the same subscription ownership code |
| EVENT-F2 | Testing trace recorder, comparison, and first-divergence output | Replay tests need reusable event-trace diagnostics |
| EVENT-F3 | Event Lab with ordering, catch-up, and failure controls | Public event debugging needs a dedicated interactive tool |
| EVENT-F4 | Handler middleware, filtering, or priority | Real games demonstrate ordering needs beyond independent listeners |
| EVENT-F5 | Persistent event history or replay import/export | A replay product contract is designed separately |
| EVENT-F6 | Cross-session or application events | A workflow cannot be modeled through explicit app ownership |
| EVENT-F7 | Network replication and rollback integration | A separate networking/determinism milestone defines authority |
| EVENT-F8 | UI-runtime or native-thread delivery | Profiling proves RN-thread delivery is insufficient and semantics are frozen |

## Implementation order

Implement Task 13 in this order:

1. T13.0 contract fixtures and decisions.
2. T13.1 definitions and payload boundary.
3. T13.2 update transaction.
4. T13.3 ordered delivery.
5. T13.4 Brick Breaker integration.
6. T13.5 docs and focused verification.

Do not start Task 14 or Task 15 until failed-tick discard, event ordering, and
consumer failure isolation are frozen and proven.


### F1–F4 fix record

> **F1–F4 fix record.** F1: `defineScene` now accepts `events` for standalone type safety via `BrandedGameEventDefs` and `InferGameEventMap`; `emits` is constrained to `keyof InferMap`, `events.emit` is typed to the exact payload, and `defineGame`/`createGameSession` enforce runtime reference identity. Brick Breaker migrated without casts; fixtures prove valid standalone, undeclared, wrong payload, and missing field at `events.emit`. F2: `addGameEventListener` accepts `void | Promise<void>`, `deliverEvents` observes rejections via `.catch` and centralizes reporting through `reportGameEventListenerError` (non-recursive, `console.error` with swallow), siblings remain synchronous and ordered, disposal does not cancel already-started work. F3: `cloneAndValidatePayload` now tracks ancestry only (WeakSet with delete), uses `getOwnPropertyDescriptors` to reject accessors/non-enumerables without invoking getters, handles shared acyclic references, cycles, and symbol/unsafe keys with exact paths. F4: `seedGameEvent` now mixes only `tick`, `ordinal`, and `nameHash` (removed `sceneTick`), JSDoc and docs updated, and tests prove equal seeds for same identity with different `sceneTick` and different ordinal changes seed.

### T13.5 completion record

> **T13 v1 complete.** Definitions and payload validation (`src/events`), transactional emission (per-tick emitter, staged commit/discard, invalidation), ordered per-session delivery (per-tick snapshot, deterministic tick+ordinal, pause/resume/catch-up/transition/disposal, failure isolation via `console.error`), Brick Breaker migration (`brick-hit`/`life-lost`/`game-over` with transient hit count), and docs (`engine-systems/events` + `guides/emit-game-events`, meta.json, compile fixtures `test/api/gameEvents.types.tsx`) are implemented. `pnpm check` exits 0 (514 package tests — 23 new — + 177 playground tests, typecheck, build, docs build). The future expansion backlog (EVENT-F1..F8) remains deferred.

## Feedback — Task 13 implementation review

This review is limited to Task 13 commit `c3f6c21`: the public event types,
scene/session integration, payload cloning, listener delivery, Brick Breaker
reference integration, tests, and event documentation. No unrelated checks or
full repository gate were run. Address these findings before restoring Task 13
to complete.

### T13-F1 — Make standalone scene emission genuinely type-safe

**Priority:** High

The public reference path does not preserve exact payload typing through a
normal separately declared scene. Brick Breaker bypasses `events.emit()` typing
seven times with casts to `{ emit(name: string, payload: unknown): void }`, the
runtime suite relies heavily on `as any`, and the compile fixture explicitly
admits that separately declared scenes do not know the game event map. It also
contains no failing wrong-payload emission assertion.

The documentation nevertheless shows a separately declared scene and claims
that `emits` narrows both the name and payload. It also says a wrong payload
shape throws `GameEventError` at staging time, but v1 has no runtime schema for
event-specific object fields. Runtime validation can reject unsupported plain
data, not detect a missing `brickId` or a wrong field type.

#### Required approach

- [x] Freeze one ergonomic way to bind an event definition to a standalone
      scene before its `update` callback is contextually typed. An explicit
      event-map option or a small event-bound scene factory are acceptable;
      do not require casts or an unwieldy manual generic list.
- [x] Preserve the same event-definition identity through `defineGame()` so a
      scene cannot silently bind to an unrelated map with compatible names.
- [x] Add compile fixtures proving that a valid standalone scene compiles,
      an undeclared event name fails, a wrong payload fails, and a missing
      payload field fails at the `events.emit()` call.
- [x] Migrate Brick Breaker to the public typed path and remove every event
      emitter cast. Type the Task 13 test factory well enough that the normal
      successful path does not require `game as any`, `emits as any`, or
      subscription-name casts.
- [x] Correct both event documentation pages: describe event-specific shape
      validation as compile-time TypeScript enforcement and runtime payload
      validation as the plain-data/limits boundary. Do not claim structural
      runtime validation unless descriptors gain real validators.

### T13-F2 — Handle rejected async listeners without an unhandled rejection

**Priority:** Important

`addGameEventListener()` accepts a callback typed as returning `void`, which
still permits an `async` function in TypeScript. `deliverEvents()` catches only
synchronous throws and ignores the returned Promise, so an async audio,
persistence, analytics, or achievement listener that rejects becomes an
unhandled rejection. This is a direct gap in an API intended to be the boundary
for those effects.

#### Required approach

- [x] Freeze the v1 contract explicitly. The recommended path is to accept
      `void | Promise<void>`, observe thenable rejection without awaiting it,
      and report it through the same listener-error sink.
- [x] Centralize listener error reporting in a non-recursive helper whose own
      failure cannot pause the session or escape into the fixed-step loop.
- [x] Keep sibling delivery synchronous and ordered; observing a returned
      Promise must not delay the next listener or simulation.
- [x] Define disposal behavior honestly: already-started work is not canceled,
      but its rejection remains observed and reported.

#### Focused tests

- [x] Add one rejecting async listener followed by a sibling and assert the
      sibling runs, the rejection is reported once, and the session remains
      running without an unhandled rejection.
- [x] Make the configured/default reporter throw and assert that reporting
      failure cannot pause or corrupt the session.

### T13-F3 — Clone plain payload graphs without executing or dropping properties

**Priority:** Important

`cloneAndValidatePayload()` uses one `WeakSet` for the entire traversal and
never removes completed branches. A valid acyclic payload such as
`{ first: shared, second: shared }` is therefore rejected as a cycle. Plain
records are also traversed with `Object.keys()` and property reads, which can
execute getters and silently omit non-enumerable own properties. That changes
or executes caller data instead of enforcing the documented plain-data
boundary.

#### Required approach

- [x] Track only the active recursion ancestry, removing an object after its
      branch completes, or use a `WeakMap` cloning strategy. Continue to reject
      true self and mutual cycles with the exact offending path.
- [x] Inspect own property descriptors before reading values. Reject accessors,
      non-enumerable properties, symbol keys, and unsafe keys with
      `GameEventError`; never invoke a payload getter during validation.
- [x] Keep the current node, depth, string, and array limits and deep-freeze the
      resulting owned clone.

#### Focused tests

- [x] Prove a repeated acyclic child is accepted and independently immutable.
- [x] Prove self and mutual cycles still fail at the correct path.
- [x] Prove a getter is never invoked and an accessor/non-enumerable property
      fails with the correct event and payload path.

### T13-F4 — Align `seedGameEvent()` with its published identity contract

**Priority:** Important

The public JSDoc and engine-system page say the seed is derived from
`(tick, ordinal, name)`, but `seedGameEvent()` also mixes in `sceneTick`. The
extra field is not part of the documented event identity and makes the helper's
observable result disagree with its contract.

#### Required approach

- [x] Use the documented stable inputs only: event name, global tick, and
      ordinal. Do not include presentation data or redundant scene-local time.
- [x] Add a test where two envelopes share name/tick/ordinal but have different
      `sceneTick` values and assert equal seeds.
- [x] Keep the existing test proving that a different ordinal changes the
      sampled seed, and make the implementation comments, JSDoc, and docs name
      the exact same input tuple.

### Feedback completion record

Keep this section open until T13-F1 through T13-F4 are fixed with the focused
evidence above. Afterward, restore the top-level status, record the resolving
commit, and leave the existing physical-device rows unchanged.
