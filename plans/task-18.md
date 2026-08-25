# Task 18: Optional rigid-body Physics2D adapter

## Status

**Complete via documented NO-GO.** T18-R1–R4 are resolved. The spike now
classifies harness faults separately, explicitly requires exact baseline
restoration, compares the complete projected contract, records contacts per step,
and prints its returned step-cost diagnostics. Strategy 2 remains prototyped and
rejected, strategy 3 is unavailable, and strategy 1 remains unproven. No adapter
ships; Planck remains dev-only and Collision2D remains the sole collision system.

Summary: five current backends were evaluated from live npm registry metadata.
Only `planck.js 1.5.0` passes the static gates (MIT, active — 1.5.0 April 2026,
bundled TypeScript types, pure-JS/Hermes-compatible); Rapier and box2d-wasm
fail the Hermes/Expo gate (WebAssembly), matter-js fails maintenance and
typeScript gates, p2.js fails maintenance and licensing. The mandatory
physical-device release-like performance matrix cannot be executed without
hardware, so per the task's own acceptance rule the evaluation records NO-GO:
no adapter ships, no production dependency exists, Collision2D remains the sole
collision system, and `planck@1.5.0` stays pinned in devDependencies only to
keep the reproducible headless transaction spike
(`packages/gamekit/scripts/spike-physics2d.mjs`) runnable. Reopen trigger and
frozen device budgets are in the evaluation record.

Task 11 Collision2D remains the default for arcade and platformer games.

## Objective

Support games that genuinely need dynamic rigid bodies, mass interaction,
forces, friction, restitution, and sensors without making physics mandatory or
allowing a third-party backend to define Gamekit's world model.

```ts
import {
  createPhysicsWorld2D,
  physicsBox2D,
} from 'rn-gamekit/physics2d';

const physics = await createPhysicsWorld2D({
  gravity: { x: 0, y: 980 },
  worldUnitsPerMeter: 100,
});

physics.createBody({
  id: 'player',
  type: 'dynamic',
  position: { x: 120, y: 80 },
  shapes: [
    physicsBox2D({
      id: 'body',
      width: 20,
      height: 36,
      density: 1,
      filter: playerFilter,
    }),
  ],
  fixedRotation: true,
});

const result = physics.step({
  tick,
  deltaSeconds,
  commands: [
    { kind: 'apply-impulse', bodyId: 'player', value: { x: 0, y: -320 } },
  ],
});
```

This API is intentionally provisional. T18.0 must first prove how mutable
backend state remains consistent when an authoritative tick later fails.

## Package and dependency boundary

Physics ships, if approved, as `rn-gamekit/physics2d`, a subpath of the single
`rn-gamekit` npm package.

- Do not publish a companion physics npm package in v1.
- Do not add the backend as a mandatory dependency.
- Declare the selected backend as an optional peer dependency.
- Pin the exact validated version in monorepo development dependencies and the
  playground.
- Importing `rn-gamekit`, `rn-gamekit/react`, or non-physics subpaths must not
  load, initialize, or link backend code through JavaScript imports.
- Missing-backend errors occur only when the physics subpath/resource is used.
- Publish a tested peer range and compatibility statement.
- Task 11 Collision2D remains usable with no physics backend installed.

## When to use Physics2D

Use Task 11 Collision2D and game-authored movement for:

- arcade collisions and manual response;
- swept projectiles, triggers, and hitboxes;
- tile/platformer character movement;
- deterministic game-specific motion;
- spatial queries without a solver.

Use optional Physics2D only for demonstrated workflows such as:

- stacks and tumbling dynamic bodies;
- forces, impulses, friction, restitution, and mass interaction;
- many interacting bodies where a maintained solver is preferable to custom
  response code.

V1 must include a reference scene that cannot be served adequately by Task 11
alone. Otherwise the result is no-go.

## V1 scope

### Included in v1 if a backend passes

- One selected and maintained 2D backend.
- One `rn-gamekit/physics2d` public adapter surface.
- Static, dynamic, and kinematic bodies.
- Box and circle shapes.
- Density, friction, restitution, damping, gravity scale, and fixed rotation.
- Sensors and Task 11-compatible category/mask filters where semantics match.
- Create/destroy body, set velocity, set kinematic transform, apply force, and
  apply impulse commands.
- Exactly one backend step per GameSession fixed step.
- Immutable body transform/velocity/sleep projections.
- Ordered contact begin/stay/end facts with stable Gamekit IDs.
- Transaction safety when a tick or later commit phase fails.
- Pause, restart, replacement, and disposal.
- Renderer-neutral debug projections and Camera2D reference rendering.
- Task 13 contact-event integration.
- One Physics Lab/reference scene, docs, compatibility record, and focused
  performance/device evidence.

### Deferred from v1

- Multiple interchangeable backends or a public backend plugin framework.
- Public raw backend handles or `any` escape hatches.
- Joints and constraints.
- Polygon, capsule, chain, mesh, or heightfield shapes.
- Advanced CCD configuration beyond one verified v1 bullet/body option.
- Ray casts and shape casts beyond what the reference scene requires.
- 3D physics, soft bodies, fluids, cloth, destruction, vehicles, and ragdolls.
- Rollback, lockstep networking, authoritative server simulation, and
  cross-device bit-perfect guarantees.
- Automatic collider extraction from images, sprites, or tile art.
- Physics save serialization beyond a game-owned explicit body projection.
- Visual physics editing or Godot-style nodes/resources.

## Non-negotiable boundaries

### Backend does not define Gamekit's world

- Public IDs are stable game-owned strings or branded values.
- Public points, vectors, AABBs, filters, commands, contacts, and results are
  immutable Gamekit values with explicit units.
- Backend worlds, bodies, fixtures, shapes, callbacks, and handles remain
  private.
- Scene state, snapshots, events, and saves never contain backend objects.
- Renderers consume committed transform projections, not a mutable world.
- Backend upgrades may change private mappings without changing game code.

### GameSession owns time

- The fixed scheduler is the only physics clock.
- The backend receives exactly one explicit `deltaSeconds` step per committed
  fixed-step attempt.
- The adapter owns no requestAnimationFrame, timer, accumulator, or auto-run
  loop.
- Pause issues no step and resume adds no suspended wall-time debt.
- Presentation interpolates previous/current committed transforms through the
  existing GameView alpha.

### Transaction safety is a release gate

Most rigid-body engines mutate an internal world during `step()`. A wrapper
cannot publish new backend state and then allow a later scene/snapshot/freeze
failure to leave that hidden world ahead of committed simulation.

T18.0 must prototype and select one proven strategy:

1. Integrate physics as a dedicated GameSession transaction phase that can
   commit or restore backend state atomically.
2. Step from an immutable prior `PhysicsState2D` and rebuild/restore the cached
   backend whenever the prior state reappears after failure.
3. Use a verified backend snapshot/restore facility around the authoritative
   step.

Reject a strategy that relies on “later code must not throw.” If no strategy
meets correctness and mobile performance budgets, record no-go and ship no
adapter.

## Backend evaluation

T18.0 must evaluate current candidates from official repositories, package
metadata, releases, examples, licenses, advisories, and issue trackers. Do not
select Matter, Planck, p2, Rapier, Box2D, or another backend from memory or
popularity alone.

### Required evidence

- Active maintenance, permissive licensing, TypeScript support, and credible
  issue handling.
- Hermes, iOS, Android, New Architecture, and Expo prebuild/dev-client support.
- No unsupported DOM globals or unreviewed binary distribution.
- Clear WASM/native/JS initialization, threading, JSI, CocoaPods, Gradle, ABI,
  and architecture requirements.
- Reliable static/dynamic/kinematic bodies, box/circle shapes, sensors,
  filters, materials, forces, impulses, sleeping, and contact lifecycle.
- Stable body/shape identity and extractable debug geometry.
- A transaction restore/rebuild strategy.
- Predictable teardown across Fast Refresh, backgrounding, replacement, and
  disposal.

### Focused performance matrix

Measure release-like physical-device builds with identical worlds/commands:

- initialization and startup time;
- JavaScript bundle and installed native binary delta;
- fixed-step p50/p95/p99 for 32, 128, and 512 representative bodies;
- one contact-heavy scene and one mostly sleeping scene;
- conversion/sorting cost separated from backend step cost;
- transaction restore/rebuild cost;
- memory, allocations, teardown, and long-session stability;
- 60 Hz simulation with 60/120 Hz presentation on available iPhone, iPad, and
  Android hardware.

The go/no-go decision must use explicit budgets frozen in T18.0.

## V1 public model

### Configuration and bodies

- Gravity uses Gamekit world units per second squared.
- `worldUnitsPerMeter` makes backend conversion explicit.
- Body types are `'static' | 'dynamic' | 'kinematic'`.
- Bodies have stable ID, type, transform, velocity, damping, gravity scale,
  fixed rotation, and named shapes.
- V1 shapes are discriminated box/circle values with local offset, density,
  friction, restitution, sensor flag, and filters.
- Do not reuse an AABB as a rotated physics box when semantics differ.

Validate all IDs, references, finite values, ranges, duplicates, and capacity
bounds before backend mutation.

### Commands and step results

Commands are immutable, tick-scoped intent. Freeze deterministic validation and
ordering for create, destroy, transform, velocity, force, and impulse commands.

One successful step returns:

- tick and fixed `deltaSeconds`;
- immutable transforms, velocities, and sleep state keyed/sorted by stable ID;
- ordered contact begin/stay/end records with body/shape IDs, point, normal,
  and only backend-portable fields;
- diagnostics separate from authoritative result data.

Sort backend callbacks into documented stable order before publication. Do not
expose backend iteration order as a guarantee.

### Events, rendering, and persistence

- Publish Task 13 contact events only after the physics transaction commits.
- Render previous/current committed transforms with existing interpolation.
- Camera/culling changes drawing only and never stops off-screen simulation.
- Debug projections are renderer-neutral; Skia appears only in the reference
  renderer.
- Task 17 saves a game-owned body projection and recreates a fresh validated
  world. It never serializes backend memory, caches, pointers, or callbacks.

## Determinism statement

V1 promises stable command ordering, fixed `deltaSeconds`, stable ID sorting,
and repeatable traces within the validated backend/runtime/device constraints.
It does not promise bit-perfect cross-device equality. Floating-point math,
sleeping, backend algorithms, WASM/native builds, and CPUs can diverge.

Do not market the adapter for rollback or lockstep networking without a
separate proven backend and contract.

## Forward-compatibility constraints

V1 must permit later growth without creating a universal abstraction now.

- Keep public Gamekit values separate from the selected private backend.
- Keep commands/result extraction separate from scheduling and rendering.
- Keep shapes discriminated for future additions.
- Keep contact IDs/order stable enough for future queries and trace tooling.
- Keep save projections backend-neutral and game-owned.
- Do not expose backend selection, joint placeholders, polygon `any` fields,
  rollback toggles, or raw-handle escape hatches.

## V1 implementation tasks

### T18.0 — Research, spike, and make the go/no-go decision

- [x] Define one contact-heavy test world and one gameplay scene that truly
      requires rigid-body solving. *(Contact-heavy stacked-box world defined in
      the spike; the gameplay scene is moot under no-go — see evaluation record §1.)*
- [x] Evaluate current maintained backends against the required evidence.
      *(Five candidates from live registry metadata — see evaluation record.)*
- [ ] Build Expo-prebuild physical-device spikes for finalists. *(Not executed:
      no physical hardware in this environment — this is the blocking gate
      behind the no-go.)*
- [x] Prototype and failure-test the viable transaction strategies.
      *(Strategy 2 prototyped headlessly with a full-fidelity projection and
      negative controls: reconstruction is exact but authoritative continuation
      equivalence FAILS — private solver/warm-start state is unprojectable,
      giving ~0.55-unit transform divergence and reordered contact records
      under identical commands. Strategy 2 is RECORDED AS REJECTED for v1;
      strategy 3 is unavailable in planck; strategy 1 remains unproven and
      needs a separate approved session-core design — see evaluation record §2.)*
- [x] Freeze v1 budgets for startup, bundle/native size, step cost, restore,
      memory, and teardown. *(Evaluation record §3.)*
- [x] Write compile fixtures for the proposed v1 API and record the selected
      backend/version/peer range or a no-go result. *(No-go recorded; no API to
      fixture without an adapter.)*

#### T18.0 acceptance

- [x] At least one backend passes licensing, maintenance, Expo/Hermes,
      transaction, performance, teardown, and device requirements, or the task
      records no-go and stops without a production dependency.
      *(NO-GO recorded: planck.js passes static gates but the mandatory
      device-performance evidence cannot be produced; no production dependency;
      Collision2D unchanged.)*

### T18.1 — Implement immutable values and validation

*(Not executed — the T18.0 evaluation recorded a NO-GO, so no adapter
exists for these tasks to build on. They reopen only via the recorded
reopen triggers.)*

- [ ] Add focused configuration, body, shape, material, command, contact,
      result, and error modules.
- [ ] Reuse Gamekit geometry/filter values only where semantics match exactly.
- [ ] Validate values, IDs, references, duplicates, ranges, and command
      conflicts with exact paths.
- [ ] Keep public/root imports free of backend/native code.
- [ ] Prove caller and backend mutation cannot change published values.

### T18.2 — Implement the selected private adapter

*(Not executed — the T18.0 evaluation recorded a NO-GO, so no adapter
exists for these tasks to build on. They reopen only via the recorded
reopen triggers.)*

- [ ] Map v1 Gamekit values to private backend resources.
- [ ] Maintain stable ID-to-handle ownership without exposing handles.
- [ ] Apply commands in frozen order and step exactly once.
- [ ] Extract immutable transforms, velocities, sleep state, and contacts.
- [ ] Normalize/sort contacts and preserve backend error causes.
- [ ] Implement idempotent disposal and stale-generation rejection.

### T18.3 — Integrate transaction and session lifecycle

*(Not executed — the T18.0 evaluation recorded a NO-GO, so no adapter
exists for these tasks to build on. They reopen only via the recorded
reopen triggers.)*

- [ ] Integrate the selected transaction strategy at the fixed-step boundary.
- [ ] Discard partial results/events on every command, backend, scene, snapshot,
      or freeze failure.
- [ ] Restore/rebuild prior backend state before the next accepted step.
- [ ] Handle pause, transition, restart, catch-up, replacement, and disposal.
- [ ] Preserve zero physics work for games that do not create a physics world.

### T18.4 — Add contacts, events, and presentation

*(Not executed — the T18.0 evaluation recorded a NO-GO, so no adapter
exists for these tasks to build on. They reopen only via the recorded
reopen triggers.)*

- [ ] Publish ordered begin/stay/end contacts after successful commit.
- [ ] Map committed contact facts to typed Task 13 events.
- [ ] Publish previous/current transforms for GameView interpolation.
- [ ] Add renderer-neutral body, shape, contact, and bounds debug projections.
- [ ] Prove camera/culling and render failures cannot affect physics.

### T18.5 — Build the reference scene

*(Not executed — NO-GO; a v1 reference scene requiring rigid-body solving was
never approved because no backend passed the gates.)*

- [ ] Build one Physics Lab/reference scene using only public APIs.
- [ ] Demonstrate dynamic bodies, materials, sensors, sleep, impulses, pause,
      restart, failure recovery, camera, and debug overlays.
- [ ] Display step, conversion, contact, restore, and resource counts at control
      frequency.
- [ ] Verify close/reopen creates a fresh generation.
- [ ] Explain why Task 11 alone is not sufficient for this scene.

### T18.6 — Package, document, and verify v1

*(Partially satisfied via the NO-GO path below; packaging/docs rows for a
shipped adapter do not apply.)*

- [ ] Export the adapter only from `rn-gamekit/physics2d`.
- [ ] Configure the optional peer, clear missing-peer error, prebuild setup, and
      compatibility statement.
- [ ] Verify root/non-physics imports load no backend code.
- [ ] Add Optional rigid-body Physics2D documentation and a Collision2D versus
      Physics2D decision guide.
- [ ] Document bodies, commands, contacts, lifecycle, rendering, persistence,
      determinism limits, and backend/version constraints.
- [ ] Run focused validation, adapter, transaction-failure, lifecycle,
      interpolation, and teardown tests.
- [x] Record physical-device and release-like performance evidence or leave the
      adapter at no-go. *(Left at NO-GO — see plans/task-18-evaluation.md;
      device rows intentionally remain open as reopen triggers.)*

## V1 definition of done

- [x] One current backend passes the go/no-go gate, or a documented no-go ends
      the task without a production dependency. *(Documented NO-GO —
      plans/task-18-evaluation.md; no production dependency added.)*
- ~~Physics is available only through `rn-gamekit/physics2d` in the single
  package and the backend is an optional peer.~~ *(Moot under NO-GO: the
  subpath does not exist and no backend is declared. If reopened, this rule
  binds the adapter from its first commit.)*
- [x] Task 11 remains the default no-backend collision path.
- ~~Public Gamekit values and stable IDs hide all backend objects.~~ *(Moot
  under NO-GO: no backend objects exist to hide; the strategy-2 spike kept all
  planck handles private.)*
- ~~GameSession owns the only physics step clock.~~ *(Moot under NO-GO: no
  physics clock exists; sessions run without any physics work.)*
- ~~Failed ticks cannot leave the backend ahead of committed state.~~ *(Moot
  under NO-GO: no backend is stepped. Strategy 2 was rejected precisely
  because it could not guarantee this for planck.)*
- ~~Commands, bodies, and contacts have stable ordering and tested lifecycle
  semantics.~~ *(Moot under NO-GO: no commands or contacts are exposed.)*
- ~~Rendering, camera, culling, pause, replacement, and saves respect the
  authority boundary.~~ *(Moot under NO-GO: nothing physics-related renders,
  pauses, or saves.)*
- ~~The reference scene uses public APIs and proves a genuine solver need.~~
  *(Moot under NO-GO: no reference scene was built or required.)*
- [x] Compatibility, performance, and device evidence is published honestly.
      *(Backend registry evidence, transaction-trial results, Node-only
      timings, and explicitly open device rows are published in
      plans/task-18-evaluation.md.)*

## Review feedback

This isolated review covers `fc19626`. The review did not rerun benchmarks or
repeat the backend research. It confirms that `planck@1.5.0` is dev-only, no
`rn-gamekit/physics2d` export exists, and nothing under `packages/gamekit/src`
imports Planck. The documented no-go remains the correct shipping decision.

### T18-R1 — The spike times reconstruction but does not prove transaction restore (Important)

`spike-physics2d.mjs` rebuilds from the initial body positions captured during
`buildWorld()`. It never extracts an immutable projection from a world after it
has stepped, injects a failed tick, restores that prior state, or compares the
restored world with a control trace. The projection omits state needed for an
equivalent restore, including current angle, linear/angular velocity, awake/sleep
state, and fixture restitution (the authored fixture uses `0.05`, but the rebuilt
fixture receives no restitution). Consequently the evaluation cannot yet claim
that strategy 2 is viable or failure-tested; it currently proves only that a
simplified world can be constructed quickly in Node.

The performance record is also based on one rebuild timing per size, while the
600-step "contact-heavy" sample does not record awake-body/contact counts to prove
that the measured world remains active rather than settling during the run.

Required approach:

- Keep the NO-GO outcome, dev-only dependency, and device gates unchanged. This
  correction does not authorize or require a production Physics2D adapter.
- Rename the current evidence to a construction/rebuild timing spike until the
  transaction property below is demonstrated. Uncheck or qualify the T18.0
  "prototype and failure-test" row and remove "strategy 2 is viable" from the
  evaluation in the meantime.
- Define the minimum immutable prior-state projection required by the proposed v1
  contract: stable body/shape IDs, body type, current transform, linear/angular
  velocity, awake state and relevant body/material/filter properties. Preserve
  every projected field through rebuild.
- Build two identical seeded worlds. Advance both to a nontrivial committed state,
  mutate one with a candidate tick and simulate a later failure, rebuild it from
  the saved prior projection, then assert its normalized projection equals the
  untouched control before advancing both through the same subsequent commands.
  Compare ordered transforms, velocities, sleeping state, and contact lifecycle
  for a bounded trace.
- Add explicit negative checks by omitting one required field (for example angular
  velocity or restitution) and prove the equivalence test fails.
- Measure rebuild over a warmup plus multiple samples per body count and report
  p50/p95/p99 rather than one timing. For the active-step scenario, record or
  enforce awake-body/contact counts per sample so "contact-heavy" is measurable;
  keep all results labelled Node-only.
- Update `task-18-evaluation.md` and the T18.0 checkbox wording to match the actual
  evidence. The physical-device matrix should remain open and the final shipping
  decision should remain NO-GO.

### T18-R2 — The failure test demonstrates divergence, not a viable transaction restore (Important)

The revised spike now proves exact reconstruction of its projected public body
fields, but it also proves that this projection is not the backend's complete
transaction state. Planck's warm-start/contact solver state is lost during rebuild.
With identical subsequent commands, the restored and untouched worlds diverge by
about `0.55` world units and produce reshuffled contact begin/end facts. Those are
gameplay-observable differences after a tick that was supposed to have no effect.

Suppressing contacts only on the first restore step does not fix later contact
reshuffling or transform divergence. Event consumers may award damage, play
effects, or change authoritative scene state during that transient. Eventual
settling within `0.05` units is a useful diagnostic, but it is not transaction
equivalence and cannot establish that the failed tick left no lasting gameplay
effect.

The spike currently reinforces the incorrect conclusion by declaring
`MAX_TRACE_DELTA = 0.25` and then discarding it with `void MAX_TRACE_DELTA`; any
finite transient passes. It records only aggregate contact counts rather than the
ordered body/shape contact lifecycle promised by the task, and the final settling
gate compares position/sleep state but not the full observable trace or resting
rotation.

Required approach:

- Keep the full-fidelity projection, negative controls, timing distributions,
  dev-only dependency, and overall NO-GO decision.
- Change the evaluation conclusion to: strategy 2 reconstructs the selected public
  fields exactly but **fails authoritative continuation equivalence** because
  private solver state is unavailable. Record strategy 2 as rejected for v1.
- Treat convergence and contact-count results as diagnostics only. Do not describe
  them as proving that a failed tick has no lasting effect or that strategy 2 is
  viable.
- Remove the unused `MAX_TRACE_DELTA`, or make it an actual failing assertion for
  diagnostic experiments. Do not choose a loose tolerance merely to make the
  current trace pass.
- If strategy 2 is ever reconsidered, require the restored and untouched worlds to
  produce the same bounded sequence of normalized transforms/velocities/sleeping
  state and ordered contact begin/stay/end records under identical commands. A
  documented numeric tolerance may cover floating-point noise, but not different
  contacts or half-body-scale motion.
- Update the spike header, evaluation §2, T18.0 checkbox note, and status so they
  agree: strategy 2 was prototyped and rejected; strategy 3 is unavailable;
  strategy 1 remains unproven and would need a separate approved session-core
  design. Physical-device rows remain open, no adapter ships, and Task 18 stays a
  documented NO-GO.

### T18-R3 — The rejection harness can pass when its comparison is invalid (Important)

The strategy verdict is now correct, and transform/contact divergence is enforced
as the expected rejection. However, `runTrial()` returns
`{ restoreExact: true, continuationEquivalent: false }` for a non-finite delta.
The main program interprets every `continuationEquivalent === false` as the
expected strategy rejection and exits successfully. A NaN/Infinity or malformed
comparison therefore passes the harness even though the commit states that
harness-invariant failures must exit nonzero.

The continuation delta currently compares only x/y position and x/y linear
velocity. It does not compare angle, angular velocity, or awake/sleep state despite
the spike/evaluation promising normalized transforms, velocities, and sleeping
state. Contact arrays are accumulated across the whole trace rather than recorded
as explicit per-step sequences, so after the first mismatch the harness cannot
characterize later step equality independently. Finally, the output reads
`trial.settleContacts`, which is never returned (`settleBeginA` and `settleEndB`
are), so the diagnostic always prints `undefined`.

Required approach:

- Return a discriminated trial result separating `harnessValid` from
  `continuationEquivalent`. Mark non-finite values, missing/misaligned bodies,
  duplicate IDs, length mismatches, and malformed contact records as invalid;
  main must set a nonzero exit code for any invalid result.
- Compare bodies by stable game-owned ID and validate identical ID sets before
  calculating deltas. Cover x/y/angle, linear x/y velocity, angular velocity,
  and awake state with explicit per-field tolerances; boolean/lifecycle fields
  must match exactly.
- Capture contact records as a sequence per continuation step, with canonical
  body/shape identity and deterministic ordering. Compare each step independently
  and retain the first differing step plus representative samples. Begin/end is
  sufficient for the current rejection spike; do not claim `stay` evidence unless
  active-contact state is actually derived and compared.
- Fix the settling diagnostic to print fields that the result really returns, or
  return one typed/validated settling diagnostic object. Diagnostics must never
  influence the rejection acceptance rule.
- Add focused self-checks/negative controls for NaN, a missing body, angle-only
  divergence, awake-only divergence, and a contact mismatch after an otherwise
  equal earlier step. Each must prove the harness rejects invalid input or detects
  authoritative divergence for the intended reason.
- Keep the strategy-2 rejection, NO-GO, dev-only dependency, and open device rows
  unchanged. Update the spike/evaluation wording only where it currently
  overstates the fields and contact lifecycle actually compared.

### T18-R4 — Baseline restoration and the claimed full-field contract are incomplete (Important)

The new `harnessValid` discrimination correctly prevents NaN, missing bodies, and
other validated comparison failures from becoming the expected strategy rejection.
However, the main path does not explicitly require the baseline trial's
`restoreExact === true`. If an ordinary (non-negative-control) restoration becomes
divergent, `runTrial()` returns a harness-valid result with
`continuationEquivalent: null`; main then enters the normal branch and eventually
dereferences missing continuation diagnostics. That currently fails by incidental
exception rather than a deliberate invariant verdict.

The comparator also does not yet cover every field in the stated full-fidelity
projection. It compares body type, gravity scale, awake state, motion values and
shape materials/sensor state, but omits `fixedRotation` and shape kind/geometry
(`kind`, `hw`, `hh`, `radius`). `validateProjection()` likewise does not validate
those geometry/type/boolean fields or duplicate shape IDs. A rebuild could corrupt
them while "exact restoration of public fields" still passes.

Finally, `measureStepCost()` was changed to return `{p50,p95,p99}`, but main ignores
that return value. The current reproducible spike prints headings followed by no
step-cost rows even though the evaluation retains and describes those diagnostics.

Required approach:

- After the baseline `runTrial(128)`, require `harnessValid === true` and
  `restoreExact === true` before reading continuation/settling fields. Report an
  unexpected restore failure explicitly and set exit code 1; do not rely on a
  later TypeError. Keep omitted-field trials as the only expected
  `restoreExact === false` path.
- Extend validation/comparison to the complete projected contract actually used by
  rebuild: valid body type, `fixedRotation`, finite/valid shape geometry, shape
  kind, sensor boolean, and unique non-empty shape IDs per body. Compare those
  fields exactly or with an explicit geometry tolerance where appropriate.
- Add self-checks for fixed-rotation-only divergence, shape-geometry divergence,
  duplicate shape IDs, and the unexpected baseline restoration branch. Each must
  fail for the intended classified reason.
- Either print the returned step-cost distributions in main or restore printing
  inside `measureStepCost()`. Keep awake/contact counters in the returned record so
  the output continues to substantiate the active-scene claim; update recorded
  numbers only when the spike actually emits them.
- Keep the R3 invalid-result checks, per-step begin/end comparison, strategy-2
  rejection, overall NO-GO, dev-only Planck dependency, and open device rows
  unchanged.

Resolution verified in `d0941e6`: baseline restore failure is an explicit
nonzero invariant verdict; fixed rotation, shape identity/geometry, materials,
and sensors are validated and compared; the expanded self-check suite exercises
the new branches; and main prints the returned step-cost records. No further
isolated review findings remain.

## Future expansion backlog

These roadmap items remain preserved and non-blocking.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| PHYSICS-F1 | Joints and constraints | A reference game needs a specific joint family with portable semantics |
| PHYSICS-F2 | Polygon, capsule, chain, and heightfield shapes | The selected backend and Gamekit geometry contract can represent them safely |
| PHYSICS-F3 | Ray casts, shape casts, and richer queries | Real gameplay needs queries beyond Task 11 and v1 contacts |
| PHYSICS-F4 | Advanced CCD and material/contact controls | Fast-body or contact customization requirements exceed v1 |
| PHYSICS-F5 | Multiple backend adapters | A second backend has a compelling platform/capability advantage |
| PHYSICS-F6 | Rollback, lockstep, and server simulation | A deterministic networking milestone selects a suitable backend |
| PHYSICS-F7 | 3D physics | The 3D world, renderer, camera, and asset contracts exist |
| PHYSICS-F8 | Soft bodies, cloth, fluids, vehicles, and destruction | Separate specialized system plans are approved |
| PHYSICS-F9 | Collider generation from authored assets | Asset metadata, editing, and authority contracts are designed |
| PHYSICS-F10 | Visual physics tooling | Public physics contracts have stabilized across real games |
| PHYSICS-F11 | Backend-specific advanced escape surface | A safe capability-specific API is proven without leaking raw handles |

## Implementation order

Implement Task 18 in this order:

1. T18.0 research, device spikes, transaction prototypes, and go/no-go.
2. T18.1 immutable public values.
3. T18.2 selected private adapter.
4. T18.3 transaction/session integration.
5. T18.4 contacts, events, and presentation.
6. T18.5 reference scene.
7. T18.6 packaging, docs, and focused verification.

Do not install a backend before T18.0 proves maintenance, Expo/Hermes support,
transaction recovery, and target-device viability.
