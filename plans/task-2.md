# Task 2: First GameKit runtime vertical slice

## Objective

Prove the first complete GameKit path without committing the project to a
renderer-specific core:

```text
animation-frame driver
  -> fixed-step GameSession
  -> immutable button InputFrame
  -> one functional scene update
  -> previous/current render snapshots
  -> GameView subscription
  -> Skia-rendered object
```

React may render for mounting, layout, and static overlays. It must not become
the simulation or per-frame presentation store.

## Locked API direction

Keep `defineGame` as the pure static definition entry point. Add
`defineScene` for state/snapshot inference and `createGameSession` as a factory
that returns a closure-backed `GameSession` interface, never a constructible
class.

```ts
const definition = defineGame({
  viewport,
  assets: [],
  input: {
    boost: { type: 'button' },
  },
  scenes: {
    play: defineScene({
      actions: ['boost'],
      create: () => ({ x: 40 }),
      update: ({ state, input, deltaSeconds }) => ({
        ...state,
        x: state.x + (input.button('boost').held ? 180 : 60) * deltaSeconds,
      }),
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
})

const game = createGameSession(definition)

game.input.press('boost')
game.input.release('boost')

<GameView game={game}>{/* static React HUD/controls */}</GameView>
```

The headless API is exported from `react-native-gamekit`. The React/Skia view
is exported from `react-native-gamekit/react` so importing the core in Node
does not evaluate React Native or Skia modules.

## Runtime semantics

- The default fixed step is `1000 / 60` milliseconds.
- The first presentation callback establishes a timestamp baseline and does
  not simulate a giant first tick.
- Raw wall time never becomes scene delta time.
- Wall-clock gaps and catch-up updates are bounded to five fixed steps.
- Excess whole-step debt is dropped after the catch-up cap.
- Each presentation callback publishes once, whether it ran zero, one, or
  several simulation updates.
- `start()` starts or resumes a session; `pause()` suspends it. Both are
  idempotent, as are subscription removal and `dispose()`.
- Resume establishes a fresh timestamp baseline and discards suspended time.
- `dispose()` cancels scheduling, invalidates stale callbacks, clears input,
  removes listeners, and disposes the scene once.
- Live operations after disposal throw `GameSessionDisposedError`.
- A failed update pauses the scheduler before rethrowing and cannot schedule a
  successor.

## Input semantics

Task 2 supports one action kind: `button`.

- Platform-facing calls enqueue semantic `press`, `release`, or `cancel`
  changes; they never mutate scene state.
- Each simulation tick samples a new immutable `InputFrame`.
- `pressed`, `released`, and `cancelled` are one-tick edges; `held` persists.
- A press and release between ticks preserves both edges while reporting
  `held: false`.
- Events queued during an update are not visible until the following tick.
- Pausing or disposing neutralizes input to prevent stuck controls.

## Scene and rendering semantics

- The initial scene is created synchronously once per session.
- Scene updates return new state; the runtime does not expose authoritative
  mutable state.
- An initial render snapshot exists before the first update.
- Every update moves `current` to `previous`, then extracts a new `current`.
- `RenderFrame<TSnapshot>` is renderer-neutral and contains `previous`,
  `current`, `alpha`, `tick`, and simulation time.
- Snapshot payloads remain renderer-specific. Do not introduce universal
  transform, camera, material, entity, or renderable types.
- `GameView` receives an externally owned session, starts it while mounted,
  pauses it on unmount, and never disposes it. The creator owns disposal.
- The initial Skia adapter may support one 2D circle snapshot for the
  playground. It updates Skia/Reanimated shared values, never React frame
  state.

## TDD execution

### 1. Core contract tests

- [x] Add a manual frame driver used by tests instead of real time or patched
  globals.
- [x] Add compile-time fixtures for inferred scene state/snapshot/action names
  and readonly public frames.
- [x] Test baseline, fixed delta, interpolation, 120 Hz presentation, irregular
  frame sequences, clamping, and bounded catch-up.
- [x] Test idempotent start/pause/dispose, stale callbacks, resume baseline,
  pause-inside-update, and thrown updates.
- [x] Test button press/hold/release/cancel edges, between-tick transitions,
  catch-up consumption, and the update boundary.
- [x] Test initial/previous/current snapshot flow and removed listeners.

### 2. Core implementation

- [x] Implement the minimal internal frame-driver scheduler.
- [x] Implement the button input buffer and immutable per-tick frame.
- [x] Implement `defineScene`, `createGameSession`, lifecycle errors, render
  frames, and subscriptions.
- [x] Keep all headless source modules free of React Native, React, Skia,
  Gesture Handler, and Reanimated imports.
- [x] Add JSDoc to every exported declaration.

### 3. React/Skia adapter

- [x] Add the `react-native-gamekit/react` entry point.
- [x] Mount one Skia canvas and update presentation values without per-frame
  React state or render props.
- [x] Preserve React children as a static overlay.
- [x] Recompute the surface layout on rotation, resize, and iPad split view
  without recreating the session.

### 4. Playground and documentation

- [x] Replace the bootstrap status card with one scene and one moving Skia
  object.
- [x] Add a pressable control that drives the declared button action.
- [x] Retain live platform/window diagnostics in the overlay.
- [x] Update package/docs API material to describe only the implemented slice
  and keep it marked provisional.

### 5. Verification

- [x] Maintain at least 80% meaningful core line coverage, with stronger
  scheduler/lifecycle/input coverage.
- [x] Run lint, typecheck, tests, coverage, package build, docs build, Expo
  export, and package inspection.
- [x] Confirm the headless root import still works in Node without native
  module evaluation.
- [x] Confirm the playground launches in the active simulator with no native
  or JavaScript error.
- [x] Review source changes for correctness, security, lifecycle leaks, and
  accidental per-frame React work.

## Acceptance criteria

1. Equal simulated wall time at 30, 60, and 120 Hz presentation yields the
   same tick count and state.
2. A large gap executes no more than five updates and does not retain a
   permanent catch-up spiral.
3. Pause/resume/dispose cannot leave stale scheduled work alive.
4. The scene always receives a fixed delta and an immutable tick input frame.
5. Historical render frames remain stable and interpolation alpha stays in
   `[0, 1)`.
6. Core imports and tests do not load native rendering dependencies.
7. `GameView` performs no per-frame React state update.
8. The playground renders and controls one Skia object through the local
   package on phone and resizable iPad layouts.
9. Workspace checks, package output inspection, and simulator smoke pass.

## Explicitly out of scope

- multiple active scenes, scene transitions, `setScene`, or full asynchronous
  scene lifecycle;
- ECS/entities/components, commands/events, physics, and collision;
- Gesture Handler mappings, axes, pointers, multitouch, keyboard, mouse, and
  controllers;
- viewport coordinate conversion beyond mounting/resizing the initial canvas;
- sprites, images, atlases, text, particles, tilemaps, or dynamic render
  topology;
- assets, audio, haptics, serialization, replay, RNG, selectors, diagnostics,
  or accessibility helpers;
- R3F, Expo GL, Filament, 3D spatial types, or a universal renderer adapter.
