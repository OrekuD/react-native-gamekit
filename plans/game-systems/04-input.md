# Semantic pointer input and multitouch button pads

## Purpose and verdict

Translate physical input into ordered semantic edges consumed by fixed-step simulation. Pointer IDs own actions; coordinates use the presented viewport/camera; pause, layout changes, replacement, and cancellation invalidate stale work. **Keep the core buffer and compact coalesced pointer packets. Button-pad ownership needs a focused repair.**

Sources: [input buffer](../../packages/gamekit/src/core/input/createInputBuffer.ts), [button-pad controller](../../packages/gamekit/src/core/input/buttonPad.ts), [GameButtonPad](../../packages/gamekit/src/react/GameButtonPad.tsx), [GamePointerInput](../../packages/gamekit/src/react/GamePointerInput.tsx), [pointer binding](../../packages/gamekit/src/react/pointerBinding.ts), [coalescer](../../packages/gamekit/src/react/pointerCoalescer.ts).

## GS-INPUT-01 — P1: a queued pointer can become permanently held after lifting

**Evidence: reproduced.** Before the next sample: begin pointer 1, end 1, begin 2, end 2. `pendingBegin` stores pointer 2, but `move`/`end` only recognize the current owner, pointer 1. Sampling releases 1 and promotes 2 as active. Subsequent samples leave 2 active forever even though it already lifted. Its last position can also be stale; cancellation can promote a pending pointer instead of neutralizing the stream.

**Resolve:** model the pending pointer's full edge/position state, or use a small ordered pending-edge structure with an explicit bound. Preserve the old owner's terminal sample before transferring ownership. Route moves and terminal edges to a pending owner when IDs match; a whole-action cancellation must clear pending acquisition. Do not drop release edges to simplify the queue.

**Acceptance:** begin/end/begin/end within one tick eventually produces neutral input; pending moves preserve the newest position; cancel before transfer leaves no active pointer; unrelated pointer IDs cannot steal ownership. Include pause/resume and transition boundaries.

## GS-INPUT-02 — P1: button-pad refcounts and pointer tracking are inconsistent

**Evidence: reproduced.** Two touches on `jump` emit `pressed: ['jump', 'jump']`. Removing that zone decrements its count only once after deleting both pointer mappings, returns no release, and leaves `held(): ['jump']`. A touch sliding left → gap → right never presses right because `touchesMove` ignores pointers after they leave a zone.

**Resolve:** track active physical pointers independently from their current action. Emit press only on 0→1 owners and release only on 1→0. Zone removal must release and delete the entire action count while retaining/reclassifying active pointers consistently. Keep first-zone-wins ordering explicit. Clone registered rects so caller mutation cannot alter hit areas invisibly.

**Acceptance:** two fingers in one zone yield one press/one final release; zone removal under two fingers fully releases; sliding across empty space reacquires; beginning in empty pad space and sliding into a zone follows a documented policy. Add tests to [buttonPad.test.ts](../../packages/gamekit/test/buttonPad.test.ts).

## GS-INPUT-03 — P1: mounted buttons do not fulfill their zone lifecycle/coordinate contract

**Evidence: source-confirmed.** `GameButton` never calls `context.removeZone` on unmount or action replacement. It registers `onLayout.x/y`, which are relative to its immediate parent, while hit tests use pad coordinates. The component advertises arbitrary nested layouts. A removed button therefore leaves a live zone, and a button inside an offset row is registered at the wrong location. Cleanup also calls session input even if the session was already disposed.

**Resolve:** give every mounted zone a registration identity with idempotent cleanup. Measure/convert each rect into the pad's coordinate space and refresh on relevant layout changes. Reject or explicitly support duplicate action registrations. Guard terminal cleanup against disposed sessions. Do not require every game screen to duplicate coordinate math.

**Acceptance:** mount a button inside an offset wrapper; its visual and hit rectangles agree. Unmount, rename, replace, and re-layout it while held; all old zones release and disappear. Dispose the session before pad unmount without an exception. Native smoke must also cover actual gesture competition/pass-through; `box-none` alone does not prove recognizer behavior.

## GS-INPUT-04 — P2: stale work and pause state need equivalent handling in both adapters

**Evidence: source-confirmed gaps.** Button pad sends whole native touch events on every move without generation stamps, disposal guards, or lifecycle synchronization. Core pause clears held input, but the pad still remembers pointer/action ownership, so resume can disagree with its controller. Pointer input resets its UI coalescer on pause but does not clear its React sampler mirror there; finalization sees no active coalescer pointer and can leave the trailing sampler mounted. Pause also does not advance the packet epoch, allowing already queued pre-pause packets to be accepted after a rapid resume.

**Resolve:** define one adapter invalidation policy for pause, session/action replacement, layout changes, and unmount. Stamp packets with that ownership generation, reject stale callbacks at RN ingress, clear pending/held controller state and sampler activity, and require a fresh down after resume. Coalesce button moves or compute compact action diffs on UI after correctness is established; retain immediate ordered edges.

**Acceptance:** defer RN callbacks, pause/resume or replace the session, then deliver old packets; no held action is resurrected and no disposed controller is called. Pause while a pointer is down and verify trailing sampler count returns to zero even if the later native cancel/finalize produces no coalescer event.

## Keep and measure

Keep event-time camera stamps, layout epochs, pointer-ID ownership, and trailing movement delivery. Do not replace the pipeline with per-frame React state or per-entity gesture detectors. Measure 120/240 Hz native move streams, 60/120 Hz displays, RN load, two-thumb controls, orientation changes, and edge navigation on hardware. Existing pure/mounted tests do not prove OS gesture arbitration or input latency.
