/**
 * T18.0 headless spike — planck.js 1.5.0 transaction-strategy prototype.
 *
 * VERDICT (Node-only evidence — see plans/task-18-evaluation.md):
 *   Strategy 2 (rebuild-from-immutable-projection) is PROTOTYPED AND REJECTED.
 *
 * The spike demonstrates two facts:
 *
 * 1. The full-fidelity public projection (IDs, type, transform, linear/angular
 *    velocity, awake state, gravity scale, materials incl. restitution)
 *    restores EXACTLY field-for-field after a simulated tick failure.
 * 2. Despite exact restoration, strategy 2 FAILS authoritative continuation
 *    equivalence: planck's private solver/warm-start contact state cannot be
 *    projected or rebuilt, so under identical subsequent commands the restored
 *    world diverges beyond the frozen budget and produces reshuffled ordered
 *    contact begin/end records. Those are gameplay-observable differences
 *    after a tick that was supposed to have no effect.
 *
 * Negative controls (omitting angularVelocity / fixture restitution from the
 * projection) verify the equivalence harness actually discriminates.
 *
 * This is NOT device performance evidence.
 */
import Planck from 'planck';

const FIXED_DT = 1 / 60;
const SAMPLES = 600;
const REBUILD_SAMPLES = 40;
const REBUILD_WARMUP = 5;

/** Frozen v1 diagnostic-experiment budget (evaluation record §3): enforced. */
const MAX_TRACE_DELTA = 0.25;
const TRACE = 60;
const STEPS_TO_COMMIT = 240;
// ---------------------------------------------------------------------------
// Projection (full-fidelity public-field contract)
// ---------------------------------------------------------------------------

function extractProjection(world) {
  // Planck's body list is prepend-ordered (most recent first); reverse the
  // traversal to recover original CREATION order for private rebuild metadata.
  const traversed = [];
  for (const body of iterateBodies(world)) traversed.push(body);
  const out = [];
  let order = 0;
  for (const body of traversed.reverse()) {
    const ud = body.getUserData() || {};
    const shapes = [];
    for (const fixture of iterateFixtures(body)) {
      const fud = fixture.getUserData() || {};
      shapes.push({
        id: fud.id,
        kind: fud.kind,
        hw: fud.hw,
        hh: fud.hh,
        radius: fud.radius ?? null,
        density: fixture.getDensity(),
        friction: fixture.getFriction(),
        restitution: fixture.getRestitution(),
        sensor: fixture.isSensor(),
      });
    }
    out.push({
      id: ud.id,
      _order: order++,
      type: body.isDynamic() ? 'dynamic' : body.isKinematic() ? 'kinematic' : 'static',
      x: body.getPosition().x,
      y: body.getPosition().y,
      angle: body.getAngle(),
      vx: body.getLinearVelocity().x,
      vy: body.getLinearVelocity().y,
      angularVelocity: body.getAngularVelocity(),
      awake: body.isAwake(),
      fixedRotation: ud.fixedRotation ?? false,
      gravityScale: body.getGravityScale(),
      shapes,
    });
  }
  return out;
}

/** Drop one projected field everywhere — negative controls. */
function omitField(projection, field) {
  return projection.map((b) => {
    if (field.startsWith('fixture:')) {
      const f = field.slice('fixture:'.length);
      return { ...b, shapes: b.shapes.map((s) => ({ ...s, [f]: 0 })) };
    }
    return { ...b, [field]: field === 'awake' || field === 'fixedRotation' ? false : 0 };
  });
}

function rebuildFrom(projection, mutateFixture) {
  const world = new Planck.World({ gravity: new Planck.Vec2(0, -9.8) });
  // Recreate bodies in original creation order (private metadata).
  const ordered = [...projection].sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
  for (const b of ordered) {
    const body = world.createBody({
      type: b.type,
      position: new Planck.Vec2(b.x, b.y),
      angle: b.angle,
      fixedRotation: b.fixedRotation,
      gravityScale: b.gravityScale,
      userData: { id: b.id, fixedRotation: b.fixedRotation },
    });
    if (!b.fixedRotation) body.setAngularVelocity(b.angularVelocity);
    body.setLinearVelocity(new Planck.Vec2(b.vx, b.vy));
    // Freshly created bodies (including static) default to awake — mirror the
    // projected sleep flag exactly for every type.
    if (!b.awake) body.setAwake(false);
    for (const s of b.shapes) {
      const shape = s.kind === 'circle' ? new Planck.Circle(s.radius) : new Planck.Box(s.hw, s.hh);
      let fixture = {
        density: s.density,
        friction: s.friction,
        restitution: s.restitution,
        isSensor: s.sensor,
        userData: { id: s.id, kind: s.kind, hw: s.hw, hh: s.hh, radius: s.radius },
      };
      if (mutateFixture) fixture = mutateFixture(fixture);
      body.createFixture(shape, fixture);
    }
  }
  return world;
}

function normalize(projection) {
  return projection.map((b) => ({
    id: b.id,
    type: b.type,
    x: round(b.x),
    y: round(b.y),
    angle: round(b.angle),
    vx: round(b.vx),
    vy: round(b.vy),
    angularVelocity: round(b.angularVelocity),
    awake: b.awake,
    gravityScale: b.gravityScale,
    shapes: [...b.shapes]
      .sort((a, z) => (a.id < z.id ? -1 : 1))
      .map((s) => ({ id: s.id, density: round(s.density), friction: round(s.friction), restitution: round(s.restitution), sensor: s.sensor })),
  }));
}

function round(v) {
  return Math.round(v * 1e6) / 1e6;
}

function projectionEquals(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function firstMismatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  for (let i = 0; i < Math.max(na.length, nb.length); i += 1) {
    const ba = na[i];
    const bb = nb[i];
    if (!ba || !bb) return `body ${i}: missing (${ba?.id} vs ${bb?.id})`;
    for (const key of Object.keys(ba)) {
      const va = JSON.stringify(ba[key]);
      const vb = JSON.stringify(bb[key]);
      if (va !== vb) return `${ba.id}.${key}: ${va} vs ${vb}`;
    }
  }
  return 'none';
}

// ---------------------------------------------------------------------------
// Seeded worlds, command stream, contact recording
// ---------------------------------------------------------------------------

function buildWorld(bodyCount) {
  const world = new Planck.World({ gravity: new Planck.Vec2(0, -9.8) });
  const ground = world.createBody({
    type: 'static',
    position: new Planck.Vec2(0, 0),
    userData: { id: 'ground' },
  });
  ground.createFixture(new Planck.Box(500, 0.5), {
    friction: 0.6,
    restitution: 0,
    density: 0,
    userData: { id: 'ground-shape', kind: 'box', hw: 500, hh: 0.5 },
  });
  const side = Math.ceil(Math.sqrt(bodyCount));
  for (let i = 0; i < bodyCount; i += 1) {
    const col = i % side;
    const row = Math.floor(i / side);
    const body = world.createBody({
      type: 'dynamic',
      position: new Planck.Vec2(col * 1.05 - (side * 1.05) / 2, 1 + row * 1.05),
      userData: { id: `b${i}` },
    });
    body.createFixture(new Planck.Box(0.5, 0.5), {
      density: 1,
      friction: 0.4,
      restitution: 0.05,
      userData: { id: `b${i}-shape`, kind: 'box', hw: 0.5, hh: 0.5 },
    });
  }
  return world;
}

function commandsForStep(step, size) {
  const cmds = [];
  const n = Math.min(8, size);
  for (let k = 0; k < n; k += 1) cmds.push((step * 7 + k * 13) % size);
  return cmds;
}

function applyCommands(world, step, size) {
  for (const idx of commandsForStep(step, size)) {
    const body = findBody(world, `b${idx}`);
    if (body && body.isAwake() !== false && body.isDynamic()) {
      body.applyLinearImpulse(new Planck.Vec2(0, 0.4), body.getWorldCenter(), true);
    }
  }
}

function findBody(world, id) {
  for (const body of iterateBodies(world)) {
    if ((body.getUserData() || {}).id === id) return body;
  }
  return undefined;
}

function* iterateBodies(world) {
  let b = world.getBodyList();
  while (b) {
    yield b;
    b = b.getNext();
  }
}

function* iterateFixtures(body) {
  let f = body.getFixtureList();
  while (f) {
    yield f;
    f = f.getNext();
  }
}

/**
 * Step the world; append ordered contact lifecycle records ('begin:a|b') to
 * `events` when provided. Event identity uses game-owned body IDs in a
 * canonical pair order.
 */
function stepWithContacts(world, events) {
  const record = (contact, kind) => {
    if (!events) return;
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();
    const ia = (fa.getBody().getUserData() || {}).id ?? '?';
    const ib = (fb.getBody().getUserData() || {}).id ?? '?';
    const [x, y] = ia <= ib ? [ia, ib] : [ib, ia];
    events.push(`${kind}:${x}|${y}`);
  };
  const onBegin = (c) => record(c, 'begin');
  const onEnd = (c) => record(c, 'end');
  world.on('begin-contact', onBegin);
  world.on('end-contact', onEnd);
  try {
    world.step(FIXED_DT);
  } finally {
    world.off('begin-contact', onBegin);
    world.off('end-contact', onEnd);
  }
}

function awakeCount(world) {
  let n = 0;
  for (const body of iterateBodies(world)) if (body.isAwake()) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Strategy-2 trial: exact restoration vs authoritative continuation
// ---------------------------------------------------------------------------

function runTrial(size, { omit } = {}) {
  const worldA = buildWorld(size);
  const worldB = buildWorld(size);

  // Phase 1: identical committed advance.
  for (let s = 0; s < STEPS_TO_COMMIT; s += 1) {
    applyCommands(worldA, s, size);
    applyCommands(worldB, s, size);
    stepWithContacts(worldA, null);
    stepWithContacts(worldB, null);
  }
  if (!projectionEquals(extractProjection(worldA), extractProjection(worldB))) {
    return { restoreExact: false, reason: 'pre-tick divergence between seeded worlds' };
  }

  // Phase 2: save the immutable PRIOR projection; candidate takes one more
  // commanded tick; then FAILURE — its stepped state is discarded and it is
  // rebuilt from the prior projection.
  const priorProjection = extractProjection(worldA);
  const damagedProjection = omit ? omitField(priorProjection, omit) : priorProjection;
  applyCommands(worldA, STEPS_TO_COMMIT, size);
  stepWithContacts(worldA, null);
  const controlBeforeAdvance = extractProjection(worldB);
  const restoredWorld = rebuildFrom(damagedProjection);

  // Requirement (a): EXACT body-state restoration.
  const restoreExact = projectionEquals(extractProjection(restoredWorld), controlBeforeAdvance);
  if (!restoreExact) {
    return {
      restoreExact: false,
      reason: omit
        ? `restoration FAILED with omitted "${omit}" (expected negative control)`
        : `restoration FAILED unexpectedly. first-mismatch: ${firstMismatch(extractProjection(restoredWorld), controlBeforeAdvance)}`,
    };
  }

  // Requirement (b): AUTHORITATIVE CONTINUATION EQUIVALENCE. Both worlds take
  // the same subsequent commands; normalized transforms/velocities/sleeping
  // must stay within the frozen budget AND ordered contact lifecycle records
  // must match. Warm-start loss makes this fail — that is the rejection
  // evidence.
  let maxDeltaSeen = 0;
  let divergedAtStep = -1;
  let contactDivergedAtStep = -1;
  let sampleContactA = '';
  let sampleContactB = '';
  const evRestored = [];
  const evControl = [];
  for (let s = 0; s < TRACE; s += 1) {
    applyCommands(restoredWorld, STEPS_TO_COMMIT + 1 + s, size);
    applyCommands(worldB, STEPS_TO_COMMIT + 1 + s, size);
    stepWithContacts(restoredWorld, evRestored);
    stepWithContacts(worldB, evControl);

    const pa = normalize(extractProjection(restoredWorld));
    const pb = normalize(extractProjection(worldB));
    const delta = pa.reduce((m, b, i) => Math.max(m, Math.abs(b.x - pb[i].x), Math.abs(b.y - pb[i].y), Math.abs(b.vx - pb[i].vx), Math.abs(b.vy - pb[i].vy)), 0);
    if (!Number.isFinite(delta)) {
      return { restoreExact: true, continuationEquivalent: false, divergedAtStep: s, reason: 'non-finite divergence' };
    }
    maxDeltaSeen = Math.max(maxDeltaSeen, delta);
    if (divergedAtStep < 0 && delta > MAX_TRACE_DELTA) divergedAtStep = s;
    if (contactDivergedAtStep < 0 && evRestored.join(',') !== evControl.join(',')) contactDivergedAtStep = s;
  }

  const continuationEquivalent = maxDeltaSeen <= MAX_TRACE_DELTA && contactDivergedAtStep < 0;

  // Diagnostics ONLY (not transaction equivalence): eventual settling.
  const evSettleA = [];
  const evSettleB = [];
  for (let s = 0; s < 900; s += 1) {
    stepWithContacts(restoredWorld, evSettleA);
    stepWithContacts(worldB, evSettleB);
  }
  const finalA = normalize(extractProjection(restoredWorld));
  const finalB = normalize(extractProjection(worldB));
  let finalMaxDelta = 0;
  let awakeMismatch = false;
  for (let i = 0; i < finalA.length; i += 1) {
    finalMaxDelta = Math.max(finalMaxDelta, Math.abs(finalA[i].x - finalB[i].x), Math.abs(finalA[i].y - finalB[i].y));
    if (finalA[i].awake !== finalB[i].awake) awakeMismatch = true;
  }

  sampleContactA = evRestored.slice(0, 6).join(', ');
  sampleContactB = evControl.slice(0, 6).join(', ');

  return {
    restoreExact: true,
    continuationEquivalent,
    maxDeltaSeen,
    divergedAtStep,
    contactDivergedAtStep,
    finalMaxDelta,
    awakeMismatch,
    sampleContactA,
    sampleContactB,
    settleBeginA: evSettleA.length,
    settleEndB: evSettleB.length,
    reason: continuationEquivalent
      ? 'continuation stayed within budget (unexpected under warm-start loss)'
      : `continuation diverged: max=${maxDeltaSeen.toFixed(4)} > budget ${MAX_TRACE_DELTA} at step ${divergedAtStep}; ordered contact records diverged at step ${contactDivergedAtStep}`,
  };
}

// ---------------------------------------------------------------------------
// Timing: step cost with enforced activity counters + rebuild distribution
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function measureStepCost(size, label) {
  const world = buildWorld(size);
  let begins = 0;
  const onBegin = () => {
    begins += 1;
  };
  world.on('begin-contact', onBegin);
  for (let i = 0; i < 10; i += 1) world.step(FIXED_DT);
  const beginAtStart = begins;
  const samples = [];
  let minAwake = Infinity;
  for (let i = 0; i < SAMPLES; i += 1) {
    applyCommands(world, i, size);
    const t0 = performance.now();
    world.step(FIXED_DT);
    samples.push(performance.now() - t0);
    minAwake = Math.min(minAwake, awakeCount(world));
  }
  world.off('begin-contact', onBegin);
  samples.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(16)} bodies=${String(size).padStart(3)}  step p50=${percentile(samples, 50).toFixed(3)}ms  p95=${percentile(samples, 95).toFixed(3)}ms  p99=${percentile(samples, 99).toFixed(3)}ms  | awake(min)=${minAwake}  contact-begins=${begins - beginAtStart}`,
  );
}

function measureRebuild(size) {
  const w = buildWorld(size);
  const projection = extractProjection(w);
  for (let i = 0; i < REBUILD_WARMUP; i += 1) rebuildFrom(projection);
  const samples = [];
  for (let i = 0; i < REBUILD_SAMPLES; i += 1) {
    const t0 = performance.now();
    rebuildFrom(projection);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), p99: percentile(samples, 99) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`planck.js 1.5.0 | node ${process.version} | strategy-2 transaction trial (Node-only)\n`);

console.log('--- strategy-2 trial @128 bodies ---');
const trial = runTrial(128);
let consistent = true;

if (!trial.restoreExact) {
  console.log(`FAIL: exact restoration invariant broken — ${trial.reason}`);
  consistent = false;
} else {
  console.log(`exact restoration of public fields: PASS`);
}
console.log(`authoritative continuation equivalence: ${trial.continuationEquivalent ? 'PASS' : 'FAIL'} — ${trial.reason}`);
console.log(`  ordered contact records: ${trial.contactDivergedAtStep >= 0 ? `diverged at step ${trial.contactDivergedAtStep}` : 'equivalent'}`);
console.log(`  restored sample: [${trial.sampleContactA}]`);
console.log(`  control  sample: [${trial.sampleContactB}]`);
console.log(`  diagnostics only — settled-converged max=${trial.finalMaxDelta?.toExponential(2)}, sleep-mismatch=${trial.awakeMismatch}, settling contacts ${trial.settleContacts}`);

console.log('\n--- negative controls (harness discrimination) ---');
for (const field of ['angularVelocity', 'fixture:restitution']) {
  const neg = runTrial(128, { omit: field });
  const correctlyFails = !neg.restoreExact;
  console.log(`omit "${field}": ${correctlyFails ? 'correctly FAILS restoration' : 'DID NOT FAIL (unexpected)'}`);
  if (!correctlyFails) consistent = false;
}

console.log('\n--- VERDICT ---');
if (!consistent) {
  console.log('INCONSISTENT: an invariant of the harness itself was violated.');
  process.exitCode = 1;
} else if (trial.continuationEquivalent) {
  console.log('Strategy 2 PASSED continuation equivalence under the frozen budget.');
  console.log('This contradicts the recorded rejection — update plans/task-18-evaluation.md.');
  process.exitCode = 1;
} else {
  console.log('Strategy 2 is REJECTED for v1: reconstruction of public fields is exact,');
  console.log('but private solver/warm-start state is unavailable, so authoritative');
  console.log('continuation equivalence FAILS (gameplay-observable transform divergence');
  console.log('and reshuffled contact records). See plans/task-18-evaluation.md §2.');
}

console.log('\n--- step cost, active phase enforced (diagnostics; Node-only) ---');
measureStepCost(32, 'contact-heavy');
measureStepCost(128, 'contact-heavy');
measureStepCost(512, 'contact-heavy');

console.log(`\n--- rebuild-from-projection distribution (${REBUILD_SAMPLES} samples, ${REBUILD_WARMUP} warmup) ---`);
for (const size of [32, 128, 512]) {
  const r = measureRebuild(size);
  console.log(
    `rebuild          bodies=${String(size).padStart(3)}  p50=${r.p50.toFixed(3)}ms  p95=${r.p95.toFixed(3)}ms  p99=${r.p99.toFixed(3)}ms`,
  );
}
