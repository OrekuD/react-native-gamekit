# Reanimated frame-runtime guide

## Choose the smallest primitive

- `useSharedValue`: state that must update or be observed on the UI runtime.
- `useDerivedValue`: pure value derived from other shared values.
- `useAnimatedReaction`: side-effectful response to a value transition.
- `useFrameCallback`: one callback per display frame when animation modifiers are insufficient.
- `useTimestamp`: a shared frame timestamp; reuse one instance rather than creating clocks per entity.
- `withTiming`: a duration-based tween.
- `withSpring`: interruptible physical or duration-configured spring.
- `withDecay`: momentum after release.
- `cancelAnimation`: interrupt or clean up an active shared-value animation.

Do not build a manual game loop with hundreds of animation primitives when the engine already owns simulation time.

## Shared-value rules

- Never read or write a shared value during React render.
- RN-runtime reads synchronize with the UI runtime and can block. Avoid them in hot paths.
- RN-runtime writes are asynchronous from the UI runtime's perspective; UI-runtime writes are immediate on that runtime.
- Prefer `.get()` and `.set()` in React Compiler-compatible application code when supported by the installed version.
- Pass the shared-value object directly into supported Skia props rather than reading it on the RN runtime.
- Do not store functions in a shared value.
- Reassign object values to make changes observable. For very large objects/arrays, evaluate `.modify()` only within a private adapter and measure it.

Keep shared values focused on presentation. An entire entity graph in one shared value creates costly copying, weak ownership, and hard-to-debug synchronization.

## Derived values and reactions

Use a derived value for pure projection:

```ts
const renderTransform = useDerivedValue(() => [
  { translateX: positionX.get() },
  { translateY: positionY.get() },
]);
```

Use a reaction only when a transition causes a side effect. Never update the same shared value read by the reaction's `prepare` function; that can create an infinite loop.

Do not schedule an RN-runtime callback from a reaction every frame. Accumulate or edge-detect on the UI runtime and cross only for semantic events.

## Frame callbacks

`useFrameCallback` receives:

- a timestamp
- time since the previous callback, which is `null` for the first frame
- time since the callback became active

A display frame is roughly 16.67 ms at 60 Hz and 8.33 ms at 120 Hz. Never assume the delta is fixed, and never advance authoritative physics directly by an unbounded display delta.

Memoize a stable callback and activate/deactivate it with scene lifecycle. Prefer one subsystem callback that updates a batch over one callback per entity.

Use `useTimestamp` when many consumers only need a common clock. It wraps a frame callback; creating one per sprite defeats the purpose.

## Animation modifiers

### Timing

Use `withTiming` for predictable UI presentation such as fades, scene-shell transitions, color/tint changes, or deterministic visual easing. Keep game-rule timers in the simulation clock.

### Spring

Use `withSpring` for tactile UI and nonauthoritative presentation. Reanimated supports physics-based and duration-based configurations; do not combine mutually exclusive options. Clamp or limit game-camera effects intentionally.

### Decay

Use `withDecay` for inertial camera or object presentation following gesture velocity. Apply bounds/rubber-banding deliberately. Convert point-per-second gesture velocities into the coordinate space expected by the camera.

### Reduced motion

Use modifier `reduceMotion` options or `useReducedMotion` for presentation. Reduced motion should suppress camera shake, ambient loops, or large transitions without changing collision timing or player input semantics.

## Worklet closure discipline

Workletization copies captured values to another runtime. Avoid capturing:

- the game definition
- entity maps
- asset registries
- React props objects when only one scalar is needed
- logging/configuration clients

Extract small primitives before defining the worklet. A worklet should be short-running; expensive algorithms belong in the simulation or a measured worker-runtime experiment.

Gesture callbacks chained directly in supported RNGH APIs can be auto-workletized. Extracted callbacks or callbacks hidden behind unsupported wrappers may need an explicit `'worklet';` directive. Verify with the installed RNGH/Reanimated versions.

## Cross-runtime scheduling

Current Worklets APIs are `scheduleOnUI` and `scheduleOnRN`; older `runOnUI` and `runOnJS` examples are historical/deprecated in current docs.

Use a cross-runtime hop for discrete events:

- game over
- scene request
- asset load completion
- analytics checkpoint
- haptic/audio command that is owned outside the UI runtime

Do not use it for pointer moves, entity positions, particles, or a per-frame HUD counter.

Functions passed to `scheduleOnRN` must exist in RN-runtime scope. Do not define the target inside a UI worklet and expect it to be callable on the RN runtime.

## `makeMutable` policy

Reanimated documents `makeMutable` as an advanced API whose behavior may change and generally discourages its use. It also lacks React lifecycle cleanup.

Do not expose it as GameKit's state API. If a private, non-hook adapter absolutely needs it:

- isolate it behind a module boundary
- define ownership and cleanup
- cancel infinite animations
- test hot reload and scene disposal
- be prepared to replace it across Reanimated upgrades

## Debugging and global configuration

Wrap Metro with the official Reanimated configuration when the installed version supports it to improve call stacks. Accurate worklet call stacks and cross-runtime stack traces can add development overhead; profile release behavior separately.

A reusable library must not call `configureReanimatedLogger`, because that changes global app behavior. Document recommended app-owned diagnostics instead.

## Reanimated performance flags

Feature flags are version-specific native build switches, not universal fixes. Before enabling one:

1. Verify the flag exists in the exact installed minor/patch.
2. Link the symptom to the flag's purpose.
3. Benchmark before and after.
4. Test interaction correctness; synchronous UI-prop flags can affect Fabric hit testing.
5. Rebuild native projects after static flag changes.

Expo prebuild supports native/static configuration. Expo Go limitations are irrelevant to this project's supported workflow.
