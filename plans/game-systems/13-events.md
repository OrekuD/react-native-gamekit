# Transactional game events and deterministic seeds

## Purpose and verdict

Let successful simulation ticks describe effects without running native effects during update. **Keep staged, typed events and deterministic envelopes. Clarify observer timing and remove redundant validation work; do not turn this into a global event bus or durable queue.**

Sources: [event definitions](../../packages/gamekit/src/events/defineGameEvents.ts), [payload validation](../../packages/gamekit/src/events/payload.ts), [seed helper](../../packages/gamekit/src/events/seed.ts), [delivery/staging in session](../../packages/gamekit/src/core/session/createGameSession.ts), [public event contracts](../../packages/gamekit/src/core/session/types.ts).

## What is already good

Events stage within an update scope and are discarded on failed update/snapshot/transition preparation. Envelopes carry tick, scene, sceneTick, and ordinal. Payloads are bounded, cloned, and deeply frozen. Effect-listener failures are reported without intentionally changing the simulation, and async effects are not awaited. Seed derivation uses deterministic envelope identity rather than wall time.

## GS-EVENT-01 — P2: delivery contract says per-event snapshots, implementation uses per-tick snapshots

**Evidence: source-confirmed mismatch.** Public comments say a listener added during delivery receives later events and removals prevent future deliveries. `deliverEvents` snapshots every event-name listener set before delivering the tick's envelopes. Adding/removing a listener during the first event does not affect any later event in that tick. This may be a good stable policy, but it is a different one.

**Resolve:** choose one policy and update code or documentation/tests together. Prefer keeping per-tick snapshots if reference consumers depend on transactional batch delivery. Specify behavior when a listener pauses, transitions, or disposes the session during delivery; do not leave native consumers guessing whether sibling effects still run.

**Acceptance:** emit two same-name events and one different-name event in a tick. Add/remove/dispose during the first delivery and assert the exact recipients/order. Preserve deterministic `(tick, ordinal)` order through catch-up and transitions.

## GS-EVENT-02 — P2: distinguish simulation commit from render-frame publication

**Evidence: source-confirmed.** Successful tick state is installed before `deliverEvents`, but `commitFrame` updates later at the coalesced publication boundary. A listener calling `getRenderFrame()` can read the previous published tick even though its event describes the new authoritative tick. This is particularly significant when several simulation ticks run in one driver callback.

**Resolve:** document that event payload/envelope is the event-time authority and `getRenderFrame` is the most recently published presentation frame. Put the data an effect needs into its small payload rather than encouraging a second state read. If consumers require a synchronous post-tick snapshot API, first prove that need; do not publish every intermediate render frame to satisfy it.

**Acceptance:** a two-step catch-up test records envelope ticks and frame revisions inside listeners and locks the intended distinction. Effects do not read a stale frame to choose an event's position or scene.

## GS-EVENT-03 — P2: remove getter invocation before plain-data rejection

**Evidence: source-confirmed.** The validator reads `obj.then` when there is no own descriptor, before rejecting non-plain objects. An inherited `then` getter can execute or throw even though the contract says accessors/class instances are rejected without execution. Own function/accessor descriptors and non-plain object rejection already provide enough information; the preliminary thenable detection is mostly redundant.

**Resolve:** reject unsupported prototypes/own descriptors before reading any user properties, using descriptor values only. Delete the redundant thenable/React checks where ordinary domain rejection already gives the intended result, preserving useful error paths. Storage has similar code; coordinate [GS-STORAGE-03](17-storage.md), but avoid a configurable validation framework merely to share code.

**Acceptance:** inherited `then` getters and own accessors are never invoked, invalid objects fail through GameEventError, plain acyclic shared references still work, and existing payload limits remain effective.

## Performance and deletions

Session staging still creates an empty array and scope bookkeeping on no-event ticks. Keep a shared empty/no-emitter path and allocate staging only when a scene can emit if measurements justify the small simplification. The per-payload node limit is not a per-tick event-count budget; measure bursty event workloads before adding any queue limit, and never silently drop gameplay events. Delete stale type aliases in [GS-SESSION-03](01-game-definition-and-session.md). Preserve [gameEvents.test.ts](../../packages/gamekit/test/gameEvents.test.ts) and event API fixtures.
