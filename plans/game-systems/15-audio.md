# Audio playback, mixing, concurrency, and lifecycle

## Purpose and verdict

Play short effects and one music track through an optional native backend, with bounded ownership, volume categories, and explicit pause/mute behavior. **Keep audio outside simulation and root imports. This implementation should become smaller and more transactional, not gain another abstraction layer.**

Sources: [createGameAudio.ts](../../packages/gamekit/src/audio/createGameAudio.ts), [resolver](../../packages/gamekit/src/audio/resolver.ts), [types](../../packages/gamekit/src/audio/types.ts), [audio/haptics tests](../../packages/gamekit/test/audioHaptics.test.tsx). Installed backend inspected: `react-native-audio-api` 0.13.3.

## GS-AUDIO-01 — P1: failed playback leaves a voice occupying concurrency capacity

**Evidence: reproduced with injected backend.** `play` adds a source to `activeVoices` and replaces its reservation in `concurrencyMap` before `source.start()`. If start throws, the catch removes only the original reservation. The failed source remains. The probe's concurrency count stayed **1** after start failure, so a limit-1 effect can remain permanently blocked and idle suspension can be prevented.

**Resolve:** treat source/gain creation, connection, listener setup, reservation transfer, and start as a transaction with one idempotent cleanup. A failed stage must remove both reservation and actual source, detach/end handlers where supported, disconnect owned nodes, and reconsider idle suspension. Keep a visible error result/report.

**Acceptance:** failures in create/connect/start each leave concurrency and active-voice counts at zero; the next valid play succeeds. Normal ended callbacks and disposal do not double-clean a source. Apply the same ownership reasoning to music start failures.

## GS-AUDIO-02 — P2: stop-oldest retains stopped native source wrappers indefinitely

**Evidence: source-confirmed.** The overflow path adds `oldest` to `cancelledReservations` whether it is an in-flight reservation or an already-started source. Only reservation continuations remove entries from that set; `cleanupVoice` does not. Repeated stop-oldest playback accumulates source wrappers until full audio disposal.

**Resolve:** represent pending reservations distinctly from live voices. Only pending work needs cancellation tokens; live voices should use normal stop/cleanup and then lose all owner references. Prefer one small record with an explicit lifecycle over several overlapping sets if it reduces the state space. Do not introduce WeakRefs to hide an ownership bug.

**Acceptance:** thousands of stop-oldest replacements keep every internal collection bounded by configured concurrency plus live pending work; ended/stopped callbacks cannot resurrect or leak entries. Measure native and JS memory plateau.

## GS-AUDIO-03 — P2: remove silent partial initialization and fake capability fallbacks

**Evidence: source-confirmed.** Gain construction/connection, context operations, lifecycle registration, and cleanup use many empty catches. Initialization can return an apparently usable object whose category gain graph failed. The resolver synthesizes a no-op AudioManager when missing, so interruption behavior can silently disappear. Most APIs are repeatedly cast through handcrafted structural types instead of the installed backend types.

**Resolve:** distinguish required graph setup from genuinely optional capabilities. Fail required setup transactionally with context closure and cause preservation. Report optional capability absence explicitly through a bounded diagnostic or documented capability policy. Use installed peer types at the adapter seam; delete duplicate export fallbacks and casts where one verified shape suffices. Do not add fallback audio backends.

**Acceptance:** missing/invalid required gain or manager capabilities cannot falsely report a fully initialized service. Cleanup attempts all resources and preserves primary errors. Optional peer imports remain lazy and headless isolation still passes.

## GS-AUDIO-04 — P2: consolidate pause sources and public lifecycle integration

**Evidence: source-confirmed.** User, session, app, interruption, and mute flags exist, but session pause is only exposed through `_setSessionPaused`, a private property attached to the returned object. Haptics/particles have the public read-only lifecycle source. Native suspend/resume promises are fired without serialization, so rapid intent changes need tests with delayed promises, not only immediate mocks. Interruption observation is backend-global; disposing one audio instance disables it without considering another.

**Resolve:** either adopt one documented `GameLifecycleSource` binding for audio or remove the unused private session channel and state the owner-driven pause contract. Separate independent pause reasons. Serialize/coalesce native context intent to the latest desired state and recheck after awaits. For global interruption observation, choose an explicit singleton ownership contract or a small reference count at the backend seam; do not silently toggle a shared global per instance.

**Acceptance:** manual pause survives foreground/session resume; rapid pause/resume settles to the latest requested state; denied interruption auto-resume still requires explicit action; two instances cannot disable each other's observation. All subscriptions disappear on disposal.

## Scope and performance

All sounds are eagerly decoded, and the public API still carries asynchronous lazy-decode/reservation complexity afterward. Keep it only where required by concurrent playback, or simplify once ownership tests prove a synchronous cached-buffer path suffices. Validate sound membership, positive integer asset IDs, category, volume, and overflow policy before scheduling. If general looping `play` remains public, provide an intentional stopping/ownership policy; otherwise reserve looping for the music API.

Actual audible output, interruption routing, latency, and silence/idle power require devices. Node mocks establish lifecycle logic only. No backend replacement, spatial audio, streaming music, or automatic preload framework is requested.
