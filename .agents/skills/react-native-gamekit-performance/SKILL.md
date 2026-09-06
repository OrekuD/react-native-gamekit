---
name: react-native-gamekit-performance
description: Design, implement, profile, or review high-performance React Native GameKit systems that use React Native Skia, Reanimated 4, Worklets, and Gesture Handler. Use for game loops, render bridges, Canvas scenes, sprites or tilemaps, gesture and pointer input, frame pacing, runtime/thread ownership, iPhone/iPad/Android performance, or any GameKit change that runs every frame. Also use when deciding retained mode versus Picture, Atlas, textures, shaders, UI-runtime animation, or worker runtimes.
---

# React Native GameKit Performance

Build GameKit features around explicit runtime ownership and measured frame cost. Treat React as the lifecycle and composition layer, not the per-frame simulation loop.

This skill supplements `react-native-skia` and `reanimated-skia-performance`. Use those for detailed visual recipes; use this skill to check engine architecture, input pipelines, and performance claims. Its patterns are hypotheses to verify against the installed code and the requested task, not reasons to preserve unnecessary machinery.

## Review from first principles

For each system, state the player-facing purpose, authoritative owner, and smallest contract that serves the current games. Review systems separately and follow dependencies when a boundary spans two systems.

1. Identify what can be deleted without losing required behavior: unused state, duplicate representations, inert flags, compatibility branches for unsupported versions, and diagnostics that run when disabled.
2. Simplify ownership and failure paths before optimizing. A capacity, generation counter, or immutable type is not proof that work is bounded, stale results are rejected, or resources release once; trace the actual callers and cleanup.
3. Separate reproduced defects, source-confirmed contract gaps, and performance hypotheses. Include a concrete trigger, smallest proposed change, and behavioral acceptance criteria. A system with no justified change should be left alone.
4. Respect review-only scope. Write implementation guidance without changing runtime code unless requested. Do not add future-task features to make an audit look complete.

## Start with a compatibility gate

Before proposing APIs or editing code:

1. Inspect the app and library `package.json` files plus the lockfile.
2. Record the installed React Native, Expo, Skia, Reanimated, Worklets, and Gesture Handler versions.
3. Match examples to those versions. Never silently mix RNGH 2 builder APIs with an RNGH 3 project.
4. Check official compatibility pages before upgrading any native dependency.
5. Assume an Expo development build with prebuild is allowed. Do not constrain GameKit to Expo Go.

The manifests and lockfile reviewed on 2026-09-05 pin RN 0.86.2, Expo 57.0.10, Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, and RNGH 3.1.0. This is an inspected repository snapshot, not an upstream compatibility certification. Re-check installed versions before using API examples; historical source notes do not override the installed packages.

Read `references/sources.md` when facts may have changed.

## Choose runtime ownership first

Assign every piece of state to one owner:

- **RN runtime:** React lifecycle, asset readiness, scene changes, menus, persistence, networking, and the v1 authoritative simulation.
- **UI runtime:** gesture sampling, visual interpolation, camera presentation, and Skia/Reanimated values needed for the next frame.
- **Skia renderer/GPU:** drawing commands, batching, filters, shaders, and compositing.
- **Worker runtime:** future opt-in for measured, pure, heavy computation with an explicit message/snapshot boundary.

Do not assume runtimes share a JavaScript heap. Do not create a worker runtime merely to sound more native or more performant.

Read `references/architecture.md` and `references/worklets-threading.md` for the full model.

## Preserve the GameKit frame pipeline

Use this conceptual flow:

```text
input samples -> command buffer -> fixed-step simulation -> render snapshot
              -> UI interpolation -> Skia draw -> frame presented
```

- Keep simulation authoritative and deterministic where practical.
- Run simulation at a fixed rate independent of the display refresh rate.
- Cap catch-up work after stalls; never allow a spiral of death.
- Publish compact render snapshots instead of exposing mutable engine internals.
- Interpolate presentation state when rendering faster than the simulation.
- Keep React and Zustand out of per-frame entity updates. Zustand is appropriate for the playground shell, selection, and durable app-level state.

## Select the Skia representation deliberately

Default in this order:

1. **Retained Canvas nodes** for a stable, modest scene graph whose properties change.
2. **Atlas** for many sprites or tiles sharing a texture.
3. **Picture** for immutable reusable command lists or a variable number of draw commands.
4. **Texture hooks** when UI-runtime drawing can be rendered once and reused as an image.
5. **Runtime shaders and layers** only when their visual value justifies their pixel cost.

Do not convert an entire game to immediate mode without profiling. Do not rasterize groups with `layer` casually. Read `references/skia-rendering.md`.

## Implement frame-safe animation

- Pass shared and derived values directly to supported Skia props.
- Never use React state, a Zustand write, or an RN-runtime callback for every animation frame.
- Never read a shared value during React render.
- Bound required RN/UI crossings by rate and payload size. Coalesced input and sparse tile-window requests are legitimate bridges; keep edges ordered and reject packets from retired owners.
- Disabled instrumentation must do no diagnostic scheduling, timestamp reads, or packet construction on either runtime. A callback that crosses runtimes only to no-op on RN is still work.
- Inspect the complete worklet call graph, including error branches, and the transformed closure. Reading one field of a large captured map/asset/session object may transfer more than intended; extract trusted scalars first and verify.
- Distinguish React topology, SharedValue notification, host-object mutation, and native redraw. When writing Skia buffers outside their hook modifiers, verify the installed notification contract and actual redraw; a mutated mock rect is insufficient evidence.
- Memoize stable frame callbacks and RNGH gesture definitions.
- Use one clock or frame callback per subsystem rather than one per entity.
- Cancel indefinite animations and deactivate frame callbacks during pause or unmount.
- Respect reduced motion for nonessential presentation effects without changing simulation rules.

Read `references/reanimated-runtime.md` before adding a new clock, reaction, or cross-runtime callback.

## Implement game input as state, not navigation

- Wrap the native app close to its root with `GestureHandlerRootView`.
- In this repository, use the RNGH 3 hook API (`useManualGesture` + `GestureDetector`) and the global `GestureStateManager`; the RNGH 2 `Gesture.*()` builder API is legacy in 3.x (types are `Legacy*`-prefixed).
- Sample high-frequency gesture data on the UI runtime and reduce it to compact commands or values.
- Track touches by pointer ID; array order is not stable.
- Use absolute coordinates when the target view itself transforms, then map once into logical game coordinates.
- Resolve pan, pinch, rotation, tap, and platform-navigation conflicts explicitly.
- A game surface must not accidentally activate the iOS interactive-back gesture. Configure the host screen or playground shell; GameKit must not secretly own the consumer's navigator.
- Support iPad aspect ratios, multitouch, Apple Pencil/stylus pointer types, and trackpad gestures where the game design benefits.

Read `references/gesture-input.md` for callback, composition, and version rules.

## Prove correctness, then profile before optimizing

Exercise failure and replacement paths before throughput: late async completion after abort/reacquire, cleanup after partial initialization, pause/resume with queued input, same-size map/source replacement, and disposal while callbacks are pending. Use tests that observe public behavior, not only source text or counters supplied by the implementation.

1. Establish a reproducible stress scene and representative device matrix.
2. Measure a release or `debugOptimized` build; development mode is diagnostic only.
3. Capture frame rate, missed frames, simulation time, draw time, memory, allocations, and input latency.
4. Change one architectural variable at a time, starting with deletion or simpler ownership where possible.
5. Re-run the same scenario and preserve the result as a benchmark or regression test.

Target the whole-frame budget: 16.67 ms at 60 Hz and 8.33 ms at 120 Hz. Leave headroom for the OS, compositor, audio, and transient work.

Record simulation ticks, display callbacks, publications, visible count, allocated capacity, transfer bytes, and total work separately. A per-axis limit can permit excessive total work; culling zero-size slots may still scan full capacity. Stable React topology, mocked native tests, and Node/V8 microbenchmarks do not prove Hermes/UI/GPU performance. If hardware measurements are unavailable, report the gap and a reproducible scenario rather than a performance pass.

Read `references/performance-review.md` for acceptance criteria and symptom-driven diagnosis.

## Reject these anti-patterns

- per-frame React/Zustand writes, unbounded logging, unnecessary diagnostic round trips, or unbounded cross-runtime payloads
- one React component, shared value, clock, or gesture detector per particle when batching is possible
- rebuilding invariant paths, paragraphs, shaders, images, or sprite metadata every frame; dynamic Picture recording requires a measured allocation/draw budget
- large worklet closures that capture the game definition or asset registry
- using `makeMutable` as the public engine state model
- mutating the same value observed by `useAnimatedReaction`
- blindly enabling native feature flags copied from a blog post
- judging performance in a simulator or only on the newest iPhone/iPad
- coupling the 2D simulation API directly to Skia types when a renderer-neutral type works

## Deliverable expectations

For implementation or review work, report:

- runtime ownership and cross-runtime boundaries
- selected render mode and why it fits the entity/draw-command shape
- behavior at 60 Hz and 120 Hz, including pause/resume
- asset-loading and cleanup behavior
- input conflict and coordinate-mapping behavior
- benchmark scenario, build mode, device class, and before/after evidence (or explicitly unmeasured status)
- any version-sensitive or experimental APIs used

Prefer a simple measured solution over a speculative abstraction. Keep renderer and scheduling boundaries narrow for the current 2D games. Preserve useful separation from native rendering without designing an unrequested 3D API.

## Reference map

- Engine/runtime design: `references/architecture.md`
- Skia render modes and GPU cost: `references/skia-rendering.md`
- Reanimated animation and frame callbacks: `references/reanimated-runtime.md`
- Worklet runtimes and memory transfer: `references/worklets-threading.md`
- RNGH 3 game input (hook API, GestureStateManager, renamed callbacks): `references/gesture-input.md`
- Performance audit and benchmark gates: `references/performance-review.md`
- Official pages, pinned revisions, and version caveats: `references/sources.md`
- Refresh official source snapshots: `scripts/sync_official_sources.py`
