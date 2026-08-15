# Task 12: Camera2D, render layers, and visibility culling

## Status

**Not started.** This task adds an opt-in 2D camera system shared by rendering
and pointer input, then builds deterministic visibility culling and render
layers on that foundation.

Task 12 depends on the canonical geometry contracts from Task 11. T12.0 may
inventory the existing viewport and input pipelines while Task 11 is underway,
but implementation must not create competing `Point2D`, `Vector2D`, or
`Aabb2D` types.

## Objective

A game author must be able to build a world larger than the screen, follow a
player, zoom or rotate the view, and keep touches aligned with the visible
world without manually duplicating transform math:

```tsx
const camera = defineGameCamera2D({
  select: (frame) => frame.current.camera,
});

export function PlatformGame() {
  const game = useGameSession(createPlatformSession);

  return (
    <GameView
      game={game}
      renderer={PlatformRenderer}
      camera2D={camera}
    >
      <GamePointerInput game={game} action="move" />
    </GameView>
  );
}
```

The renderer must consume the camera already presented by `GameView`, not
create a second copy:

```tsx
function PlatformRenderer({ frame, viewport, camera }: GameRendererProps) {
  return (
    <GameWorld2D viewport={viewport} camera={camera}>
      <GameLayer2D parallax={{ x: 0.25, y: 0.25 }}>
        <Background frame={frame} />
      </GameLayer2D>
      <GameLayer2D>
        <Level frame={frame} />
      </GameLayer2D>
    </GameWorld2D>
  );
}
```

The exact names may change during T12.0 only when compile fixtures demonstrate
a smaller or safer public contract. The ownership and alignment guarantees in
this plan are mandatory.

## Why this task follows collision

The current viewport maps one authored logical world directly into a surface.
`GameWorld2D` applies only the viewport offset and scale; it is deliberately
not a camera. That is enough for a single-screen game, but it cannot express a
scrolling level, player follow, zoom, rotation, parallax, or world-space
visibility.

A camera also affects more than drawing. If rendering uses one transform while
pointer input uses another, players touch one location and the game receives a
different world coordinate. The package therefore needs one authoritative
presented camera binding before adding tilemaps, large particle fields, or
other systems that rely on culling.

Task 11 supplies canonical world bounds and collision geometry. Task 12 reuses
those values for camera bounds and visibility without coupling collision
decisions to rendering.

## Product principles

The camera API must keep simple games simple while making advanced behavior
explicit.

- A game with no camera configuration must behave exactly as it does today.
- `GameView` owns one primary presented camera for its renderer and pointer
  adapters.
- Camera state is authored game data, not React component state updated every
  frame.
- Rendering and input must read the same transform generation.
- Camera movement never changes collision geometry or simulation ownership.
- Culling changes what is drawn, never what is simulated.
- Public names remain explicitly 2D so future 3D systems can use independent
  contracts.
- The default path must not require an ECS, tilemap, physics engine, or native
  dependency.

## Transform model

The implementation must separate three coordinate spaces and define their
composition precisely.

1. **World space** contains authored positions, collision geometry, and camera
   targets.
2. **Logical view space** is the camera's visible authored area before the
   existing viewport policy is applied.
3. **Surface space** contains React Native layout coordinates and native touch
   coordinates.

The complete mapping is:

```text
world point -> camera transform -> logical view point -> viewport -> surface
```

For a camera center `C`, world point `P`, zoom `Z`, rotation `R`, and logical
view center `L`, the conceptual forward transform is:

```text
logical = L + rotate(P - C, -R) * Z
surface = viewport(logical)
```

The inverse must reverse the same operations in reverse order:

```text
logical = inverseViewport(surface)
world = C + rotate((logical - L) / Z, R)
```

Implementation code may optimize the matrix operations, but public tests and
documentation must use one convention. Rotation is expressed in radians,
positive rotation follows the established Skia coordinate convention, and
zoom is a finite number greater than zero.

### Identity behavior

Compatibility is a contract, not an approximation. When `camera2D` is absent,
`GameView`, `GameWorld2D`, and `GamePointerInput` must continue through the
existing viewport path without introducing a camera object, extra transform,
different rounding, new clipping, or a pointer-generation reset.

An explicit identity camera must visually match the no-camera path within the
documented floating-point tolerance. The implementation must still retain a
fast compatibility branch for callers that do not opt in.

### Camera data

The minimum public camera value must stay serializable and native-free:

```ts
export interface Camera2D {
  readonly center: Point2D;
  readonly zoom: number;
  readonly rotationRadians: number;
}
```

Defaults may be supplied by `createCamera2D` or the camera binding, but every
published camera must resolve to a complete validated value. Do not add Skia
matrices, Reanimated shared values, React refs, mutable methods, or viewport
dimensions to the public authored value.

### One authoritative binding

The camera cannot live only inside a renderer because `GamePointerInput` is a
sibling that also needs the inverse transform. The recommended ownership model
is a static camera binding supplied to `GameView`:

```ts
const camera = defineGameCamera2D({
  select: (frame) => frame.current.camera,
});
```

`GameView` evaluates the selector against committed frames, presents the
camera using the existing interpolation clock, and publishes the resulting
read-only binding to the renderer and pointer surface through the same
generation. React must not receive per-frame camera state.

T12.0 must compare this contract against a direct selector prop and embedding a
mandatory camera in every frame. Keep the static binding unless compile
fixtures prove another option is materially simpler while preserving shared
ownership.

## Presentation and interpolation

Camera presentation must follow the engine's fixed-update, interpolated-render
model.

- Select the previous and current authored camera from the same commit frame
  used by the renderer.
- Interpolate center and zoom using the presented frame alpha.
- Interpolate rotation across the shortest angular arc.
- Snap instead of interpolating across scene changes, session replacement,
  binding-generation changes, explicit camera cuts, or invalid prior data.
- Freeze the presented camera while the session is paused.
- Resume without simulating or visually interpolating through background time.
- Never drive camera presentation with React state, timers, or wall-clock
  callbacks.

The binding needs an explicit cut mechanism. A monotonically increasing
`cutId` or equivalent immutable signal is preferable to guessing from distance
because games legitimately teleport over large distances while still choosing
whether to interpolate.

## Pointer and coordinate guarantees

Pointer mapping is part of the camera feature, not a later integration task.

`GamePointerInput` must first apply the existing surface and viewport
containment policy. When the event is accepted, it must inverse-map through the
exact presented camera generation used to draw that frame. The resulting
action payload contains world coordinates.

The following rules must be explicit and tested.

- `surfaceToWorld2D(worldToSurface2D(point))` round-trips within tolerance.
- Fit-mode letterbox rejection occurs before camera inversion.
- Fill and extend-world policies retain their current containment semantics.
- Camera motion during an owned drag does not cancel pointer ownership.
- Each move uses the currently presented camera, so input continues to match
  what the player sees.
- A hard camera cut does not synthesize pointer events or reset the input
  buffer unless the existing session or layout policy requires it.
- Rotation, zoom, safe areas, split view, and tablet layouts use the same
  forward and inverse transform.
- A parallax layer never silently changes the primary gameplay input mapping.

Do not expose two independent helpers that can drift. Public conversion helpers
must delegate to the same pure transform implementation used by the runtime.

## Camera behavior helpers

Task 12 must include small pure helpers for common camera behavior without
turning Camera2D into a stateful controller.

### Follow and dead zones

Provide deterministic helpers that compute a new immutable camera value from
the previous camera, a target, and fixed-step delta. Support direct follow, an
axis-aligned dead zone, optional per-axis follow, and a documented damping or
half-life model.

The helper must not read a React ref, device clock, frame callback, or global
singleton. Games may call it inside their existing scene update function and
store the returned camera in scene state.

### World bounds

Provide a pure clamp helper that keeps the visible camera region inside an
`Aabb2D` world bound at the current zoom. When the world is smaller than the
visible region on an axis, center that axis rather than oscillating between
impossible edges.

Rotation makes exact rectangular containment more expensive. T12.0 must choose
and document either conservative enclosing-AABB containment or exact corner
containment. The default must be stable near boundaries and must not jitter.

### Deterministic shake

Camera shake must be reproducible from explicit state such as a seed, elapsed
simulation time, duration, and amplitude. Do not call `Math.random()` during
presentation.

Shake affects only the presented camera. Collision and gameplay state continue
to use world coordinates. Because the screen visibly moves, pointer inversion
must include the same shake transform so a visible target remains touchable.
The shake sampler must stop at a deterministic endpoint and return the
unmodified base camera after completion.

## Render layers and parallax

Layers provide a small rendering primitive, not a new scene graph.

The proposed API is:

```tsx
<GameWorld2D viewport={viewport} camera={camera}>
  <GameLayer2D parallax={{ x: 0, y: 0 }}>
    <Sky />
  </GameLayer2D>
  <GameLayer2D parallax={{ x: 0.5, y: 0.5 }}>
    <Mountains />
  </GameLayer2D>
  <GameLayer2D>
    <World />
  </GameLayer2D>
</GameWorld2D>
```

The default parallax factor is `{ x: 1, y: 1 }`. Zero produces a camera-fixed
background on that axis. JSX order remains render order; Task 12 must not add a
second z-index scheduler or sort gameplay entities every display frame.

Screen-space controls, scores, pause overlays, and back buttons remain React
Native siblings outside `GameWorld2D`. The package must document this boundary
so camera transforms never make app chrome drift or intercept gameplay input.

Rotation and zoom behavior for parallax must be chosen in T12.0 and covered by
fixtures. Do not silently apply parallax to translation while producing an
undefined or accidental zoom/rotation policy.

## Visibility and culling

The camera must expose pure, headless visibility data so renderers can avoid
drawing large off-screen populations.

Required capabilities include:

- Compute the visible world polygon or conservative world `Aabb2D` from a
  resolved viewport and camera.
- Test an `Aabb2D`, circle, or point against the visible region.
- Accept optional world-space padding for sprites and effects that extend
  beyond their logical bounds.
- Filter indexed or array-backed render records without changing their stable
  order.
- Reuse Task 11 broad-phase geometry where that improves large-scene queries,
  without making collision a rendering dependency cycle.
- Integrate with `SpriteBatch` without reallocating its fixed-capacity buffers
  or changing slot identity for every camera move.

Culling is presentation-only. An off-screen entity remains in the simulation,
continues moving, collides normally, can emit audio, and can re-enter view. The
package must not advertise culling as a gameplay optimization.

For rotated cameras, the broad visibility region may be a conservative AABB,
but narrow visibility tests must document whether they use the actual view
polygon. False positives are acceptable for conservative rendering; false
negatives that pop visible objects out are not.

## Scope

This milestone covers one primary 2D camera per `GameView` and the rendering
features that depend directly on it.

### Included

The implementation must deliver the following capabilities.

- Public immutable `Camera2D` data and validation.
- Pure forward and inverse point, vector, and bounds transforms.
- A static camera binding selected from committed game frames.
- UI-runtime presentation using the existing interpolation clock.
- Explicit camera cuts and session-generation safety.
- Shared renderer and pointer ownership of one presented transform.
- Follow, dead-zone, bounds, and deterministic shake helpers.
- `GameWorld2D` camera integration.
- Ordered `GameLayer2D` rendering with explicit parallax.
- Headless visibility calculation and conservative culling.
- `SpriteBatch` culling integration.
- A scrolling reference-game update and a focused Camera Lab.
- Compile fixtures, unit and integration tests, performance evidence,
  documentation, and agent workflow instructions.

### Explicitly deferred

The following capabilities must remain outside Task 12.

- Perspective cameras, depth buffers, meshes, lighting, or any 3D API.
- Split-screen, picture-in-picture, portals, minimaps, or multiple simultaneous
  gameplay cameras in one `GameView`.
- Tilemap formats, tile streaming, navigation meshes, or world chunk storage.
- Render-to-texture, post-processing stacks, camera filters, or shader graphs.
- Occlusion culling, spatial audio attenuation, or visibility-driven gameplay.
- A mandatory ECS camera component or automatic entity-follow registration.
- React state updates on camera movement.
- Automatic gesture recognizers for pan, pinch, or rotate editor controls.
- Pixel-perfect snapping policies for every art style.
- Camera-aware physics or collision-coordinate rewrites.

These may build on the Task 12 transform and visibility contracts later.

## Public API requirements

The API must be useful from the package root and remain headless where React is
not required.

### Pure exports

T12.0 must freeze a minimal set of names comparable to the following surface:

```ts
export interface Camera2D {
  readonly center: Point2D;
  readonly zoom: number;
  readonly rotationRadians: number;
}

export interface CameraCut2D {
  readonly camera: Camera2D;
  readonly cutId: number;
}

export function createCamera2D(
  value?: Partial<Camera2D>,
): Camera2D;

export function worldToLogical2D(
  point: Point2D,
  camera: Camera2D,
  logicalView: Aabb2D,
): Point2D;

export function logicalToWorld2D(
  point: Point2D,
  camera: Camera2D,
  logicalView: Aabb2D,
): Point2D;

export function getCameraVisibleBounds2D(
  camera: Camera2D,
  logicalView: Aabb2D,
): Aabb2D;
```

Convenience surface conversion may be public, but it must accept the package's
resolved viewport type and delegate to canonical viewport and camera math. Do
not create a second viewport representation for the camera module.

### React exports

The React integration must be small and declarative:

```ts
export function defineGameCamera2D<TFrame>(
  definition: GameCamera2DDefinition<TFrame>,
): GameCamera2DDefinition<TFrame>;
```

`GameView` accepts an optional camera binding and supplies the read-only
presented camera to its renderer. `GamePointerInput` discovers that binding
from the mounted game surface; authors must not repeat `camera={camera}` on the
pointer adapter.

Avoid a public imperative `camera.moveTo()` object in this milestone. Games
already own deterministic state transitions, so their update function must
produce the next authored camera.

### Error behavior

Public construction and transform helpers must fail close to invalid data.

- Reject non-finite centers, zoom, rotation, bounds, and padding.
- Reject zero or negative zoom.
- Reject malformed logical views and incompatible viewport data.
- Identify the operation and invalid field in errors.
- Do not silently coerce strings, nulls, or infinity.
- Do not mutate or annotate caller-owned camera values or thrown errors.
- Return normal visibility misses as `false` or an empty result, not errors.

## Proposed source organization

Use feature-oriented modules and keep headless camera math out of React files.

```text
packages/gamekit/src/
├── camera2d/
│   ├── types.ts
│   ├── validation.ts
│   ├── transform.ts
│   ├── interpolation.ts
│   ├── follow.ts
│   ├── bounds.ts
│   ├── shake.ts
│   ├── visibility.ts
│   └── index.ts
├── react/
│   ├── camera2d/
│   │   ├── defineGameCamera2D.ts
│   │   ├── createPresentedCameraBinding.ts
│   │   └── GameLayer2D.tsx
│   ├── GameView.tsx
│   ├── GameWorld2D.tsx
│   └── GamePointerInput.tsx
└── index.ts
```

Adapt the exact paths to existing package conventions. Do not create a generic
`camera/` namespace that later forces 2D and 3D values into one type.

## T12.0: Inventory and freeze the contract

This task must establish the current transform pipeline and public invariants
before any implementation changes.

### Work

Perform a narrow inventory of `GameView`, `GameWorld2D`, viewport resolution,
the shared surface binding, frame interpolation, `GamePointerInput`,
`SpriteBatch`, and the Sprite Field example. Record the actual order of
transforms and the ownership of every shared value.

Create compile fixtures for the expected author experience:

- A game with no camera and no API changes.
- A game with a static camera.
- A discriminated-scene game whose camera selector handles every scene.
- A headless import of all pure camera helpers from `rn-gamekit`.
- A renderer receiving a correctly typed presented camera.
- A pointer adapter that does not repeat the camera binding.
- A layer with default and per-axis parallax.
- An invalid 3D or mutable camera shape rejected by TypeScript.

Compare the static binding, direct selector prop, and mandatory-frame-field API
options. Record the selected contract and why it keeps renderer and input
atomic. Freeze coordinate spaces, rotation direction, transform order,
rounding tolerance, cut semantics, and absence behavior before T12.1.

### Acceptance

T12.0 is complete when the fixtures express the smallest intended API, the
existing no-camera path has a baseline, and the decision record removes all
ambiguity about transform order and ownership.

## T12.1: Implement pure Camera2D math

This task creates the native-free transform foundation used everywhere else.

### Work

Add immutable camera data, validation, forward and inverse point transforms,
vector transforms, bounds transforms, and viewport composition helpers. Reuse
the Task 11 geometry and existing viewport types.

Write RED tests before implementation for:

- Identity translation, positive and negative world coordinates.
- Zoom in, zoom out, and invalid zoom.
- Quarter, half, negative, and wrapped rotations.
- Non-origin logical view bounds.
- Forward/inverse round trips across representative values.
- World/surface round trips through fit, fill, and extend-world viewports.
- Safe-area and split-view surface sizes.
- Immutability of every input.
- NaN, infinity, negative sizes, and malformed values.

Prefer explicit scalar math over allocating general matrix objects in the hot
path. If matrices are exposed internally, prove their multiplication order
with the same fixtures.

### Acceptance

T12.1 is complete when pure camera math runs in Node, has no React or native
imports, and all runtime integrations can delegate to it without duplicating a
formula.

## T12.2: Add follow, bounds, cuts, and shake

This task provides common camera behavior as deterministic functions called by
game update code.

### Work

Implement direct follow, per-axis dead zones, fixed-step damping, bounds
clamping, explicit cut state, and deterministic shake sampling. Every helper
must return new immutable values and accept all time or seed inputs explicitly.

Write invariant tests covering:

- A target inside a dead zone does not move the camera.
- Crossing one edge moves only the required amount.
- Damping produces equivalent results for equivalent fixed-step schedules.
- A clamped camera cannot reveal outside a sufficiently large world bound.
- A world smaller than the view centers without oscillation.
- Zoom changes recompute the allowed center range.
- Rotation follows the documented conservative or exact bounds policy.
- Equal shake seed and elapsed time produce equal offsets.
- Shake ends exactly at its duration and never mutates the base camera.
- A changed `cutId` disables interpolation for one presentation boundary.

Do not put mutable velocity inside a global camera controller. If a damping
model needs velocity, make it explicit immutable authored state returned to
the caller.

### Acceptance

T12.2 is complete when a headless game can implement follow, camera bounds,
teleport cuts, and reproducible shake without React, Reanimated, or a device
clock.

## T12.3: Build the authoritative GameView camera binding

This task joins authored camera state to the existing UI presentation pipeline
without adding React frame traffic.

### Work

Add the optional camera definition to `GameView`. Select previous and current
camera data from the same committed frame as the renderer, interpolate it on
the UI runtime, and publish a read-only presented binding through the existing
surface ownership generation.

The binding must be atomic with session, renderer, viewport, and frame swaps.
It must never let a new renderer observe an old camera or let a retired session
continue writing to the active camera. Preserve the Task 8 surface retirement
handshake and Task 10 pause semantics.

Add integration tests for:

- No-camera compatibility and no extra remount.
- Camera selector replacement only at a valid binding boundary.
- Session reopen and same-game reopen with fresh generations.
- Previous/current interpolation and shortest-arc rotation.
- Explicit cut, scene transition, pause, resume, dispose, and background.
- A listener or selector error leaving the previous valid surface safe.
- Renderer and pointer consumers observing the same generation.
- No React render caused by per-frame camera movement.

Do not let the renderer imperatively publish its own camera. That recreates the
split ownership that earlier surface work removed.

### Acceptance

T12.3 is complete when `GameView` owns one coherent presented camera, the
no-camera path remains unchanged, and camera animation occurs without JS-to-UI
bridge work on every display frame.

## T12.4: Make pointer mapping camera-aware

This task guarantees that the world coordinate delivered to game actions
matches the world location visibly under the finger.

### Work

Extend the mounted pointer adapter to consume the active presented camera
binding. Apply existing surface containment, inverse viewport mapping, and
inverse camera mapping in the frozen order. Preserve coalescing, hit slop,
pointer ownership, pause, cancel, and finalize behavior.

Write behavioral tests and native instrumentation seams for:

- Down, move, up, cancel, and finalize under translated cameras.
- Drag continuity while a follow camera moves.
- Zoom and rotation during a drag.
- Fit letterboxes, fill crop, extend-world, safe area, and split view.
- Hard cuts without synthetic touches or stale camera generations.
- Pause during a drag and resume under the existing lifecycle contract.
- Camera binding replacement and same-id game reopen.
- Exact agreement between public `surfaceToWorld2D` and delivered action data.

Keep the gesture configuration stable. Camera shared values may change, but a
camera update must not rebuild the native gesture or interrupt a physical
touch.

### Acceptance

T12.4 is complete when automated contracts prove mapping and a physical-device
drag can continue while the camera follows, zooms, and rotates without input
loss or visible offset.

## T12.5: Add GameWorld2D camera layers and parallax

This task applies the authoritative presented camera in Skia retained mode and
adds a small ordered layer primitive.

### Work

Update `GameWorld2D` to compose the existing viewport transform with the
presented camera transform. Add `GameLayer2D` with immutable, validated
per-axis parallax and the T12.0 zoom/rotation policy.

Keep static scene structure in retained mode. Camera values must flow through
shared values or derived worklets instead of causing React tree recreation.
The Canvas and renderer must remain mounted while the camera moves.

Test transform composition using render-independent projections first, then
add focused component tests for:

- Identity camera parity.
- Translation, zoom, rotation, and combined order.
- Default, zero, fractional, and per-axis parallax.
- JSX render ordering.
- Camera cut and binding replacement without Canvas remount.
- Screen-space children remaining outside camera transforms.
- Invalid parallax failing at the public boundary.

Do not add a generic scene graph, render scheduler, or dynamic z-index sort.

### Acceptance

T12.5 is complete when retained sprites move under camera shared values with no
React rerender, layers have predictable ordering, and app chrome remains
structurally separate.

## T12.6: Implement visibility and SpriteBatch culling

This task makes large retained and batched scenes practical without altering
simulation behavior.

### Work

Implement visible world corners, a conservative visible AABB, shape visibility
predicates, padded visibility, and stable-order filtering. Integrate the result
with `SpriteBatch`'s fixed-capacity update contract.

For a batch, retain stable source identity and compact only the presented draw
records according to the established batch policy. Clear or hide unused slots
without reallocating buffers or leaking stale sprites. Measure whether the
visibility query belongs at fixed commit frequency or presentation frequency;
do not assume more frequent work is faster.

Write tests for:

- Objects fully inside, outside, touching, and crossing view edges.
- Sprite padding and oversized sprites.
- Rotated views without false-negative culling.
- Negative world coordinates and distant worlds.
- Stable output order and duplicate-free indexed queries.
- Capacity overflow behavior.
- Camera cuts, zoom changes, and rapid direction reversal.
- Off-screen entities continuing to update and collide.
- Culled slots becoming visible again without stale transforms or frames.

Benchmark representative sparse and dense Sprite Field populations on the JS
and UI paths. Keep benchmark findings separate from semantic acceptance.

### Acceptance

T12.6 is complete when culling reduces submitted off-screen draw work, never
changes simulation results, and preserves the fixed-capacity SpriteBatch
contract.

## T12.7: Expand Sprite Field into a scrolling reference game

This task proves that the public camera and culling APIs work in an authored
game rather than only in fixtures.

### Work

Expand Sprite Field to use a world materially larger than the visible phone or
tablet area. Store the authored camera in scene state, follow the player with a
small dead zone, clamp to world bounds, and render multiple parallax layers.

Use the public visibility API to cull the enemy field and public sprite APIs to
render retained and batched sprites. Keep the current asset loading, animation
state controls, surface ownership, and back-button behavior intact.

Add a visible diagnostics option that reports total entities, visible
entities, culled entities, camera center, zoom, and draw-path counts without
forcing those values through React every frame.

Verify at minimum:

- The player can cross several screen widths and heights.
- Follow begins only after the dead-zone boundary.
- World edges clamp cleanly on phone and iPad aspect ratios.
- Background layers move at the documented parallax rates.
- Animation buttons and app back controls remain screen-space and responsive.
- Leaving, reopening, pausing, and resuming produce fresh coherent state.
- Enemy simulation remains deterministic when enemies are off-screen.

### Acceptance

T12.7 is complete when Sprite Field is a source-linked, playable demonstration
of scrolling, follow, parallax, culling, sprites, animation, input, assets, and
session lifecycle using only public GameKit APIs.

## T12.8: Add a Camera Lab and performance instrumentation

This task isolates camera edge cases that are difficult to diagnose inside a
full game.

### Work

Add a playground Camera Lab with a grid, numbered world markers, visible world
bounds, pointer crosshair, and controls for follow, zoom, rotation, cuts,
shake, bounds, and culling. Include presets for phone portrait, tablet,
split-view-like dimensions, and each viewport resize policy where practical.

Instrument the existing performance lab rather than creating an unrelated
metrics stack. Record:

- JS and UI frame percentiles.
- Camera presentation cost.
- Visible and culled object counts.
- Pointer raw, forwarded, accepted, and committed events.
- World/surface round-trip error.
- Canvas, gesture, and session remount counts.
- Stale camera-generation or dropped-binding counters.

Add a forced React rerender control while a drag remains active. It must not
remount the Canvas, replace the gesture, reset pointer ownership, or interrupt
camera presentation.

### Acceptance

T12.8 is complete when a developer can reproduce transform, input, lifecycle,
and culling failures in one focused screen and collect comparable evidence
before and after changes.

## T12.9: Document Camera2D and update agent instructions

This task makes the system usable without reading implementation files.

### Work

Add Fumadocs pages for:

- Camera2D concepts and coordinate spaces.
- Adding a camera to an existing game.
- Following a player and using dead zones.
- Bounds, zoom, rotation, cuts, and shake.
- Converting world, logical, and surface coordinates.
- Render layers and parallax.
- Visibility culling and SpriteBatch integration.
- Camera performance and debugging.
- The scrolling Sprite Field walkthrough.

Every guide must state which code runs in simulation, on the UI runtime, in
React, and in native gesture delivery. Include copyable examples that compile
against the public package and link to the corresponding playground source.

Update the project agent workflow or create the smallest relevant camera skill
addendum. It must instruct implementation agents to:

- Reuse the authoritative `GameView` camera binding.
- Never calculate a second input transform in a game screen.
- Keep camera state out of React render loops.
- Mark worklet-callable helpers correctly.
- Treat culling as presentation-only.
- Preserve no-camera behavior and physical-device input checks.
- Use explicit 2D names and avoid leaking future 3D assumptions.

Update `doc-structure.md` and navigation so Camera appears under Engine Systems
and cross-links Viewports, Input, Sprites, Collision, Performance, and Pause.

### Acceptance

T12.9 is complete when a new author can convert a fixed-screen sprite game into
a scrolling one from documentation alone, and every published snippet is
compile-checked or imported from tested source.

## T12.10: Complete automated and device gates

This task validates only the surfaces changed by Camera2D, then runs the normal
release gate when the milestone is ready to merge.

### Automated gate

Run the focused camera, viewport, pointer, renderer, SpriteBatch, Sprite Field,
and compile-fixture tests during development. At completion, run the repository
gate required for a publishable package and record exact commands and results.

The final automated evidence must cover:

- Pure headless imports.
- TypeScript public API fixtures.
- Transform and property tests.
- Session, surface, pause, and reopen integration.
- React and worklet boundaries.
- Package build and tarball export inspection.
- Docs build and Expo export.
- Coverage at or above the repository threshold.
- Diff and package metadata checks.

### Device matrix

Complete the following rows on physical hardware or leave each one explicitly
unchecked and device-gated.

- [ ] iPhone portrait follow, zoom, rotate, shake, and continuous drag.
- [ ] iPhone background, foreground, pause, resume, close, and reopen.
- [ ] iPad portrait and landscape camera bounds and pointer alignment.
- [ ] iPad split view resize while following and dragging.
- [ ] Android portrait follow and continuous drag.
- [ ] Android hardware back during camera movement and pause.
- [ ] Low-end Android culling comparison with equivalent entity counts.
- [ ] Twenty-five open, play, pause, background, resume, and close cycles.
- [ ] Fifty camera cut, zoom, and rotation cycles without stale bindings.

Record device model, OS version, build mode, world size, entity count, viewport
policy, and performance percentiles. Simulator evidence must never be labeled
as physical-device input acceptance.

### Acceptance

T12.10 is complete when all automated gates pass and every hardware row either
has recorded evidence or remains honestly open in this plan.

## Required correctness matrix

The implementation must cover the following combinations in focused tests or
the device matrix.

| Area | Required cases |
| --- | --- |
| Compatibility | absent camera, explicit identity, session replacement |
| Translation | origin, negative world, large world, non-origin logical view |
| Zoom | below one, one, above one, invalid, changing during drag |
| Rotation | zero, quarter turn, wrapped, shortest arc, changing during drag |
| Viewport | fit, fill, extend-world, letterbox, safe area, resize |
| Conversion | world/logical/surface forward, inverse, round trip, tolerance |
| Lifecycle | ready, play, pause, resume, background, dispose, reopen |
| Cuts | scene change, teleport, generation change, explicit cut |
| Follow | direct, dead zone, per-axis, damping, fixed-step schedules |
| Bounds | large world, small world, zoomed, rotated, edge stability |
| Shake | repeatable seed, duration end, pointer alignment, no gameplay drift |
| Layers | default, fixed, fractional, per-axis, ordering, screen-space HUD |
| Culling | inside, outside, edge, padding, rotation, stable order, re-entry |
| Performance | sparse, dense, retained, batch, camera still, camera moving |

## Performance requirements

Camera movement is a display-frequency operation, so the system must avoid
moving work onto React or across the JS/UI boundary every frame.

- Camera presentation uses existing shared frame and alpha data on the UI
  runtime.
- Camera movement does not rerender React, recreate the Canvas, or rebuild the
  native gesture.
- Forward and inverse point transforms avoid avoidable allocations in hot
  paths.
- Visibility work has explicit complexity and does not scan unrelated worlds
  when a spatial index is available.
- Culling does not rebuild immutable sprite descriptors every display frame.
- Diagnostics remain off by default and cannot alter transform results.
- Retained layers remain stable while only shared transform values change.
- Benchmarks compare no camera, static camera, moving camera, and moving camera
  with culling enabled.

Do not introduce object pools or mutable borrowed public values. Internal reuse
requires profiling evidence and tests proving that callers never observe stale
data.

## Definition of done

Task 12 is complete when the camera contract, rendering, input, culling,
reference game, and evidence agree.

- [ ] Canonical immutable Camera2D exports from the native-free root.
- [ ] No-camera games preserve their existing behavior and performance path.
- [ ] One GameView-owned presented camera drives rendering and pointer input.
- [ ] Forward and inverse conversions follow one documented transform model.
- [ ] Follow, bounds, cuts, and shake are deterministic and headless.
- [ ] `GameWorld2D` supports camera transforms without React frame updates.
- [ ] Ordered layers and parallax have explicit zoom and rotation semantics.
- [ ] Visibility culling never changes simulation or collision results.
- [ ] Sprite Field demonstrates a larger scrolling world through public APIs.
- [ ] Camera Lab exposes transform, lifecycle, input, and performance evidence.
- [ ] Docs and agent instructions prevent split transform ownership.
- [ ] Automated package, docs, and Expo gates pass.
- [ ] Device rows are completed or remain explicitly device-gated.

## Recommended execution order

Implement in dependency order so React integration cannot redefine the pure
coordinate contract.

1. T12.0: inventory and contract fixtures.
2. T12.1: pure camera math and validation.
3. T12.2: follow, bounds, cuts, and shake.
4. T12.3: authoritative GameView camera binding.
5. T12.4: pointer mapping.
6. T12.5: GameWorld2D layers and parallax.
7. T12.6: visibility and SpriteBatch culling.
8. T12.7: scrolling Sprite Field reference game.
9. T12.8: Camera Lab and instrumentation.
10. T12.9: docs and agent workflow.
11. T12.10: automated and device gates.

Do not start with visual camera movement in the renderer. Freeze pure transform
and inverse-transform semantics first, then bind rendering and pointer input to
the same presented generation before adding layers or culling.
