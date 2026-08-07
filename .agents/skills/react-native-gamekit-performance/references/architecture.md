# GameKit runtime architecture

## Design goal

Make simple 2D games easy without hiding the facts that determine performance: who owns state, when work runs, how data crosses runtimes, and how a scene becomes draw commands.

Keep the public game definition renderer-neutral enough that a future 3D renderer can reuse lifecycle, input actions, simulation, assets, scenes, and testing tools.

## Runtime ownership

### RN runtime

Own these on the React Native JavaScript runtime:

- game and scene construction
- asset declarations and readiness
- app lifecycle and pause/resume decisions
- navigation and playground state
- persistence, networking, analytics, audio orchestration, and non-frame-critical haptics
- the authoritative v1 simulation and its fixed-step scheduler

Do not use React state as the world store. React should mount the game view and react to coarse events such as score changes, pause, game over, or scene transitions.

### UI runtime

Own latency-sensitive presentation:

- native gesture callbacks
- input sampling that must remain responsive during RN-runtime stalls
- visual interpolation between simulation snapshots
- camera shake, hit flashes, tweens, springs, and shader uniforms
- derived values passed directly to Skia

UI-runtime state is presentation state, not an accidental second authoritative world. If gameplay decisions depend on a gesture, reduce the gesture into a defined input command and consume it at a simulation boundary.

### Skia renderer

Own drawing and compositing. Give it prepared render data; do not make it query React context or the game store per entity.

The Canvas establishes its own renderer/context boundary. Prepare theme, layout, and game data outside the Canvas and pass in only what the draw tree needs.

### Worker runtime

Treat a custom Worklet Runtime as a future optimization. Use it only after profiling proves that a pure computation is crowding the RN or UI runtime.

Good eventual candidates include broad-phase spatial indexing, pathfinding, procedural generation, or bulk transforms. A worker runtime is not a general background version of the RN runtime; it has a separate heap and limited globals. Design an explicit request/result or snapshot contract first.

## Frame pipeline

### 1. Capture input

Normalize platform events into logical actions such as:

```ts
type GameInput =
  | { type: 'pointerDown'; id: number; x: number; y: number; at: number }
  | { type: 'pointerMove'; id: number; x: number; y: number; at: number }
  | { type: 'pointerUp'; id: number; x: number; y: number; at: number }
  | { type: 'action'; name: string; pressed: boolean; at: number };
```

Map physical coordinates into the logical viewport once at the boundary. Preserve pointer identity. Coalesce movement when the simulation only needs the newest sample, but never coalesce discrete down/up/cancel transitions.

### 2. Advance a fixed simulation

Use an accumulator and a fixed `dt`, commonly 1/60 second. The display may refresh at 60, 90, or 120 Hz while game rules advance consistently.

After an app stall:

- clamp the elapsed time accepted into the accumulator
- cap simulation steps per rendered frame
- record dropped simulation time for diagnostics
- avoid trying to replay an unbounded backlog

Pause on app background. On resume, reset the time origin instead of treating the whole background duration as elapsed gameplay.

### 3. Publish a render snapshot

Keep private simulation structures behind the engine boundary. Publish compact immutable snapshots or renderer-facing arrays containing only visible properties:

- stable entity/render IDs
- transform, frame, tint, opacity, and layer
- camera and viewport data
- references to already-loaded asset handles

Prefer structure-of-arrays or batched sprite data when profiling shows object traversal or component count is expensive. Do not expose Skia classes in the core game definition unless the feature is explicitly renderer-specific.

### 4. Interpolate presentation

When render refresh is faster than simulation, interpolate previous and current snapshots using the accumulator fraction. Interpolation changes presentation only; collision and game rules use authoritative simulation state.

Never feed an interpolated position back into the simulation.

### 5. Render

Choose retained nodes, Atlas, Picture, or textures from the actual draw workload. Keep debug overlays optional because counters, text layout, and logs can materially change frame behavior.

## Scene and lifecycle boundaries

Each scene should have explicit hooks for enter, pause, resume, and exit. Cleanup must cover:

- frame callbacks and animations
- gesture state and pending inputs
- audio voices and loops
- timers and subscriptions
- scene-owned Skia resources

Keep app-shell navigation outside the engine. A consumer may use React Navigation, Expo Router, a Zustand screen switcher, or native containers. GameKit can expose pause/exit events without taking control of the host navigator.

## Future 3D compatibility

Preserve these seams from v1:

- `GameDefinition` and scene lifecycle do not import Skia.
- Input actions are semantic and coordinate mapping is isolated.
- Simulation time is independent of renderer callbacks.
- Assets use typed descriptors with renderer-specific loaders behind adapters.
- Rendering consumes snapshots through a narrow adapter.
- Use generic vectors/transforms in core; convert to `SkPoint`, matrices, or future 3D math types in adapters.

Do not prematurely add a 3D scene graph, ECS, or worker runtime to v1. A clean renderer boundary is the useful preparation.

## State-store boundary

Zustand is suitable for the playground catalog and shell:

- current example
- transition state
- developer settings
- last-opened example

It is not the per-frame world database. Subscribing React components to hundreds of changing entity fields defeats the render bridge and makes performance dependent on reconciliation.

Expose coarse observables for HUD data. Update them at semantic boundaries or a deliberately throttled rate rather than on every frame.
