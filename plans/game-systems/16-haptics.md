# Haptic feedback and capability/lifecycle gates

## Purpose and verdict

Dispatch a small set of optional tactile effects, return a clear suppression reason, and avoid feedback while paused/backgrounded/muted. **Keep the small preset API and no-op result for unsupported hardware. Simplify backend discovery and separate pause ownership.**

Sources: [createGameHaptics.ts](../../packages/gamekit/src/haptics/createGameHaptics.ts), [resolver](../../packages/gamekit/src/haptics/resolver.ts), [types](../../packages/gamekit/src/haptics/types.ts), [audioHaptics.test.tsx](../../packages/gamekit/test/audioHaptics.test.tsx). Installed Pulsar 1.7.0 source exposes `Settings.getHapticsSupportLevel()` from its public package entry.

## GS-HAPTICS-01 — P2: lifecycle resume overwrites a manual pause

**Evidence: reproduced.** `setPaused` and `bindLifecycle` write the same `paused` flag. Bind a running lifecycle, manually pause, then deliver a running status: `play('impact')` reports `{ played: true }`. The two public controls cannot act as independent gates. Detaching a paused lifecycle also leaves its last value behind without an explicit policy.

**Resolve:** distinguish manual pause from lifecycle pause and compute effective suppression as their OR with background/mute/disposal. Define detach behavior explicitly: remove that source's ownership rather than accidentally treating its final status as a permanent manual pause. Preserve one active lifecycle source and idempotent detach.

**Acceptance:** manual pause survives lifecycle running/foreground; lifecycle pause survives manual unpause; source replacement/detach follows the documented policy; disposed instances cannot resubscribe or play.

## GS-HAPTICS-02 — P2 simplification: use the actual public backend capability API

**Evidence: installed-source-confirmed unnecessary complexity.** Resolver and factory repeatedly try root functions and `TurboModuleRegistry.getEnforcing('RNPulsar')`; the factory can query native support repeatedly for each play. Installed `react-native-pulsar/src/Settings.ts` already exposes `getHapticsSupportLevel`, re-exported through `src/index.tsx`. The private TurboModule path duplicates package internals and bypasses its compatibility workaround.

**Resolve:** use the public Settings API behind one injected adapter, along with public Presets and HapticSupport values. Delete redundant private discovery and fallback branches when the supported version is verified. Cache capabilities only if their lifetime is stable; otherwise query through the single adapter. Preserve fail-closed behavior when support cannot be determined, but distinguish missing installation from unsupported hardware.

**Acceptance:** use a fake shaped like the actual public exports rather than invented root capability functions. Test every supported enum level, missing methods, backend throw, and disposal without importing native peers from headless paths.

## GS-HAPTICS-03 — P3: make throttling deterministic and failure-aware

**Evidence: source-confirmed design limitation.** A global 100 ms throttle uses `Date.now` and updates its timestamp before dispatch, even if dispatch throws. Clock changes can suppress feedback unexpectedly; a failed request consumes the interval. A selection pulse can also suppress a success effect, which may or may not be the intended product policy.

**Resolve:** inject/use a monotonic clock at the adapter seam. Document global throttle priority and whether failed dispatch consumes budget. Prefer one simple rule over per-preset queues; change prioritization only with a concrete game requirement.

**Acceptance:** clock rollback, first request, exact interval boundary, failed dispatch, and competing presets match the chosen policy. Do not queue suppressed haptics to replay after pause.

## Native evidence

`played: true` correctly means dispatched, not proof that hardware vibrated. Keep that distinction. Physical iPhone/Android checks must cover unsupported devices, system suppression, app backgrounding, manual pause, and preset mapping. Do not force universal tactile parity, add custom waveforms, or install another backend to satisfy simulator limitations.
