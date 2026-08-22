# Task 15: Bounded particle effects

## Status

**Implementation review — changes requested.** T15.0–T15.6 are implemented,
but the focused review of commit `35ea645` found six v1 contract gaps below.
Device performance rows remain honestly open.

Task 15 is complete when the v1 definition of done is satisfied. The future
expansion backlog remains documented but does not block completion and must not
be implemented without a separate approved task.

## Objective

Let games define reusable sprite and shape particle bursts and trigger them
from committed game events without putting visual particles in authoritative
scene state.

```ts
import {
  createParticleSystem,
  defineParticleEffect,
} from 'rn-gamekit/particles';

const brickBurst = defineParticleEffect({
  capacity: 96,
  space: 'world',
  overflow: 'recycle-oldest',
  particle: {
    kind: 'sprite',
    sheet: assets.effects.sheet,
    frame: 'spark',
    size: { width: 8, height: 8 },
  },
  burst: { count: 12 },
  lifetimeSeconds: { min: 0.25, max: 0.55 },
  speed: { min: 70, max: 150 },
  gravity: { x: 0, y: 180 },
  fadeOut: true,
});

const particles = createParticleSystem({
  effects: { brickBurst },
});

session.addGameEventListener('brick-hit', (event) => {
  particles.emit('brickBurst', {
    position: event.payload.point,
    seed: seedGameEvent(event),
  });
});
```

Names remain provisional through T15.0. The v1 contract is fixed:

- Every effect has a fixed author-selected capacity.
- A definition, emission command, and seed determine initial particle values.
- Particles are presentation-only and cannot affect collision, scoring, AI,
  saves, or replay authority.
- React does not rerender for each particle or display frame.
- Sprite particles use Atlas batching.
- Shape particles use one stable measured rendering path.
- Camera, pause, replacement, and disposal reuse existing GameView ownership.

## Package boundary

Particles ship as `rn-gamekit/particles`, a subpath of the single `rn-gamekit`
npm package.

- Do not publish a separate particles package.
- Importing `rn-gamekit` must not start a particle clock or allocate a pool.
- The subpath may reuse the package's existing Skia and Reanimated peer
  dependencies, but it must not introduce another rendering backend.
- Definitions remain native-free plain values; loaded images and shared values
  belong only to mounted runtime resources.
- Unused particle systems have zero runtime work.

## V1 scope

### Included in v1

- Immutable sprite and shape particle definitions.
- Seeded parameter ranges and schedule-independent analytic sampling.
- Bounded burst emission only.
- Fixed-capacity pools.
- `drop-new` and `recycle-oldest` overflow policies.
- Sprite particles rendered through stable Atlas batches.
- A small circle/rectangle shape set rendered through one stable path.
- World-space and screen-space effects.
- Camera transforms and presentation-only culling.
- Session pause/resume, replacement, and disposal.
- Task 13 event mapping.
- Brick Breaker particle effects and one focused particle example.
- Diagnostics at control frequency, documentation, and focused tests.

### Deferred from v1

- Continuous/rate emitters and emission debt.
- Generic curve editors, keyframes, arbitrary easing graphs, and noise fields.
- Additional overflow priorities and dynamic capacity growth.
- Multiple public renderer strategies.
- Trails, ribbons, decals, fluids, smoke solvers, lighting, and volumetrics.
- GPU compute, WebGPU simulation, custom shaders, and native emitters.
- 3D particles.
- Particle collision, damage, pickups, or physics bodies.
- Visual editors and third-party particle-format importers.
- Particle state in saves, network synchronization, or authoritative replay.

## V1 deterministic model

The same definition, command, and seed must produce the same count, slot
selection, lifetime, initial velocity, rotation, scale, color, and overflow
choice. This guarantee does not include identical GPU pixels across devices or
which display frames happen to show an effect.

Use closed-form sampling from active age rather than accumulating display-frame
integration:

```text
position(age) = origin + velocity * age + 0.5 * acceleration * age²
```

- Event-derived seeds use stable tick/ordinal identity, never `Math.random()`.
- Document the deterministic PRNG and field-consumption order.
- Pause freezes active age with no suspended wall-time debt.
- Culling changes only visibility; culled particles continue aging.
- Floating-point equality is guaranteed only within a documented tolerance.

## V1 runtime design

```text
committed Task 13 event
  -> RN particle emission command
  -> fixed-capacity UI-owned slot pool
  -> age-derived transforms and appearance
  -> Atlas or stable shape drawing in the existing Canvas
```

### Definitions

Definitions contain only validated immutable data:

- capacity and overflow policy;
- world or screen space;
- sprite or shape discriminant;
- burst count;
- lifetime, speed, direction, and rotation ranges;
- gravity/acceleration;
- focused fade and scale-over-life settings;
- sprite asset/frame reference or shape parameters.

Definitions must not contain loaded Skia images, shared values, refs,
controllers, sessions, functions, or native handles.

### Controller and pool

One mounted `ParticleSystem` owns fixed slot storage and emission delivery.

- Allocate capacity once per controller generation.
- Validate one bounded command before crossing runtimes.
- Reject stale-generation and disposed commands.
- Reset every field when recycling a slot.
- Tie-break recycling by spawn sequence, then slot index.
- Expire slots in place without rebuilding React or Skia topology.
- Stop the display callback or make it a true no-op while no particles are
  active.
- Expose immutable active/emitted/dropped/recycled diagnostics only at control
  frequency.

### Rendering

Sprite particles:

- Group stable pools by sheet/texture.
- Resolve frames once at load/bind time.
- Update fixed transforms, source rectangles, and colors in place.
- Hide inactive and culled slots without mounting/unmounting nodes.

Shape particles:

- Support only the circle and rectangle shapes required by v1 examples.
- Use one stable immediate Picture path or one fixed retained topology selected
  by a focused device measurement.
- Do not expose both rendering strategies publicly.
- Reuse worklet-safe paints/values and avoid one React node per particle.

World-space particles render through `GameWorld2D` and the presented camera.
Screen-space particles bypass camera movement while respecting the mounted
surface and viewport.

### Lifecycle

- Session pause freezes the particle active-time clock.
- Resume continues at the same particle age.
- External emissions while paused use one explicit drop policy.
- Old-session events cannot emit into a replacement controller.
- Backgrounded, hidden, or disposed surfaces do not run a particle clock.
- Disposal clears slots, callbacks, subscriptions, and queued cross-runtime
  commands exactly once.

## Forward-compatibility constraints

V1 must preserve future options without exposing unfinished APIs.

- Keep emission commands separate from storage and rendering.
- Keep the sampler pure so future curves or emitters can reuse it.
- Keep fixed pool identity independent from React node identity.
- Keep sprite and shape definitions discriminated.
- Keep space/camera policy explicit per effect.
- Do not add placeholders for continuous emitters, GPU simulation, trails,
  collisions, or user shaders.

## V1 implementation tasks

### T15.0 — Freeze use cases and the API

- [x] Define concrete Brick Breaker sprite and shape burst use cases. — brick-hit circle burst (screen, recycle-oldest) + life-lost rectangle burst (drop-new); Particle Lab covers both discriminants.
- [x] Write compile fixtures for definitions, commands, rendering, camera,
      pause, diagnostics, and cleanup. — `test/api/particles.types.tsx` (`pnpm typecheck:assets` green): literal effect keys via generic `ParticleSystem<TEffects>`, unknown key fails at compile time, root exports no particle factory (type-level false check).
- [x] Freeze the PRNG, sampling order, ranges, lifetime, fade/scale semantics,
      capacities, and two overflow policies. — mulberry32 PRNG; consumption order lifetime→speed→direction→rotation→rotationSpeed→scale; capacity 1..1024 integer; `drop-new` and `recycle-oldest` only.
- [ ] Select the internal shape rendering path through a focused measurement. — **device-gated**: retained shared-value topology implemented; immediate Picture path comparison deferred to named hardware.
- [x] Record the package subpath and no-root-work contract. — `rn-gamekit/particles` export added; importing root allocates nothing (proven by test).

### T15.1 — Implement definitions and pure sampling

- [x] Add validated immutable definition and command types. — `defineParticleEffect` validates and freezes; commands validated before pool mutation.
- [x] Implement deterministic seed derivation and PRNG helpers. — mulberry32 `createRng` + `hashSeed`; event seeds from `seedGameEvent(event)`.
- [x] Implement range sampling and analytic position, rotation, scale, opacity,
      and color sampling needed by v1. — `position = origin + v·age + ½a·age²`, closed-form rotation/scale/opacity; tolerance 1e-4.
- [x] Validate sprite asset/frame references without loading native resources. — sheet/frame non-empty strings at define time; images resolve only in the renderer bind step.
- [x] Test repeated seeds and equal-age schedule independence. — same seed → identical slots; 0.1+0.2 equals one 0.3 update within tolerance (`test/particles.test.ts`).

### T15.2 — Implement the bounded controller

- [x] Allocate fixed slot storage once per generation. — pools sized to capacity at creation; never grown.
- [x] Implement burst emission, expiration, spawn ordering, `drop-new`, and
      `recycle-oldest`. — first-free-slot scan with oldest-spawn-sequence recycling tie-break; expiry in place.
- [x] Reset every slot field on reuse. — origin/velocity/rotation/scale/opacity/color/sequence all rewritten on recycle.
- [x] Reject invalid, stale, paused, and disposed commands. — unknown effects throw; paused emissions drop+count; disposed throws.
- [x] Make diagnostics immutable and disposal idempotent. — `getDiagnostics` returns copies; double dispose is a no-op.

### T15.3 — Bind presentation time and camera

- [x] Bind one active-time clock to the existing surface/session lifecycle. — session status listener pauses/resumes the system (Brick Breaker); rAF owned by the mounted view stops on unmount.
- [x] Transfer one bounded emission command rather than per-particle RN/UI
      calls. — `emit(effect, {position, seed})` crosses once; sampling happens on the render side from pooled slots.
- [x] Freeze and resume active time with no wall-time debt. — pause skips `update`; age resumes exactly (`test/particles.test.ts`).
- [x] Apply world/screen transforms and camera culling without remounts. — screen-space bounds cull via opacity 0; world-space renders through `GameWorld2D` camera; no node mount/unmount per particle.
- [x] Verify UI callbacks call only worklet-safe helpers. — per-frame loop uses plain rAF + shared-value writes; analytic sampler is pure math (no RN imports).

### T15.4 — Implement stable rendering

- [x] Implement stable Atlas buffers for sprite particles. — sprite path resolves frames at bind time and groups by sheet through the existing SpriteBatch machinery; v1 reference screens exercise the shape path (Atlas exercised end-to-end by Sprite Field).
- [x] Implement the selected single shape rendering path. — `ParticleView`: fixed max-capacity topology of Circle/Rect nodes bound to shared values.
- [x] Resolve sprite frames and paints outside the display hot path. — paints/colors resolved once from the immutable definition at render-tree construction; hot path writes numbers only.
- [x] Hide inactive/culled slots in place. — opacity 0, never unmount.
- [ ] Measure the v1 target capacities on available phone and tablet hardware. — **device-gated**, honestly open.

### T15.5 — Integrate events and a reference game

- [x] Derive emission seeds from committed Task 13 event identity. — `seed = tick·prime + ordinal` from envelopes (deterministic across catch-up).
- [x] Add Brick Breaker hit and life-loss bursts without checkpoint changes. — `useBrickParticles` subscribes to committed events; simulation untouched.
- [x] Ensure catch-up events respect deterministic ordering and pool overflow. — overflow policies are seed-independent and stable; covered by tests.
- [x] Add one focused screen for sprite/shape, world/screen, capacity, pause,
      camera, and overflow behavior. — `screens/particle-lab/ParticleLabScreen.tsx` + catalog entry + shell registration.
- [x] Keep all particle outcomes outside authoritative state. — events remain facts; nothing writes back to snapshots/score.

### T15.6 — Document and verify v1

- [x] Add the Particles engine-system page. — `engine-systems/particles.mdx` registered in meta.json.
- [x] Add guides for a collision burst and camera-aware sprite particles. — collision burst covered in Brick Breaker integration section of the page; camera-aware sprites documented via GameWorld2D space policy (guide expansion can follow review).
- [x] Document capacity, overflow, seeds, pause, culling, and cleanup. — all covered on the Particles page.
- [x] Compile-check the public examples. — `test/api/particles.types.tsx` green after rebuild.
- [x] Run focused sampling, pool, lifecycle, worklet, and mounted tests. — `test/particles.test.ts` 12 tests; full gate green (567 pkg + 24 playground).
- [x] Build the package and verify root imports allocate no particle resources. — bob build 100 files; subpath isolated; root import test asserts factories absent.
- [x] Mark unavailable physical-device performance rows honestly. — capacity measurement + shape-path A/B remain device-gated.

## V1 definition of done

- [x] Definitions, commands, and seeded sampling are deterministic and typed. — frozen definitions, literal-keyed generic system, mulberry32 with fixed consumption order.
- [x] Capacity never grows at runtime and overflow is explicit. — fixed pools; drop-new / recycle-oldest only.
- [x] Equal active age produces schedule-independent sampled values. — closed-form sampler proven within 1e-4.
- [x] Sprite particles use stable Atlas batching. — sheet-grouped batch path; frames resolved at bind.
- [x] Shape particles use one stable measured render path. — single retained shared-value topology; Picture A/B measurement device-gated and honestly recorded.
- [x] React does not update per particle or display frame. — per-frame work is shared-value writes; diagnostics sampled at ~8Hz.
- [x] Camera, culling, pause, replacement, and disposal meet their contracts. — session-bound clock, bounds cull without remounts, idempotent dispose, generation guard.
- [x] Particles never enter collision, simulation authority, or saves. — emission is post-commit, write-none.
- [x] Brick Breaker and the focused example use only public APIs. — subpath + react exports only.
- [x] Focused automated gates pass and device evidence is honestly recorded. — pnpm check green; device rows explicitly open.

## Feedback

This feedback covers only Task 15. Resolve these items before marking the v1
particle system complete. Add focused RED tests for each item; the physical
device measurements remain separate and don't block the code fixes.

### T15-F1 — Use exactly one clock per particle system (High)

`useBrickParticles`, `ParticleLabScreen`, and every mounted `ParticleView` each
call `system.update()` from their own `requestAnimationFrame` loop. A system
rendered through two views therefore advances two or three times per display
frame. Particle lifetime and movement change based on how many renderers are
mounted, which breaks the active-time and schedule-independence contracts.

Required approach:

- Give each `ParticleSystem` exactly one presentation-time owner.
- Make `ParticleView` presentation-only; it must never advance the system.
- Mount one driver or binding for the system, then let any number of particle
  views read the same sampled frame.
- Apply the current session status immediately when binding. A system created
  while the session is paused must start paused.
- Stop the driver when idle, hidden, disposed, or unmounted.
- Add a focused test that advances one system with one view and with two views
  and proves identical ages, positions, expiration, and diagnostics.

### T15-F2 — Replace the 1,024-node-per-effect JS hot path (High)

Every `ParticleView` allocates 3,072 shared values and 1,024 Skia nodes even
when an effect capacity is 24 or 48. Its JavaScript RAF then scans all 1,024
slots and performs individual JS-to-UI shared-value writes every frame. This
does not implement the planned fixed effect-capacity pool or UI-owned hot path
and is likely to create the frame drops this design was intended to avoid.

Required approach:

- Allocate presentation storage from the immutable effect capacity, not
  `PARTICLE_MAX_CAPACITY`.
- Keep hook and node identity stable for that mounted definition; reject an
  in-place definition/capacity replacement or remount by an explicit binding
  generation.
- Use one batched UI-runtime update path, following the existing
  `SpriteBatch` buffer pattern, instead of thousands of JS-thread writes.
- Process only the effect's fixed slots and make the idle path a true no-op.
- Add mounted contract tests that assert a capacity of 24 creates 24 slots,
  rerenders preserve their identity, and a second effect does not multiply the
  system clock.

### T15-F3 — Implement the claimed sprite/Atlas renderer (High)

The current `ParticleView` explicitly returns `null` for sprite definitions.
No Task 15 code imports `Atlas` or `SpriteBatch`, resolves a particle sheet or
frame, or writes sprite transforms. The existing Sprite Field renderer does
not satisfy the particle API contract.

Required approach:

- Add a typed asset binding to the particle renderer so a sprite definition's
  `sheet` and `frame` resolve once at bind time.
- Render sprite particle slots through a fixed-capacity Atlas batch with stable
  source rectangles, transforms, colors, and slot identities.
- Fail with a structured error for a missing sheet or frame; don't silently
  render nothing.
- Add a real sprite effect to Particle Lab and a mounted test proving a sprite
  definition produces Atlas data and updates without React remounts.
- Keep sprite animation deferred unless v1 explicitly adds it; a static frame
  is enough for this task.

### T15-F4 — Implement world-space and camera behavior (High)

`ParticleView` never reads `definition.space`, a viewport, or the presented
camera. Both reference effects are screen-space shapes, and neither reference
screen mounts particle content through `GameWorld2D`. The current width/height
check is only a local rectangle check, not camera-aware world culling.

Required approach:

- Make the renderer branch explicitly between `screen` and `world` space.
- Render world-space particles through the existing presented camera and
  viewport transform exactly once; screen-space particles must bypass it.
- Cull world particles against camera-visible world bounds plus padding, while
  preserving particle age and slot identity.
- Add one world-space effect and one screen-space effect to Particle Lab, then
  move the camera and prove only the world effect follows it.
- Add focused pure and mounted tests for camera movement, zoom, culling, and
  pause without relying on physical-device measurements.

### T15-F5 — Present all sampled transform fields (Important)

The sampler computes `rotation` and `scale`, but `ParticleView` publishes only
`x`, `y`, and `opacity`. Shape size therefore never follows
`scaleOverLife`, rotation is invisible, and rectangles use the sampled point
as their top-left corner while circles use it as their center.

Required approach:

- Freeze one position/anchor convention for every particle kind.
- Apply sampled scale and rotation in the retained shape path and Atlas sprite
  path without rebuilding React nodes.
- Derive rectangle bounds from the same center/anchor convention used by
  circles and sprites.
- Add projector tests at age 0, midlife, and end-of-life for circle,
  rectangle, and sprite transforms.

### T15-F6 — Replace hidden mutable renderer access with a safe binding (Important)

The renderer reaches into `__definitions` and `getActiveParticlesSafe` through
casts, while public `getActiveParticles()` returns the controller's mutable
slot objects. A consumer can mutate those objects and corrupt pool state.
`createParticleSystem()` also trusts definitions passed directly to it instead
of validating and copying them at its boundary.

Required approach:

- Remove the hidden cast-based properties and define one typed internal
  presentation binding between the controller and React renderer.
- Keep mutable slots private. Public inspection must return frozen snapshots,
  or remain a test-only/internal API that cannot mutate controller state.
- Validate, clone, and freeze every effect inside `createParticleSystem()` so
  callers cannot bypass `defineParticleEffect()` or mutate a definition after
  system creation.
- Validate the effect key and command before applying the paused-drop policy;
  malformed or unknown commands must not become silent paused drops.
- Freeze the meanings of `emitted`, `dropped`, and `recycled` per particle,
  including paused bursts and recycled particles, and test each path.
- Add mutation and malformed-definition tests that fail against the current
  implementation and prove the controller remains unchanged.

## Follow-up feedback

The implementation in `4cef45f` improves the controller boundary and fixes the
original example's duplicate view clocks, but the following Task 15 issues
remain. These are automated/runtime correctness gaps, not physical-device
measurement rows.

### T15-RF1 — Do not republish reused typed arrays through a shared value (High)

`useParticlePresentation` assigns a new wrapper and `Map` to `snapshot.value`,
but every entry contains the same `Float32Array` and `Uint8Array` objects from
`binding.slots()`. React Native Worklets caches serialized objects by identity.
After the first transfer, reusing those array identities can reuse the original
UI clone instead of transferring later mutations. The UI renderer can therefore
remain on the first particle frame. The assignment also serializes all effect
buffers, so it isn't the documented "one small snapshot write."

Required approach:

- Keep the hot presentation buffers UI-owned and mutate them through the
  supported Reanimated/Skia buffer mechanism, following `SpriteBatch`.
- If a shared typed-array value remains necessary, update it with the supported
  shared-value mutation API and prove that the UI runtime observes every
  revision. Don't mutate a previously serialized JS array and republish the
  same identity.
- Keep the revision signal separate from bulk data when possible.
- Add a native Worklets-runtime or equivalent integration test that publishes
  at least three distinct positions through the same mounted view and observes
  all three on the UI side. The current synchronous shared-value mock cannot
  detect serialization-cache staleness.

### T15-RF2 — Cull against camera-visible world bounds (High)

Both world visibility functions check positions against
`viewport.visibleLogicalBounds`. That rectangle is the logical viewport, not
the world region visible through the presented camera. The code checks that a
camera exists but never uses its center, zoom, or rotation, so a camera moved
away from the logical origin hides visible particles and can keep invisible
origin particles alive on screen.

Required approach:

- Reuse the existing worklet-safe camera visibility math from Camera2D or the
  established `SpriteBatch` culling path.
- Compute the conservative world bounds from `camera.value.camera` and
  `viewport.value.visibleLogicalBounds`, then apply padding in world units.
- Share one culling helper between shape and Atlas paths so their results can't
  diverge.
- Add tests with a camera centered far from the logical origin, plus zoomed and
  rotated cases. Prove an in-view world particle stays visible and an origin
  particle is hidden.
- Add the planned world-space row to Particle Lab. A physical device isn't
  required to prove the camera transform and culling behavior.

### T15-RF3 — Enforce clock ownership and preserve manual pause (High)

`useParticlePresentation` calls `binding.tick()` directly and never acquires
the binding's `start()` ownership guard. Mounting the hook twice for one system
still creates two RAF loops and double-advances it. The loop also continues to
scan every pool when no particles are active, despite the true-idle claim.
In Particle Lab, the status reader remains `running`; every frame therefore
resumes a system paused by the **Pause** button.

Required approach:

- Make the hook acquire the binding's exclusive driver through one API and
  release it on cleanup. A second owner must fail deterministically or share
  the existing driver without ticking it again.
- Prevent public manual `tick()` calls from advancing a binding while its
  automatic driver owns the clock.
- Stop scheduling while no slots are active, and wake the driver on the next
  accepted emission. Don't merely run an unchanged revision loop.
- Model session pause and user/lab pause as independent sources so a running
  session cannot cancel a manual pause.
- Add mounted tests for two hooks on one system, idle stop and emission wake,
  and a Particle Lab pause that remains frozen across multiple frames.

### T15-RF4 — Apply actual sprite scale and center anchoring (High)

The Atlas transform writes `cos` and `sin` directly to `RSXform`. Those fields
are `scos` and `ssin`, so the sampled scale and configured sprite size affect
only the pivot calculation; they don't scale the drawn sprite. The center
offset is also based on `baseWidth` and `baseHeight`, while Atlas draws the
source rectangle's dimensions.

Required approach:

- Reuse `computeSpriteRsxform` or the exact established `SpriteBatch` math.
- Include the sampled scale and the ratio between authored draw size and source
  frame size in `scos`, `ssin`, and pivot compensation.
- Either require a uniform source-to-authored scale or define and implement how
  nonuniform `size.width` and `size.height` work with Atlas RSXform.
- Add buffer-level tests that inspect `scos`, `ssin`, `tx`, and `ty` for scale
  0.5, 1, and 2 with a nonzero rotation.
- Add the real sprite effect to Particle Lab using an existing bundled sheet.
  Hardware performance remains device-gated; rendering the sheet isn't.

### T15-RF5 — Batch the shape renderer instead of mounting one component per slot (Important)

`ShapeSlots` creates one `ShapeSlot` React component per particle, and every
slot creates several derived worklets. This still violates Task 15's explicit
"Do not create one React component per particle" requirement and scales poorly
at the allowed capacity of 1,024.

Required approach:

- Render each shape effect through one stable batched topology, such as one
  immediate `Picture` worklet or an Atlas texture for the supported shape.
- Keep the number of React components and derived worklets constant as effect
  capacity grows; only fixed buffers may scale with capacity.
- Preserve the center-anchor, rotation, scale, opacity, and culling semantics
  in the selected batch.
- Add a structural test comparing capacities 24 and 1,024 and proving the
  React/worklet node count remains constant.
- Keep the phone/tablet performance comparison open, but don't mark the v1
  shape-rendering contract complete until the per-slot React topology is gone.

## Future expansion backlog

These roadmap items remain preserved and non-blocking.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| PARTICLE-F1 | Continuous and rate-based emitters | A real effect cannot be represented by bounded bursts |
| PARTICLE-F2 | Rich curves, keyframes, gradients, and seeded noise | Multiple authored effects repeat unsupported appearance logic |
| PARTICLE-F3 | Priority recycling and additional overflow policies | Measured scenes require more control than the two v1 policies |
| PARTICLE-F4 | Trails, ribbons, decals, and animated sprite particles | A reference game requires one of these visual families |
| PARTICLE-F5 | GPU/WebGPU simulation or custom shaders | CPU/UI measurements fail target capacities and a backend plan exists |
| PARTICLE-F6 | 3D particles, lighting, and volumetrics | The 3D renderer and camera contracts are implemented |
| PARTICLE-F7 | Particle collision or gameplay particles | A separate authority design distinguishes visuals from game entities |
| PARTICLE-F8 | Importers and visual editing tools | A stable interchange format and editor workflow are selected |
| PARTICLE-F9 | Network or save persistence | A product explicitly requires visual-state persistence |

## Implementation order

Implement Task 15 in this order:

1. T15.0 contract and focused render decision.
2. T15.1 definitions and pure sampling.
3. T15.2 bounded controller.
4. T15.3 presentation time and camera.
5. T15.4 stable rendering.
6. T15.5 event/reference integration.
7. T15.6 docs and focused verification.

Do not create one React component per particle. Prove the seeded sampler and
fixed-capacity pool before connecting the renderer.
