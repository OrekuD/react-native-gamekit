# Performance review and benchmark gate

## Define the target first

Record the intended device and refresh-rate envelope before optimization:

- low/mid Android phone at 60 Hz
- current iPhone at 60/120 Hz as supported
- iPad at representative 60/120 Hz and native pixel density
- landscape and portrait if both are supported
- warm and cold asset states
- foreground, pause/background, and resume

Use physical hardware for final judgments. Simulators are useful for correctness and tooling, not trustworthy GPU/frame-pacing acceptance.

## Whole-frame budgets

- 60 Hz: 16.67 ms per presented frame
- 90 Hz: 11.11 ms
- 120 Hz: 8.33 ms

These are total deadlines shared with the OS, renderer, composition, and other work. A subsystem consuming the full number has already failed. Choose budgets with headroom and report percentile behavior, not only an average.

The authoritative simulation can remain fixed at 60 steps per second while presentation renders at 120 Hz. Interpolate snapshots rather than doubling game-rule work automatically.

## Benchmark scenes

Maintain a small deterministic suite:

1. **Baseline:** one camera, a few sprites, no expensive effects.
2. **Sprite stress:** growing Atlas instance count with movement and culling.
3. **Dynamic commands:** trails/projectiles whose command count changes.
4. **Effects stress:** bounded blur, shader, transparency, and offscreen layers.
5. **Input stress:** multitouch pan/pinch/rotation while the scene is busy.
6. **Lifecycle:** repeated enter/pause/resume/exit to detect leaks.
7. **Tablet fill-rate:** fullscreen scene at iPad resolution and 120 Hz where available.

Seed randomness and keep inputs replayable so changes are comparable.

## Build modes

Use development builds to inspect correctness and diagnostics. Use release or Reanimated's supported `debugOptimized` mode for performance conclusions.

Record:

- commit and dependency versions
- device/OS and refresh-rate setting
- build mode
- benchmark scene/seed/duration
- thermal state when practical
- median, p95, and p99 timings or missed-frame counts

Do not compare one warm run to one cold run and call it a result.

## Metrics

At minimum capture:

- presented FPS and missed/janky frames
- simulation step duration and catch-up step count
- UI-thread/frame callback duration
- Skia/GPU render cost where tools expose it
- JS and native memory over time
- allocation/GC spikes
- input-to-visible-response latency
- texture/image count and approximate memory
- scene enter/exit resource balance

Add cheap counters behind a development flag, but disable debug overlays for final performance captures.

## Symptom-driven diagnosis

### Smooth animation until RN JavaScript is busy

Likely causes:

- visual state is driven by React renders
- gesture callbacks cross to RN on every update
- shared values are read synchronously from RN

Move presentation to UI-owned values, reduce crossings, and keep semantic events coarse.

### JS and UI timings look fine but frames still drop

Likely causes:

- GPU fill rate or overdraw
- large blur/filter layers
- oversized textures or frequent texture uploads
- too many pixels on tablet/high density

Reduce effect bounds, overdraw, resolution, and texture churn. Profile the GPU path.

### Frame time grows with entity count

Likely causes:

- one React/Skia node or callback per entity
- missing culling
- repeated sorting or allocation
- inappropriate retained tree for a highly dynamic command list

Compare retained nodes with Atlas/Picture and batch visible entities.

### Periodic spikes

Likely causes:

- allocation and garbage collection
- path/paragraph/shader reconstruction
- asset decode/upload during play
- logs, analytics, audio creation, or haptics in a hot path

Preload, reuse, move side effects to event queues, and inspect p99 rather than averages.

### Jank only during touch

Likely causes:

- RN-runtime work in `onUpdate`
- unstable/recreated gesture objects
- per-touch hit tests that scan the full world
- gesture conflicts repeatedly cancelling/activating recognizers

Keep sampling on UI, use a spatial index or bounded candidate set in the appropriate owner, and define composition explicitly.

### Good at 60 Hz, poor at 120 Hz

The available frame time halved. Check:

- whether the display is actually allowed to reach 120 Hz
- UI/frame callbacks that do duplicate simulation work
- full-screen pixel effects
- one-clock-per-object patterns
- work that scales with presented frames rather than simulation steps

## Render-path review

- stable draw tree uses retained mode
- shared sprite/tile field considers Atlas
- variable command list considers Picture
- offscreen texture work is reused
- only visible entities are submitted
- z-order sorting is stable and bounded
- paths, effects, paragraphs, fonts, and images are reused
- layer/filter bounds are minimized
- no per-frame React reconciliation is required

## Runtime review

- every state value has one authoritative owner
- worklet captures are small
- no `scheduleOnRN`/`scheduleOnUI` stream in the hot path
- frame callbacks are centralized and lifecycle-controlled
- reactions cannot self-trigger
- indefinite animations are cancelled
- worker runtime, Bundle Mode, and feature flags are opt-in and version-gated

## Input review

- pointer IDs and cancellation are handled
- logical viewport transform is correct under letterboxing and safe areas
- surface detector count is bounded
- screen-edge navigation conflict is resolved by the host
- multi-touch behavior is tested cross-platform
- iPad trackpad/stylus behavior is deliberate

## Memory and lifecycle review

- scene exit removes callbacks, timers, subscriptions, audio voices, and inputs
- image/font/texture references do not grow across repeated scene entry
- backgrounding pauses simulation and resets elapsed-time origin
- resume does not trigger unbounded catch-up
- development hot reload does not leave custom runtime work running

## Feature-flag policy

Native Reanimated/Worklets feature flags can improve specific bottlenecks, but they change by version and may affect touch hit testing. A flag is acceptable only when:

1. the exact installed version documents it
2. a benchmark exposes the corresponding bottleneck
3. correctness tests cover gestures and layout
4. results are recorded before and after
5. the native rebuild and rollback path are documented

Prefer RNGH `Pressable`/`GestureDetector` over relying on Fabric hit testing when using fast synchronous prop-update paths, as recommended by the Reanimated performance guide.

## Acceptance gate

A frame-sensitive change is ready when:

- correctness tests pass for simulation and coordinate mapping
- the stress scene stays within the stated device/refresh target
- p95/p99 do not hide periodic visible stalls
- memory stabilizes across repeated scene lifecycle cycles
- input remains responsive under RN-runtime load
- there is no regression at both 60 and 120 Hz targets
- the result includes reproducible commands/steps and device/build metadata

If no measurement exists, describe the change as an architectural hypothesis, not a performance improvement.
