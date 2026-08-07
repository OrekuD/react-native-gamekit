# Task 3: Playable 2D game lifecycle

## Objective

Turn the Task 2 runtime proof into one complete, playable 2D game flow while
locking only the next foundational APIs:

```text
named scene lifecycle
  -> deterministic scene transitions
  -> one Viewport2D coordinate authority
  -> Gesture Handler pointer adapter
  -> immutable per-tick pointer input
  -> phone and iPad presentation
  -> shape-based Brick Breaker reference game
```

The user must be able to open the playground, enter the game, start it, move
the paddle, win or lose, restart, resize or rotate the window, and leave the
screen without stale scheduling or input.

This task deliberately uses Skia shapes and example-local collision. Sprites,
assets, and a public physics module remain later vertical slices.

## Product outcome

At the end of Task 3, GameKit should be able to support a small but complete
single-player arcade game rather than only a moving-object demo. The result
must demonstrate:

- more than one named scene;
- transitions initiated by gameplay and by an external caller;
- scene restart and exact resource cleanup;
- one coordinate transform shared by drawing and input;
- direct touch/pointer control expressed in logical game coordinates;
- stable behavior across phone, iPad, rotation, and resizable windows;
- deterministic gameplay tests that do not require React Native or a
  simulator.

The existing bootstrap example remains as the smallest Task 2 sample. Add the
new game as a second playground entry instead of replacing it.

## Locked architectural decisions

- Preserve the functional `defineGame`, `defineScene`, and
  `createGameSession` direction.
- Keep one authoritative, fixed-step `GameSession`. React, Gesture Handler,
  and Skia never own gameplay state.
- Continue returning new scene state from `update`; do not expose mutable world
  state.
- Scene definitions are static. Entering or restarting a scene creates a fresh
  runtime scene instance.
- Session tick and elapsed time remain monotonic across transitions. Add
  `sceneTick` and `sceneElapsedSeconds`, which reset for each scene instance.
- `setScene(currentScene)` is an idempotent no-op. `restartScene()` is the
  explicit operation that recreates the active scene.
- A transition requested during `update` commits after that update completes
  successfully.
- Target scene creation and its initial snapshot must succeed before the old
  scene is replaced. On failure, keep the old scene and its pre-update state,
  leave session tick/time unchanged, pause the session, clean up any partially
  created target, and rethrow the original error.
- A committed transition resets input and interpolation. The first target
  frame has `previous === current` and `alpha === 0`.
- Dispose every created scene instance exactly once.
- Keep scene creation and transitions synchronous in this task. Do not imitate
  asset loading with promises or temporary loading flags.
- Gesture Handler is an implementation detail of the React adapter. Core input
  frames contain semantic actions and plain GameKit values only.
- `Viewport2D` uses React Native layout points, not physical pixels.
- Rendering and hit testing consume the same resolved viewport value.
- Safe-area layout belongs to the React overlay. It must not silently modify
  the logical game world or its coordinate transform.
- Layout changes may update viewport presentation state, but must not recreate
  or reset the `GameSession`.
- Keep scheduler, transition, input-buffer, and testing code spatially neutral.
  `Viewport2D`, `Point2D`, and Skia behavior belong to focused 2D/React
  modules, leaving room for a future 3D adapter with different spatial types.
- Preserve the current playground navigation work. Do not mix unrelated
  navigation or home-screen redesign into this engine task.

## Public API direction

All API examples in this plan are provisional contracts to prove with
compile-time tests before implementation. Do not add aliases or compatibility
wrappers for the Task 2 API: the package is still `0.0.0`, so update the small
surface directly and document the change.

### 1. Scene-discriminated render frames

The current `GameSession` infers its snapshot only from `initialScene`. That
cannot safely represent later scenes with different snapshot shapes.

Preserve the relationship between a scene name and its snapshot by making the
whole render frame a discriminated union:

```ts
type GameRenderFrame<TScenes extends SceneMap> = {
  [TName in keyof TScenes]: RenderFrame<SceneSnapshot<TScenes[TName]>> & {
    readonly scene: TName
  }
}[keyof TScenes]
```

This should allow renderer code to narrow naturally:

```ts
const frame = game.getRenderFrame()

if (frame.scene === 'play') {
  frame.current.ball
}
```

Do not use an untagged union of every snapshot. It would lose the association
between `scene` and `current` and force casts in renderers and tooling.

On a scene transition, publish a hard cut where `previous` and `current` are
both snapshots from the new scene. Never interpolate between two scene types.

### 2. Scene transitions

Keep scene-originated transitions explicit and restricted to each scene's
declared targets:

```ts
const ready = defineScene({
  actions: ['primary'],
  transitions: ['play'],
  create: () => ({ ready: true }),
  update: ({ state, input, transition }) => {
    if (input.pointer('primary').pressed) {
      transition.setScene('play')
    }

    return state
  },
  snapshot: ({ state }) => state,
})
```

- `defineGame` must verify that every declared transition target exists.
- The update-scoped transition collector exposes only `setScene()` and
  `restartScene()`.
- It must not expose the `GameSession` to scene code.
- A repeated identical request in one update is harmless. Conflicting requests
  in one update fail clearly rather than depending on call order.
- A transition controller retained and called after `update` must throw a
  lifecycle error; it is valid only for that update.
- Transition payloads are not included in Task 3. Scenes that need shared
  results must keep that flow inside one scene state until a typed payload
  design is introduced deliberately.

Expose typed external lifecycle operations:

```ts
game.scene
game.setScene('play')
game.restartScene()
```

`game.scene` becomes a live, readonly getter typed as the union of declared
scene names. `setScene` accepts only declared scene names.

While running, an external transition commits at the next fixed-step boundary.
While idle or paused, it commits synchronously and publishes the new frame.
Allow at most one different pending external transition; a conflicting second
request must throw a specific error. An external transition changes scenes but
does not itself advance simulation tick/time.

### 3. Viewport configuration

Replace the current dependent `scale` and `overflow` pair with one source of
truth:

```ts
viewport: {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
}
```

Task 3 supports three explicit modes:

| Mode | Scale rule | Visible result | Input rule |
| --- | --- | --- | --- |
| `fit` | Minimum uniform scale | Entire authored world plus letterbox space | A pointer cannot begin in letterbox space |
| `fill` | Maximum uniform scale | Surface filled; authored edges may be cropped | The full surface is interactive |
| `extend-world` | Fit-scale logical units | Visible world expands on the longer surface axis | The full surface maps into the expanded world |

Breakpoint-driven adaptive layout is a later feature. Do not retain invalid or
ambiguous combinations such as `fit` plus `crop` in the public type.

### 4. Resolved `Viewport2D`

Implement viewport resolution as immutable plain data and pure conversion
functions. Do not put React hooks, Skia values, `Dimensions`, or platform
objects in the headless math module.

A resolved viewport should include:

- actual surface size;
- authored logical bounds;
- visible logical bounds;
- rendered content bounds in surface coordinates;
- one uniform scale;
- surface translation offsets.

Provide focused operations:

```ts
resolveViewport2D(config, surfaceSize)
worldToSurface(viewport, point)
surfaceToWorld(viewport, point)
containsSurfacePoint(viewport, point)
```

- Invalid authored sizes throw a `RangeError` naming the invalid dimension.
- A zero-sized layout is normal before the first layout pass;
  `resolveViewport2D` returns `undefined` until both surface dimensions are
  positive.
- Coordinate conversion remains mathematical outside content bounds. The
  containment operation decides whether a gesture may begin.
- Round trips must be stable within a documented floating-point tolerance.
- Never use `Dimensions.get('window')` as the world or input authority.

### 5. Pointer action

Add one new semantic action kind:

```ts
input: {
  primary: { type: 'pointer' },
}
```

Scenes read it once per simulation tick:

```ts
const pointer = input.pointer('primary')
```

The immutable pointer state should contain:

```ts
interface PointerState {
  readonly active: boolean
  readonly pressed: boolean
  readonly released: boolean
  readonly cancelled: boolean
  readonly pointerId?: number
  readonly position?: Point2D
  readonly delta: Point2D
}
```

Pointer semantics:

- `pressed`, `released`, and `cancelled` are one-tick edges;
- `active` persists while the owning pointer is down;
- movement deltas accumulate between simulation ticks and reset after sample;
- the first pointer owns the action until release or cancellation;
- secondary pointers are ignored in Task 3;
- the release/cancel frame retains the final position, then the next neutral
  frame clears it;
- a pointer cannot begin in `fit` letterbox space;
- after a valid start, movement outside the content still maps through the
  unbounded transform so gameplay can clamp it deliberately;
- pause, scene transition, invalid layout, unmount, and disposal cancel and
  neutralize the pointer;
- platform timestamps and Gesture Handler event objects never enter the
  simulation API.

Expose a small React adapter such as:

```tsx
<GameView game={game} renderer={BrickBreakerRenderer}>
  <GamePointerInput game={game} action="primary" />
</GameView>
```

`GamePointerInput` uses the viewport context owned by `GameView`, covers the
surface, and forwards logical coordinates into the input buffer. The exact
component name may change during the RED contract fixture, but the final API
must remain composable and must not add Gesture Handler-specific props to
`GameView` or the headless package.

## Runtime semantics

### Transition ordering

For a transition requested during a successful update:

1. sample the current scene's input;
2. run its update into a candidate next state and collect at most one
   transition intent;
3. without committing that candidate state or advancing time, create the
   target state and extract its initial snapshot;
4. if preparation fails, dispose the partial target when possible, retain the
   old scene and pre-update state, leave time unchanged, pause, and throw;
5. if target preparation succeeds, advance session tick/time for the
   successful update;
6. dispose the outgoing scene exactly once using its candidate final state;
7. install the new scene with `sceneTick: 0` and
   `sceneElapsedSeconds: 0`;
8. clear all pending/held input;
9. reset accumulated interpolation debt;
10. publish one target frame with `previous === current` and `alpha === 0`.

The next simulation update receives `sceneTick: 1`. Global `tick` and
`elapsedSeconds` continue from the session.

`restartScene()` follows the same algorithm but prepares a new instance of the
current scene. `setScene(currentScene)` does nothing.

### Scene lifecycle boundary

Task 3 intentionally keeps the lifecycle small:

```text
create -> update zero or more times -> dispose exactly once
```

Do not add empty `load`, `enter`, `exit`, `pause`, or `resume` hooks before
asset/service ownership gives them concrete semantics. Session pause/resume
continues to stop and restart scheduling without recreating the scene.

### Presentation and resizing

- `GameView` resolves the viewport from its actual mounted surface.
- Renderers author geometry in logical/world coordinates.
- `GameView` applies or supplies the shared resolved transform without using
  per-frame React state.
- The renderer and `GamePointerInput` consume the same resolved viewport
  instance for a layout revision.
- A resize may cause a React layout update; it must not cause a simulation
  update, scene transition, session recreation, or input jump.
- If resizing temporarily produces an invalid surface, cancel the active
  pointer and suspend drawing until a valid viewport is available.
- React HUD and navigation remain outside the Skia frame loop and may use safe
  area independently.

## TDD execution

Complete each section RED -> GREEN -> refactor. Do not implement the entire
slice and add tests afterward.

### 1. Public contract tests

- [ ] Add realistic compile-time fixtures with `ready`, `play`, and
  `game-over` scenes that return different snapshot shapes.
- [ ] Prove `frame.scene` narrows `previous` and `current` to the corresponding
  snapshot type.
- [ ] Prove `game.scene` and `game.setScene()` use declared scene names.
- [ ] Prove undeclared actions, scene names, and transition targets fail at
  compile time.
- [ ] Prove public render frames, pointer frames, points, and viewport values
  are readonly.
- [ ] Add call-site fixtures for external transition, scene-originated
  transition, restart, pointer sampling, and React cleanup.

### 2. Named scene runtime

- [ ] Replace the captured initial scene with an internal active-scene record.
- [ ] Add typed `scene`, `setScene`, and `restartScene` session members.
- [ ] Add an update-scoped transition collector without exposing the session.
- [ ] Track global and scene-local ticks/times explicitly.
- [ ] Publish a committed transition immediately without waiting for another
  animation frame.
- [ ] Test transitions while idle, running, paused, inside update, and inside a
  render-frame listener.
- [ ] Test same-scene no-op, explicit restart, duplicate request, conflicting
  request, and invalid runtime scene name.
- [ ] Test transition preparation failure, snapshot failure, update failure,
  listener failure, and final session disposal.
- [ ] Test that every created scene instance is disposed exactly once.
- [ ] Test that stale frame callbacks cannot update or resurrect an outgoing
  scene.
- [ ] Test input reset, hard-cut snapshots, interpolation reset, and monotonic
  session time.

### 3. Headless `Viewport2D`

- [ ] Add table tests before math implementation.
- [ ] Cover phone portrait/landscape, iPad portrait/landscape, ultrawide,
  square, and narrow split-view surfaces.
- [ ] Cover `fit`, `fill`, and `extend-world` with exact expected scale,
  offsets, content bounds, and visible world bounds.
- [ ] Test surface/world round trips and all content boundaries.
- [ ] Test letterbox rejection independently from unbounded conversion.
- [ ] Test zero surface size, negative/NaN/infinite values, and invalid logical
  sizes without producing NaN transforms.
- [ ] Keep viewport tests importable in Node with no React Native or Skia
  evaluation.

### 4. Pointer input buffer

- [ ] Add RED tests for begin, move, release, cancel, held ownership, and
  neutral frames.
- [ ] Test multiple movements between ticks and accumulated delta.
- [ ] Test begin/release and begin/cancel occurring between ticks.
- [ ] Test sampling during fixed-step catch-up.
- [ ] Test ignored secondary pointers and ownership transfer only after a
  release/cancel.
- [ ] Test events enqueued during update remain invisible until the next tick.
- [ ] Test pause, transition, restart, invalid layout, and dispose cancellation.
- [ ] Reject unknown actions and calling a button operation on a pointer action
  or a pointer operation on a button action.
- [ ] Keep the buffer platform-neutral and free of Gesture Handler imports.

### 5. Gesture Handler and React/Skia adapter

- [ ] Extract a platform-neutral pointer binding/state-machine seam so most
  adapter behavior can be tested without mounting native views.
- [ ] Implement `GamePointerInput` with the installed Gesture Handler line.
- [ ] Bind one primary pointer safely and ignore secondary pointers.
- [ ] Convert event positions through the current `Viewport2D` before enqueueing
  them.
- [ ] Reject starts outside `fit` content and preserve ownership outside bounds
  after a valid start.
- [ ] Cancel ownership on gesture cancellation, layout invalidation, unmount,
  pause, and scene change.
- [ ] Supply the resolved viewport to Skia through stable shared presentation
  values.
- [ ] Remove duplicated scaling/letterbox math from the bootstrap renderer.
- [ ] Verify `GameView` still performs no per-frame React state update and does
  not dispose the externally owned session.
- [ ] Bind `GameView` to `AppState`: pause when an active mounted game becomes
  inactive/backgrounded and resume only when that binding performed the pause.
- [ ] Verify navigation focus and app backgrounding cannot leave the playground
  game running invisibly; keep navigation-specific focus handling in the
  playground rather than the package.

### 6. Brick Breaker reference game

- [ ] Add a second playground game and home-screen list entry; retain the
  bootstrap example.
- [ ] Use `ready`, `play`, and `game-over` scene definitions.
- [ ] Use pointer position to control a horizontally clamped paddle.
- [ ] Use the initial pointer press to enter play and launch the ball.
- [ ] Add deterministic ball/wall, ball/paddle, and ball/brick collision inside
  the example only.
- [ ] Add a fixed brick layout, brick removal, score, win, bottom-edge loss,
  and restart.
- [ ] Draw everything with Skia shapes and a fixed render topology.
- [ ] Use the scene-discriminated frame and shared `Viewport2D`; do not read
  `Dimensions` in the game or renderer.
- [ ] Keep menus and HUD low-frequency. Do not copy live gameplay positions
  into React state.
- [ ] Make the screen own one session instance and dispose it on final unmount.
- [ ] Pause/resume with navigation focus without recreating the session.
- [ ] Test the game headlessly with the manual frame driver: ready, launch,
  paddle clamp, each collision type, win, loss, transition, and restart.
- [ ] Prove equal scripted input at 30, 60, and 120 Hz presentation reaches the
  same state checkpoints.

### 7. Documentation

- [ ] Update the package README to distinguish the complete Task 3 surface
  from future features.
- [ ] Add docs pages for scene lifecycle and transitions.
- [ ] Add docs pages for viewport modes and coordinate spaces.
- [ ] Add docs pages for pointer input, ownership, and cancellation.
- [ ] Add a Brick Breaker walkthrough covering session ownership and cleanup.
- [ ] Document phone/iPad resize behavior and safe-area separation.
- [ ] Compile every public example as a fixture or exercise it through the
  workspace typecheck.
- [ ] Keep assets, physics, audio, broader input adapters, and 3D clearly marked
  as future work.

### 8. Verification and review

- [ ] Maintain at least 80% meaningful core line coverage, with stronger
  lifecycle, viewport, and input coverage.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test` and `pnpm test:coverage`.
- [ ] Run `pnpm build` and `pnpm pack:inspect`.
- [ ] Run `pnpm build:docs` and `pnpm build:playground`.
- [ ] Confirm the headless package entry loads in Node without evaluating React
  Native, Skia, Gesture Handler, Reanimated, or other platform modules.
- [ ] Inspect the built tarball exports and declarations for accidental internal
  modules or missing public JSDoc.
- [ ] Review the implementation for lifecycle leaks, mutation of public data,
  swallowed errors, and per-frame React work.
- [ ] Smoke-test an iPhone simulator in portrait and landscape.
- [ ] Smoke-test an iPad simulator in portrait and landscape.
- [ ] Resize the iPad game surface while playing and verify that session
  identity, simulation state, drawing/input alignment, and pointer cleanup
  remain correct.
- [ ] Navigate into, restart, leave, and re-enter the game repeatedly with no
  native/JavaScript error or stale callbacks.

## Acceptance criteria

1. Scene names and heterogeneous scene snapshots remain fully inferred from
   the game definition.
2. Invalid action, scene, and declared transition names fail during typecheck;
   invalid runtime calls throw clear errors.
3. Scene transition and restart ordering is deterministic in every session
   status.
4. A failed target scene preparation cannot destroy the current scene, and
   every created scene instance is eventually disposed exactly once.
5. No render frame interpolates between two different scenes.
6. Global time remains monotonic and scene-local time resets on transition and
   restart.
7. Button and pointer input are neutral after pause, transition, restart,
   cancellation, invalid layout, unmount, and disposal.
8. All supported viewport modes resolve deterministically and round-trip
   coordinates within tolerance.
9. Drawing and hit testing use one resolved transform, including after phone or
   iPad resize and rotation.
10. Brick Breaker can be opened, started, played, won or lost, restarted, and
    exited cleanly.
11. The same scripted gameplay produces the same checkpoints at 30, 60, and
    120 Hz presentation.
12. The headless entry remains free of native-module evaluation and the React
    adapter performs no per-frame React state update.
13. Workspace checks, package inspection, documentation build, Expo export,
    and simulator smoke tests pass.

## Explicitly out of scope

- public ECS, entities/components, generic commands/events, or a shared world;
- public collision, rigid-body physics, or physics-engine integration;
- sprites, textures, atlases, sprite animation, fonts, particles, or tilemaps;
- asset loading, preload progress, audio, and haptics;
- asynchronous scene loading, transition payloads, scene stacks, overlays, or
  multiple active scenes;
- multitouch gameplay, virtual sticks, axes, keyboard, controllers, mouse
  hover, and recorded input/replay;
- cameras, scrolling worlds, parallax, and culling beyond the surface/world
  mapping owned by `Viewport2D`;
- React HUD selectors, save state, inspectors, diagnostics, and generated CLI
  tooling;
- adaptive breakpoint layouts beyond the three viewport modes;
- R3F, Expo GL, Filament, 3D rendering, or universal 2D/3D spatial types.

## Completion handoff

When implementation is complete:

1. mark every finished checkbox in this file;
2. record any deliberate API change or deferred requirement directly under the
   relevant section;
3. include exact verification commands and simulator/device configurations in
   the completion summary;
4. do not mark Task 3 complete while any acceptance criterion is unverified.
