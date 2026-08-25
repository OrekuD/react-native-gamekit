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

/**
 * Per-field continuation tolerances (floating-point noise only — never a
 * license for different contacts or half-body-scale motion).
 */
const FIELD_TOLERANCES = {
  x: 1e-6,
  y: 1e-6,
  angle: 1e-6,
  vx: 1e-6,
  vy: 1e-6,
  angularVelocity: 1e-6,
};

// ---------------------------------------------------------------------------
// Projection (full-fidelity public-field contract)
// ---------------------------------------------------------------------------

function extractProjection(world) {
  // Planck's body list is prepend-ordered; reverse to recover creation order.
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

function omitField(projection, field) {
  return projection.map((b) => {
    if (field.startsWith('fixture:')) {
      const f = field.slice('fixture:'.length);
      return { ...b, shapes: b.shapes.map((s) => ({ ...s, [f]: 0 })) };
    }
    return { ...b, [field]: field === 'awake' || field === 'fixedRotation' ? false : 0 };
  });
}

function rebuildFrom(projection) {
  const world = new Planck.World({ gravity: new Planck.Vec2(0, -9.8) });
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
    if (!b.awake) body.setAwake(false);
    for (const s of b.shapes) {
      const shape = s.kind === 'circle' ? new Planck.Circle(s.radius) : new Planck.Box(s.hw, s.hh);
      body.createFixture(shape, {
        density: s.density,
        friction: s.friction,
        restitution: s.restitution,
        isSensor: s.sensor,
        userData: { id: s.id, kind: s.kind, hw: s.hw, hh: s.hh, radius: s.radius },
      });
    }
  }
  return world;
}

// ---------------------------------------------------------------------------
// State comparison: validated, ID-keyed, full-field
// ---------------------------------------------------------------------------

/** Structural validation of one projection. Returns an error string or null. */
function validateProjection(projection) {
  const seen = new Set();
  for (const b of projection) {
    if (typeof b.id !== 'string' || b.id.length === 0) return 'body with missing/invalid id';
    if (seen.has(b.id)) return 'duplicate body id ' + b.id;
    seen.add(b.id);
    for (const key of ['x', 'y', 'angle', 'vx', 'vy', 'angularVelocity', 'gravityScale']) {
      if (!Number.isFinite(b[key])) return 'non-finite ' + key + ' on ' + b.id;
    }
    if (typeof b.awake !== 'boolean') return 'non-boolean awake on ' + b.id;
    if (!Array.isArray(b.shapes)) return 'missing shapes on ' + b.id;
    for (const s of b.shapes) {
      if (typeof s.id !== 'string') return 'shape with missing id on ' + b.id;
      if (!Number.isFinite(s.density) || !Number.isFinite(s.friction) || !Number.isFinite(s.restitution)) {
        return 'non-finite material on ' + b.id + '/' + s.id;
      }
    }
  }
  return null;
}

/**
 * Authoritative state comparison keyed by stable game-owned ID.
 *
 * Returns a discriminated result:
 *   { kind: 'invalid', reason }            — malformed input (harness fault)
 *   { kind: 'equivalent' }                 — within tolerances / exact booleans
 *   { kind: 'divergent', id, field, detail } — authoritative divergence
 *
 * Numeric fields use their per-field tolerance; awake/type/fixedRotation and
 * shape materials/sensors must match exactly.
 */
function compareStates(aProjection, bProjection) {
  if (aProjection.length !== bProjection.length) {
    return { kind: 'invalid', reason: 'body count mismatch: ' + aProjection.length + ' vs ' + bProjection.length };
  }
  const mapA = new Map();
  for (const b of aProjection) {
    if (mapA.has(b.id)) return { kind: 'invalid', reason: 'duplicate body id in A: ' + b.id };
    mapA.set(b.id, b);
  }
  for (const b of bProjection) {
    if (!mapA.has(b.id)) return { kind: 'invalid', reason: 'body present only in B: ' + b.id };
  }
  for (const [id, a] of mapA) {
    const b = bProjection.find((x) => x.id === id);
    if (b === undefined) return { kind: 'invalid', reason: 'body missing from B: ' + id };
    for (const [field, tol] of Object.entries(FIELD_TOLERANCES)) {
      const va = a[field];
      const vb = b[field];
      if (!Number.isFinite(va) || !Number.isFinite(vb)) {
        return { kind: 'invalid', reason: 'non-finite ' + field + ' on ' + id };
      }
      if (Math.abs(va - vb) > tol) {
        return { kind: 'divergent', id, field, detail: va + ' vs ' + vb };
      }
    }
    if (a.awake !== b.awake) return { kind: 'divergent', id, field: 'awake', detail: a.awake + ' vs ' + b.awake };
    if (a.type !== b.type) return { kind: 'divergent', id, field: 'type', detail: a.type + ' vs ' + b.type };
    if (a.gravityScale !== b.gravityScale) {
      return { kind: 'divergent', id, field: 'gravityScale', detail: a.gravityScale + ' vs ' + b.gravityScale };
    }
    const sa = [...a.shapes].sort((x, z) => (x.id < z.id ? -1 : 1));
    const sb = [...b.shapes].sort((x, z) => (x.id < z.id ? -1 : 1));
    if (sa.length !== sb.length) return { kind: 'divergent', id, field: 'shapes', detail: 'count mismatch' };
    for (let i = 0; i < sa.length; i += 1) {
      if (sa[i].id !== sb[i].id) return { kind: 'divergent', id, field: 'shapes', detail: 'shape id ' + sa[i].id + ' vs ' + sb[i].id };
      for (const key of ['density', 'friction', 'restitution']) {
        if (Math.abs(sa[i][key] - sb[i][key]) > 1e-6) {
          return { kind: 'divergent', id, field: key + ':' + sa[i].id, detail: sa[i][key] + ' vs ' + sb[i][key] };
        }
      }
      if (sa[i].sensor !== sb[i].sensor) return { kind: 'divergent', id, field: 'sensor:' + sa[i].id, detail: 'mismatch' };
    }
  }
  return { kind: 'equivalent' };
}

/** Exact ordered-sequence comparison for one step's contact records. */
function contactSequenceEquals(seqA, seqB) {
  if (seqA.length !== seqB.length) return false;
  for (let i = 0; i < seqA.length; i += 1) {
    if (seqA[i] !== seqB[i]) return false;
  }
  return true;
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
      userData: { id: 'b' + i },
    });
    body.createFixture(new Planck.Box(0.5, 0.5), {
      density: 1,
      friction: 0.4,
      restitution: 0.05,
      userData: { id: 'b' + i + '-shape', kind: 'box', hw: 0.5, hh: 0.5 },
    });
  }
  return world;
}

function applyCommands(world, step, size) {
  const n = Math.min(8, size);
  for (let k = 0; k < n; k += 1) {
    const idx = (step * 7 + k * 13) % size;
    const body = findBody(world, 'b' + idx);
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
 * Step the world; append THIS STEP's ordered contact records ('begin:a|b',
 * canonical body-ID pair order) to the provided array.
 */
function stepWithContacts(world, events) {
  const record = (contact, kind) => {
    const ia = (contact.getFixtureA().getBody().getUserData() || {}).id ?? '?';
    const ib = (contact.getFixtureB().getBody().getUserData() || {}).id ?? '?';
    const pair = ia <= ib ? ia + '|' + ib : ib + '|' + ia;
    events.push(kind + ':' + pair);
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
// Strategy-2 trial with a discriminated result
// ---------------------------------------------------------------------------

/**
 * Returns a DISCRIMINATED result:
 *   { harnessValid: false, invalidReason }              — harness fault
 *   { harnessValid: true, restoreExact, continuationEquivalent, ... }
 *
 * Non-finite values, missing/duplicate bodies, or malformed records mark the
 * trial INVALID (the main program must exit nonzero) — they are never treated
 * as the expected strategy rejection.
 */
function runTrial(size, { omit } = {}) {
  const worldA = buildWorld(size);
  const worldB = buildWorld(size);

  // Phase 1: identical committed advance.
  for (let s = 0; s < STEPS_TO_COMMIT; s += 1) {
    applyCommands(worldA, s, size);
    applyCommands(worldB, s, size);
    stepWithContacts(worldA, []);
    stepWithContacts(worldB, []);
  }

  const priorInvalidA = validateProjection(extractProjection(worldA));
  const priorInvalidB = validateProjection(extractProjection(worldB));
  if (priorInvalidA || priorInvalidB) {
    return { harnessValid: false, invalidReason: priorInvalidA ?? priorInvalidB };
  }

  // Phase 2: save prior projection; candidate takes its tick; FAILURE —
  // stepped state discarded; rebuilt from the prior projection.
  const priorProjection = extractProjection(worldA);
  const damagedProjection = omit ? omitField(priorProjection, omit) : priorProjection;
  applyCommands(worldA, STEPS_TO_COMMIT, size);
  stepWithContacts(worldA, []);
  const controlBeforeAdvance = extractProjection(worldB);

  // Validate both sides before comparing (omission damage is intentional but
  // still produces structurally valid data; NaN etc. would not).
  const damagedInvalid = validateProjection(damagedProjection);
  const controlInvalid = validateProjection(controlBeforeAdvance);
  if (damagedInvalid || controlInvalid) {
    return { harnessValid: false, invalidReason: damagedInvalid ?? controlInvalid };
  }

  const restoredWorld = rebuildFrom(damagedProjection);
  const restoredProjection = extractProjection(restoredWorld);
  const restoredInvalid = validateProjection(restoredProjection);
  if (restoredInvalid) {
    return { harnessValid: false, invalidReason: restoredInvalid };
  }

  const restoration = compareStates(restoredProjection, controlBeforeAdvance);
  if (restoration.kind === 'invalid') {
    return { harnessValid: false, invalidReason: 'restoration comparison: ' + restoration.reason };
  }
  const restoreExact = restoration.kind === 'equivalent';
  if (!restoreExact) {
    // Expected ONLY for negative controls (omitted field). The trial result
    // keeps this distinct from continuation equivalence.
    return {
      harnessValid: true,
      restoreExact: false,
      continuationEquivalent: null,
      restorationField: restoration.field,
      restorationDetail: restoration.detail,
    };
  }

  // Requirement (b): AUTHORITATIVE CONTINUATION EQUIVALENCE — per-step
  // independent comparison of full state and ordered contact sequences.
  const perStepDeltas = [];
  let maxDeltaSeen = 0;
  let transformDivergedAtStep = -1;
  let transformDivergence = '';
  let contactDivergedAtStep = -1;
  let contactSampleRestored = '';
  let contactSampleControl = '';
  for (let s = 0; s < TRACE; s += 1) {
    applyCommands(restoredWorld, STEPS_TO_COMMIT + 1 + s, size);
    applyCommands(worldB, STEPS_TO_COMMIT + 1 + s, size);
    const evRestored = [];
    const evControl = [];
    stepWithContacts(restoredWorld, evRestored);
    stepWithContacts(worldB, evControl);

    const pa = extractProjection(restoredWorld);
    const pb = extractProjection(worldB);
    const invA = validateProjection(pa);
    const invB = validateProjection(pb);
    if (invA || invB) {
      return { harnessValid: false, invalidReason: invA ?? invB };
    }
    const cmp = compareStates(pa, pb);
    if (cmp.kind === 'invalid') {
      return { harnessValid: false, invalidReason: 'continuation comparison: ' + cmp.reason };
    }
    const delta = pa.reduce((m, b) => {
      const o = pb.find((z) => z.id === b.id);
      return Math.max(m, Math.abs(b.x - o.x), Math.abs(b.y - o.y), Math.abs(b.vx - o.vx), Math.abs(b.vy - o.vy), Math.abs(b.angle - o.angle), Math.abs(b.angularVelocity - o.angularVelocity));
    }, 0);
    perStepDeltas.push(delta);
    maxDeltaSeen = Math.max(maxDeltaSeen, delta);
    if (transformDivergedAtStep < 0 && cmp.kind === 'divergent') {
      transformDivergedAtStep = s;
      transformDivergence = cmp.id + '.' + cmp.field + ' (' + cmp.detail + ')';
    }
    if (contactDivergedAtStep < 0 && !contactSequenceEquals(evRestored, evControl)) {
      contactDivergedAtStep = s;
      contactSampleRestored = evRestored.slice(0, 6).join(', ');
      contactSampleControl = evControl.slice(0, 6).join(', ');
    }
  }
  const continuationEquivalent = transformDivergedAtStep < 0 && contactDivergedAtStep < 0;

  // Settling diagnostics ONLY — never influence acceptance.
  const settleEventsA = [];
  const settleEventsB = [];
  for (let s = 0; s < 900; s += 1) {
    stepWithContacts(restoredWorld, settleEventsA);
    stepWithContacts(worldB, settleEventsB);
  }
  const finalA = extractProjection(restoredWorld);
  const finalB = extractProjection(worldB);
  let finalMaxDelta = 0;
  let awakeMismatch = false;
  for (const b of finalA) {
    const o = finalB.find((z) => z.id === b.id);
    finalMaxDelta = Math.max(finalMaxDelta, Math.abs(b.x - o.x), Math.abs(b.y - o.y));
    if (b.awake !== o.awake) awakeMismatch = true;
  }

  return {
    harnessValid: true,
    restoreExact: true,
    continuationEquivalent,
    maxDeltaSeen,
    transformDivergedAtStep,
    transformDivergence,
    contactDivergedAtStep,
    contactSampleRestored,
    contactSampleControl,
    perStepDeltas,
    settling: {
      finalMaxDelta,
      awakeMismatch,
      beginA: settleEventsA.length,
      beginB: settleEventsB.length,
    },
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
    label.padEnd(16) + ' bodies=' + String(size).padStart(3) +
    '  step p50=' + percentile(samples, 50).toFixed(3) + 'ms  p95=' + percentile(samples, 95).toFixed(3) +
    'ms  p99=' + percentile(samples, 99).toFixed(3) + 'ms  | awake(min)=' + minAwake +
    '  contact-begins=' + (begins - beginAtStart),
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
// Harness self-checks — each proves a specific detection capability
// ---------------------------------------------------------------------------

function runSelfChecks() {
  const results = [];
  const base = [
    { id: 'ground', _order: 0, type: 'static', x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVelocity: 0, awake: false, fixedRotation: false, gravityScale: 1, shapes: [{ id: 'g-s', density: 0, friction: 0.6, restitution: 0, sensor: false }] },
    { id: 'p', _order: 1, type: 'dynamic', x: 1, y: 2, angle: 0, vx: 0, vy: 0, angularVelocity: 0, awake: true, fixedRotation: false, gravityScale: 1, shapes: [{ id: 'p-s', density: 1, friction: 0.4, restitution: 0.05, sensor: false }] },
  ];
  const clone = () => base.map((b) => ({ ...b, shapes: b.shapes.map((s) => ({ ...s })) }));

  function expectInvalid(name, a, b, needle) {
    const cmp = compareStates(a, b);
    const ok = cmp.kind === 'invalid' && (!needle || cmp.reason.includes(needle));
    results.push({ name, ok, detail: cmp.reason });
  }
  function expectDivergent(name, a, b, field) {
    const cmp = compareStates(a, b);
    const ok = cmp.kind === 'divergent' && cmp.field === field;
    results.push({ name, ok, detail: cmp.field + ': ' + (cmp.detail ?? '') });
  }
  function expectEquivalent(name, a, b) {
    const cmp = compareStates(a, b);
    results.push({ name, ok: cmp.kind === 'equivalent', detail: cmp.reason ?? '' });
  }

  // 1. NaN in a numeric field -> harness-invalid.
  {
    const a = clone();
    const b = clone();
    b[1].x = Number.NaN;
    expectInvalid('self-check NaN x -> invalid', a, b, 'non-finite');
  }
  // 2. Missing body -> harness-invalid.
  {
    const a = clone();
    const b = clone().filter((x) => x.id !== 'p');
    expectInvalid('self-check missing body -> invalid', a, b, 'count mismatch');
  }
  // 3. Angle-only divergence beyond tolerance -> divergent(angle).
  {
    const a = clone();
    const b = clone();
    b[1].angle = 0.5;
    expectDivergent('self-check angle-only -> divergent', a, b, 'angle');
  }
  // 3b. Angle noise WITHIN tolerance -> equivalent.
  {
    const a = clone();
    const b = clone();
    b[1].angle = 5e-7;
    expectEquivalent('self-check angle noise within tolerance', a, b);
  }
  // 4. Awake-only divergence -> divergent(awake), exact boolean match required.
  {
    const a = clone();
    const b = clone();
    b[1].awake = !b[1].awake;
    expectDivergent('self-check awake-only -> divergent', a, b, 'awake');
  }
  // 5. Angular velocity divergence -> divergent(angularVelocity).
  {
    const a = clone();
    const b = clone();
    b[1].angularVelocity = 3.25;
    expectDivergent('self-check angular velocity-only -> divergent', a, b, 'angularVelocity');
  }
  // 6. Contact mismatch after an otherwise equal earlier step.
  {
    const seqA = [[], ['begin:x|y']];
    const seqB = [[], []];
    let firstDiff = -1;
    for (let s = 0; s < seqA.length; s += 1) {
      if (!contactSequenceEquals(seqA[s], seqB[s])) {
        firstDiff = s;
        break;
      }
    }
    const ok = firstDiff === 1;
    results.push({ name: 'self-check contact mismatch after equal earlier step', ok, detail: 'first diff at step ' + firstDiff });
  }
  // 7. Duplicate ID -> harness-invalid (compare the duplicated list with
  // itself so only the duplicate check can fire).
  {
    const duped = clone().concat([clone()[1]]);
    expectInvalid('self-check duplicate id -> invalid', duped, JSON.parse(JSON.stringify(duped)), 'duplicate');
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('planck.js 1.5.0 | node ' + process.version + ' | strategy-2 transaction trial (Node-only)\n');

console.log('--- harness self-checks ---');
let selfChecksOk = true;
for (const r of runSelfChecks()) {
  console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  [' + r.detail + ']'));
  if (!r.ok) selfChecksOk = false;
}
if (!selfChecksOk) {
  console.log('\nHarness self-checks failed — results below are untrustworthy.');
  process.exitCode = 1;
  process.exit(process.exitCode);
}

console.log('\n--- strategy-2 trial @128 bodies ---');
const trial = runTrial(128);
if (!trial.harnessValid) {
  console.log('FAIL: harness-invalid trial — ' + trial.invalidReason);
  process.exitCode = 1;
} else {
  console.log('exact restoration of public fields: ' + (trial.restoreExact ? 'PASS' : 'FAIL'));
  console.log(
    'authoritative continuation equivalence: ' +
    (trial.continuationEquivalent ? 'PASS' : 'FAIL') +
    (trial.transformDivergedAtStep >= 0
      ? ' — transform divergence at step ' + trial.transformDivergedAtStep + ': ' + trial.transformDivergence + ', max delta ' + trial.maxDeltaSeen.toFixed(4) + ' > budget ' + MAX_TRACE_DELTA
      : ''),
  );
  if (trial.contactDivergedAtStep >= 0) {
    console.log('  ordered contact records diverged at step ' + trial.contactDivergedAtStep);
    console.log('  restored sample: [' + trial.contactSampleRestored + ']');
    console.log('  control  sample: [' + trial.contactSampleControl + ']');
  }
  console.log(
    '  settling diagnostics (not gated): converged max=' +
    trial.settling.finalMaxDelta.toExponential(2) + ', sleep-mismatch=' + trial.settling.awakeMismatch +
    ', settling contact records ' + trial.settling.beginA + ' / ' + trial.settling.beginB,
  );

  console.log('\n--- negative controls (harness discrimination via omitted fields) ---');
  for (const field of ['angularVelocity', 'fixture:restitution']) {
    const neg = runTrial(128, { omit: field });
    if (!neg.harnessValid) {
      console.log('omit "' + field + '": HARNESS-INVALID — ' + neg.invalidReason);
      process.exitCode = 1;
    } else {
      const correctlyFails = !neg.restoreExact;
      console.log('omit "' + field + '": ' + (correctlyFails ? 'correctly FAILS restoration' : 'DID NOT FAIL (unexpected)'));
      if (!correctlyFails) process.exitCode = 1;
    }
  }

  console.log('\n--- VERDICT ---');
  if (!trial.continuationEquivalent) {
    console.log('Strategy 2 is REJECTED for v1: reconstruction of public fields is exact,');
    console.log('but private solver/warm-start state is unavailable, so authoritative');
    console.log('continuation equivalence FAILS (transform/angular/velocity divergence and');
    console.log('reshuffled ordered contact records under identical commands).');
    console.log('See plans/task-18-evaluation.md section 2.');
  } else {
    console.log('Strategy 2 PASSED continuation equivalence under the frozen budget.');
    console.log('This contradicts the recorded rejection — update plans/task-18-evaluation.md.');
    process.exitCode = 1;
  }
}

console.log('\n--- step cost, active phase enforced (diagnostics; Node-only) ---');
measureStepCost(32, 'contact-heavy');
measureStepCost(128, 'contact-heavy');
measureStepCost(512, 'contact-heavy');

console.log('\n--- rebuild-from-projection distribution (' + REBUILD_SAMPLES + ' samples, ' + REBUILD_WARMUP + ' warmup) ---');
for (const size of [32, 128, 512]) {
  const r = measureRebuild(size);
  console.log(
    'rebuild          bodies=' + String(size).padStart(3) +
    '  p50=' + r.p50.toFixed(3) + 'ms  p95=' + r.p95.toFixed(3) + 'ms  p99=' + r.p99.toFixed(3) + 'ms',
  );
}
