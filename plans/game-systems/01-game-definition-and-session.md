# Game definition and fixed-step session

Reviewed 2026-09-05 against working tree based on `a27f78b`. This records the original review, not verification of subsequent implementation commits. Priority, evidence, and implementation status conventions are in [README](README.md).

## Purpose and verdict

Own authoritative simulation time, consume semantic input once per tick, and publish adjacent immutable snapshots. React and the UI runtime must not become alternate simulation owners. **Keep this architecture.** A general ECS, scheduler framework, worker runtime, or physics world would add obligations without resolving the problems below.

RN/JS owns the session, input buffer, scene state, and event staging. The frame driver supplies wall-clock samples; the session advances at a fixed rate with capped catch-up. Presentation commits are coalesced within a display callback. The UI runtime interpolates the resulting snapshots.

## What is already good

- `fixedStepMs`, catch-up limits, pause baseline reset, and scheduling generations are explicit.
- Zero-step callbacks do not publish another full snapshot. Catch-up publishes the final adjacent pair.
- Injected `FrameDriver` makes timing and cancellation reproducible without native dependencies.
- Status listeners are separate from commit listeners and support reentrant transitions and failure isolation.

Sources: [createGameSession.ts](../../packages/gamekit/src/core/session/createGameSession.ts), [frameDriver.ts](../../packages/gamekit/src/core/frameDriver.ts), [definition](../../packages/gamekit/src/definition/defineGame.ts).

## GS-SESSION-01 — P2: external transition timing contradicts its public contract

**Evidence: source-confirmed contract mismatch.** `GameSession.setScene` says a running transition commits at the next fixed-step boundary. The driver callback handles `pendingTransition` at lines 604–618, before updating the accumulator or deciding whether a fixed step is due. At 120 Hz with a 60 Hz simulation, a queued transition can publish on a zero-step callback.

**Resolve:** first choose the intended behavior. Prefer preserving the current useful control-frequency behavior and documenting it as “next frame-driver callback, without advancing simulation time” if existing reference games need immediate transitions. If fixed-step alignment is required by the task contract, move pending-transition application to an actual step boundary. Do not accidentally run a target update early or discard timing debt. Update API comments, lifecycle docs, and the corresponding task disposition together.

**Acceptance:** a manual driver at 0, 8, and 17 ms with a 16.667 ms step explicitly proves when a queued transition publishes, whether tick advances, and when the new scene first updates. Repeat for pause before the pending transition fires.

## GS-SESSION-02 — P2: make scheduler failure leave an honest status

**Evidence: source-confirmed gap.** `start()` catches a failing initial `requestFrame`, but later calls to `schedule(activeGeneration)` at the end of callbacks are outside equivalent error handling. A throwing injected driver leaves a `running` session with no pending callback. Native RAF failure is not demonstrated; this concerns the runtime's own injectable scheduler contract.

**Resolve:** route initial and successor scheduling through one small failure policy. On failure, clear the handle, invalidate the generation, neutralize input as appropriate, and publish a paused state while preserving the scheduling error. Do not add automatic retries or timers.

**Acceptance:** a driver that accepts the first request and rejects the second leaves no phantom running loop. Recovery by explicit `start()` works when the driver recovers, and a throwing status listener cannot mask the original error.

## GS-SESSION-03 — P3: delete type scaffolding that validates nothing

**Evidence: source-confirmed unnecessary code.** `ValidateSceneEventDefsIdentity` in `defineGame.ts` is always `unknown`; `SceneEventDefs` is unused, and the file disables unused-variable linting. Event identity is actually checked at runtime, both in `defineGame` and session construction.

**Resolve:** remove the no-op type alias/intersection and unused helper. Retain the useful type checks for action names, transition names, and event payloads. Keep runtime validation at the session boundary because definitions are structurally constructible; share a small validation function only if it removes real duplicate logic. Avoid adding nominal brands merely to replace the deleted alias.

**Acceptance:** existing definition compile fixtures still reject undeclared actions/events/transitions; direct session construction still checks event-definition identity. Default typecheck and `typecheck:assets` both pass.

## Performance and scope

No measured reason currently justifies moving simulation to another runtime. Profile update, snapshot extraction, freezing, and publication separately at 60 Hz and 120 Hz before changing scheduling ownership. Preserve the no-event path; [events](13-events.md) owns the small remaining unnecessary per-tick event allocations.

Preserve [gameSession.test.ts](../../packages/gamekit/test/gameSession.test.ts), [commitFrequency.test.ts](../../packages/gamekit/test/commitFrequency.test.ts), [gameSessionPause.test.ts](../../packages/gamekit/test/gameSessionPause.test.ts), and [diagnostics.test.ts](../../packages/gamekit/test/diagnostics.test.ts). The current library baseline is 769 passing tests, not evidence of device frame rate.
