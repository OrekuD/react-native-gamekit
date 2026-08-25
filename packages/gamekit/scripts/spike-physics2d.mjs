/**
 * T18.0 headless spike — planck.js 1.5.0 transaction-strategy prototype.
 *
 * Measures, in Node (NOT a physical device — see plans/task-18.md):
 * - world creation + body population for 32/128/512 representative bodies;
 * - fixed-step p50/p95/p99 step cost per world size (stacked dynamic boxes on
 *   one static ground = contact-heavy; plus a mostly-sleeping variant);
 * - transaction strategy 2 restore cost: full destroy + rebuild from an
 *   immutable prior body projection (the failure-path cost the adapter would
 *   pay once per failed tick).
 *
 * This is evaluation evidence for the T18.0 go/no-go record. It is not device
 * evidence and must not be cited as such.
 */
import Planck from 'planck';

const FIXED_DT = 1 / 60;
const SAMPLES = 600;

function buildWorld(bodyCount) {
  const world = new Planck.World({ gravity: new Planck.Vec2(0, -9.8) });
  const projection = [];
  // One static ground.
  const ground = world.createBody({ type: 'static', position: new Planck.Vec2(0, 0) });
  ground.createFixture(new Planck.Box(500, 0.5), { friction: 0.6 });
  projection.push({
    id: 'ground', type: 'static', x: 0, y: 0,
    shapes: [{ kind: 'box', hw: 500, hh: 0.5, density: 0, friction: 0.6 }],
  });
  // Dynamic boxes stacked in columns.
  const side = Math.ceil(Math.sqrt(bodyCount));
  for (let i = 0; i < bodyCount; i += 1) {
    const col = i % side;
    const row = Math.floor(i / side);
    const id = `b${i}`;
    const body = world.createBody({
      type: 'dynamic',
      position: new Planck.Vec2(col * 1.05 - (side * 1.05) / 2, 1 + row * 1.05),
      fixedRotation: false,
    });
    body.createFixture(new Planck.Box(0.5, 0.5), { density: 1, friction: 0.4, restitution: 0.05 });
    projection.push({ id, type: 'dynamic', x: col * 1.05 - (side * 1.05) / 2, y: 1 + row * 1.05, shapes: [{ kind: 'box', hw: 0.5, hh: 0.5, density: 1, friction: 0.4 }] });
  }
  return { world, projection };
}

function rebuildFrom(projection) {
  const world = new Planck.World({ gravity: new Planck.Vec2(0, -9.8) });
  for (const b of projection) {
    const body = world.createBody({ type: b.type === 'static' ? 'static' : 'dynamic', position: new Planck.Vec2(b.x, b.y) });
    for (const s of b.shapes) {
      if (s.kind === 'box') {
        body.createFixture(new Planck.Box(s.hw, s.hh), { density: s.density, friction: s.friction });
      }
    }
  }
  return world;
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function run(size, label) {
  const { world, projection } = buildWorld(size);

  // JIT warmup only (10 steps) so the ACTIVE phase below measures genuinely
  // colliding/unsettled stacks rather than a sleeping world.
  for (let i = 0; i < 10; i += 1) world.step(FIXED_DT);

  const samples = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t0 = performance.now();
    world.step(FIXED_DT);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);

  // Transaction strategy 2 restore cost: destroy everything, rebuild from
  // immutable projection (failure path). Measured after steady state.
  const restoreStart = performance.now();
  rebuildFrom(projection);
  const restoreMs = performance.now() - restoreStart;

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const budget60fpsMs = 16.67;
  console.log(
    `${label.padEnd(28)} bodies=${String(size).padStart(3)}  step p50=${p50.toFixed(3)}ms  p95=${p95.toFixed(3)}ms  p99=${p99.toFixed(3)}ms  | 60Hz budget=${budget60fpsMs}ms  headroom@p95=${((budget60fpsMs / Math.max(p95, 1e-9))).toFixed(1)}x  | restore(rebuild)=${restoreMs.toFixed(1)}ms`,
  );
}

console.log('planck.js', '1.5.0', '| node', process.version, '| contact-heavy stacked-box worlds');
run(32, 'contact-heavy');
run(128, 'contact-heavy');
run(512, 'contact-heavy');

// Mostly-sleeping variant: let stacks settle far past sleep thresholds.
function runSleeping(size) {
  const { world } = buildWorld(size);
  for (let i = 0; i < 900; i += 1) world.step(FIXED_DT);
  const samples = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t0 = performance.now();
    world.step(FIXED_DT);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `${'mostly-sleeping'.padEnd(28)} bodies=${String(size).padStart(3)}  step p50=${percentile(samples, 50).toFixed(3)}ms  p95=${percentile(samples, 95).toFixed(3)}ms  p99=${percentile(samples, 99).toFixed(3)}ms`,
  );
}
console.log('');
runSleeping(128);
