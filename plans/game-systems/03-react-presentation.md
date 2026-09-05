# React integration and presentation bridge

## Purpose and verdict

React owns mount/unmount, composition, loading screens, and low-frequency UI. A headless session owns simulation. Shared values carry compact commits to the UI runtime, where one alpha clock interpolates presentation. **Keep this boundary. Remove unconditional diagnostic work and close subscription failure paths.**

Sources: [GameView.tsx](../../packages/gamekit/src/react/GameView.tsx), [bindGameSession.ts](../../packages/gamekit/src/react/bindGameSession.ts), [bindAppLifecycle.ts](../../packages/gamekit/src/react/bindAppLifecycle.ts), [useGameSession.ts](../../packages/gamekit/src/react/useGameSession.ts), [useGameSessionStatus.ts](../../packages/gamekit/src/react/useGameSessionStatus.ts), [lifecycleSource.ts](../../packages/gamekit/src/react/lifecycleSource.ts).

## GS-REACT-01 — P2: disabled instrumentation still crosses runtimes

**Evidence: source-confirmed.** `GamePresentation`'s UI frame callback schedules `reportUiObserved` whenever it observes a new revision (GameView lines 231–240). The optional callback check happens later on RN. Without instrumentation, the UI still reads time and schedules roughly one RN callback per observed commit. The comment in `instrumentation.ts` claiming negligible disabled overhead is inaccurate.

**Resolve:** delete the unconditional diagnostic round trip. Capture/mirror whether the specific diagnostic is enabled and branch before timestamp reads, packet creation, observation bookkeeping that is only diagnostic, and scheduling. Keep required frame/alpha logic independent. For enabled measurements, aggregate on UI or bound callback rates where that preserves the measurement's meaning; do not sacrifice causal latency attribution merely to reduce a counter.

**Acceptance:** execute the actual registered frame callback with no instrumentation across multiple revisions and assert zero diagnostic scheduling and timing reads. An enabled observer still reports the first UI observation once per revision. Verify replacing instrumentation does not restart the session.

## GS-REACT-02 — P2: failed setup and cleanup leak later resources

**Evidence: source-confirmed.** `bindGameSession` registers a commit listener before `game.start()`, but does not remove it if start throws. `GamePresentation` registers a status listener before calling that binder; a failed binder prevents the effect from returning cleanup. Its cleanup sequence also stops at the first thrown cleanup, skipping status removal and camera disposal. App lifecycle binding has similar partially completed setup possibilities.

**Resolve:** make setup transactional with a small reverse-order cleanup list or explicit try/finally stages. Every acquired subscription must have a release path even when a subsequent step fails. Cleanup must attempt all releases and preserve the first/composed failures. Do not swallow application failures or add a global lifecycle manager.

**Acceptance:** fail scheduling, an initial present callback, AppState registration, and pause notification separately. Count all listeners before/after; they return to baseline. Strict Mode setup/cleanup rehearsals and disposed-session unmounts remain safe.

## GS-REACT-03 — P1 investigation: prove buffer writes notify the native renderer

**Evidence: installed-source risk; native failure not demonstrated in this review.** SpriteBatch, tile layers, and sprite particles initialize `useRectBuffer`/`useRSXformBuffer` with constant modifiers, then mutate host objects from a different `useDerivedValue`. Installed Skia **2.11.0**, `src/external/reanimated/buffers.ts`, explicitly calls `notifyChange(values)` after executing its own buffer modifier. The separate GameKit writers do not perform an equivalent publication. Their derived count is discarded or unchanged. A test that inspects a fake rect's fields does not prove Skia redraws it.

**Resolve:** first add a native integration reproduction where only sprite/tile/particle slots change and no other shared value forces a redraw. Inspect Skia's installed renderer subscriptions and supported mutation/publication API. Prefer putting writes inside the supported buffer update path, or a documented atomic notification path; do not import private `_value`/`notifyChange` implementation details into the library. Preserve coherent rect/transform/color generations.

**Acceptance:** on iOS and Android, a stationary camera and stable React tree show moving, disappearing, recoloring, and reappearing batch entries. Verify no idle repeated buffer reset races. Record exact dependency versions and build type. This is a prerequisite for calling all three batch systems native-validated.

## Simplification and performance boundaries

- Keep `useSyncExternalStore` for status and effect-owned session construction. They express real ownership requirements.
- Keep the read-only `GameLifecycleSource`; reuse it for consumers that need session pause status instead of adding private backdoors.
- The main frame callback remains registered while paused and returns early. Measure residual callback cost before replacing this with activation machinery; the pointer skill records prior stack-specific activation problems.
- Consider removing redundant presentation identity/epoch mechanisms only after proving they protect the same stale-work boundary. They currently cover different things: remount state versus delayed commit acceptance.

Preserve the ownership, Strict Mode, pause, binding, alpha clock, and lifecycle-source tests. Add behavioral tests at callback execution points, not source-text assertions alone. Physical 60/120 Hz performance remains unmeasured.
