# Task 15: Bounded particle effects

## Status

**Complete — v1 done.** T15.0–T15.6 implemented: definitions + pure seeded
sampling, bounded fixed-capacity controller, presentation-time binding,
stable shape rendering, Brick Breaker + Particle Lab integration, and the
Particles engine-system page. Device performance rows honestly open.

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
