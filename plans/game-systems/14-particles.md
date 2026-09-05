# Particle simulation and presentation

## Purpose and verdict

Produce bounded, deterministic visual bursts with analytic motion and constant React topology. **Keep per-effect capacities, seeded emission, one presentation owner, and sparse registry transfer. Remove redundant particle bookkeeping after fixing ownership and visibility.**

Sources: [system](../../packages/gamekit/src/particles/createParticleSystem.ts), [definition](../../packages/gamekit/src/particles/defineParticleEffect.ts), [sampling](../../packages/gamekit/src/particles/sampling.ts), [presentation clock](../../packages/gamekit/src/react/particles/useParticlePresentation.ts), [view](../../packages/gamekit/src/react/particles/ParticleView.tsx), [culling](../../packages/gamekit/src/react/particles/culling.ts).

## GS-PARTICLE-01 — P1: clock ownership and disposed registry behavior are incomplete

**Evidence: reproduced.** After acquiring a presentation driver, `binding.tick` rejects a second owner, but public `system.update` still advances the same clock. One driver step of 0.1 seconds plus `system.update(0.1)` yields 0.2 seconds. After disposal, `buildUiRegistry` reads cleared emission logs and throws TypeError. A scheduled presentation callback can call it after `driver.step` becomes a disposed no-op.

**Resolve:** enforce exclusive ownership at the actual shared advance boundary, allowing only the active driver when owned. Define an empty terminal registry or prevent all post-disposal registry reads and publish the terminal clear before stopping. Release scheduled work and stale wake/control callbacks idempotently. Preserve valid standalone headless updates.

**Acceptance:** public update and binding tick cannot double-step an acquired driver; releasing allows headless updates again. Dispose with a scheduled callback, then deliver that callback and a lifecycle notification: no TypeError, no new work, and no visible particles remain.

## GS-PARTICLE-02 — P1: world particles disappear without a camera; fixed padding can cull visible shapes

**Evidence: source-confirmed.** `cameraVisibleWorldBounds` returns undefined without a camera, and `visibleInBounds` returns false for undefined. World particles inside an ordinary viewport-only `GameWorld2D` therefore fail visibility. Both shapes and sprites are culled by their center with a fixed 16-unit pad, although authored radius, sprite size, scale envelope, and rotation can extend farther. A radius-50 particle centered 20 units outside the view still overlaps it but is rejected.

**Resolve:** use the resolved viewport bounds for no-camera world presentation, as the tile layer does. Cull using actual conservative particle extents or an effect-level maximum derived from geometry and scale endpoints. Keep extra overscan separate from shape extent. Match screen/world coordinate ownership to the parent transform and document where screen-space effects mount.

**Acceptance:** viewport-only world particles render; circles, rotated rectangles, and sprites partially crossing each edge remain visible; fully outside shapes cull; zoom/parallax policies are explicit and simulation diagnostics are unchanged by culling.

## GS-PARTICLE-03 — P2: complete definition validation and nested ownership

**Evidence: reproduced/source-confirmed.** `burst.count: 1.5` is accepted and the integer loop emits two particles. Sprite size fields only receive `typeof number` checks, admitting NaN/Infinity/nonpositive values, and `particle.size` remains aliased under a shallow particle clone. Shape dimensions/radius and optional direction/rotation fields lack equivalent complete validation.

**Resolve:** validate finite integer burst count, finite supported dimensions, shape-specific fields, and optional ranges by presence rather than truthiness. Deep-copy/freeze nested authored size records. Preserve the intentional legacy `scaleOverLife` contract until a separate deprecation; do not reinterpret it while repairing unrelated fields.

**Acceptance:** malformed raw JS definitions fail before pool allocation/native drawing, caller mutation cannot change an existing system, and fractional count is rejected. Existing explicit-scale/envelope deterministic tests continue to pass.

## GS-PARTICLE-04 — P2: simplify duplicated active-particle representations

**Evidence: source-confirmed complexity; gains unmeasured.** A mutable pool stores every live particle, while `emissionsLog` retains up to four capacities of emission records. Registry construction rebuilds a Set of active sequence IDs and filters the log. Each burst searches the pool from slot zero for each particle (up to O(burst×capacity)); each tick computes full analytic transforms just to retain opacity, then presentation computes transforms again. Disposal clears the pool twice with identical loops.

**Resolve in this order:** delete the duplicate disposal loop. Remove stored/recomputed values that no consumer needs after a usage search. Build the UI registry directly from active slots in deterministic spawn order if the log is unnecessary; retain any documented emissions-history API intentionally. Only then consider a free-slot list/oldest queue if measured bursts warrant it. Do not add an ECS or transfer per-particle frame snapshots to UI.

**Acceptance:** seeded results, draw order, overflow policy, emissions-history behavior, and diagnostics remain deterministic. Registry size is bounded by live capacity. Measure burst latency, expiry churn, allocations, and registry bytes before/after.

## Rendering cost and gates

ShapeBatch creates a PictureRecorder, paint, picture, and per-rectangle matrix during updates. Constant React node count is useful but not equivalent to low native allocation or draw cost. Compare retained shapes/Atlas/Picture at realistic populations before changing render mode; audit temporary native-resource lifetime using installed Skia semantics. [GS-REACT-03](03-react-presentation.md) covers sprite-buffer publication. Preserve particle, envelope, culling, and view tests, then validate 60/120 Hz and memory on physical devices.
