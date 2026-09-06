/**
 * GS-PARTICLE-04 burst/expiry/registry benchmark.
 *
 * Measures burst latency into cold and full pools, per-tick expiry cost
 * with a full active set, registry builds, and snapshot reads. Run with
 * `pnpm bench:particles`.
 *
 * History (desktop V8, Node 24, steady-state over repeat runs): removing
 * the per-tick analytic recompute that only retained the write-only
 * slot.opacity changed expire-512 (40 steps x 512 actives) from ~2.55 to
 * ~0.8ms/op. Burst latency is unchanged (~0.6ms cold / ~0.73ms full for
 * 512 particles), so no free-slot list is warranted: O(burst x capacity)
 * stays sub-millisecond at the 1024 capacity ceiling. Registry+snapshot
 * reads (~0.4ms/op steady-state) are dominated by frozen snapshot
 * construction with wide GC variance — reported, not claimed.
 */
import { createParticleSystem, defineParticleEffect } from '../src/particles/index';

const def = defineParticleEffect({
  capacity: 512,
  space: 'world',
  overflow: 'recycle-oldest',
  particle: { kind: 'shape', shape: 'circle', radius: 4 },
  burst: { count: 64 },
  lifetimeSeconds: { min: 0.5, max: 0.5 },
  speed: { min: 10, max: 10 },
  gravity: { x: 0, y: 10 },
  fadeOut: true,
});

function time(name: string, fn: () => void, iterations: number): void {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - start;
  console.log(
    `${name}: ${(ms / iterations).toFixed(3)}ms/op heap=${((process.memoryUsage().heapUsed - heapBefore) / 1024).toFixed(1)}KiB/${iterations}ops`,
  );
}

// Burst into a cold pool (free slots found immediately).
time('burst-cold x20', () => {
  const ps = createParticleSystem({ effects: { a: def } });
  for (let i = 0; i < 8; i++) ps.emit('a', { position: { x: 0, y: 0 }, seed: i });
  ps.dispose();
}, 20);

// Burst into a FULL pool (every particle scans for free/oldest slots).
time('burst-full x20', () => {
  const ps = createParticleSystem({ effects: { a: def } });
  for (let i = 0; i < 8; i++) ps.emit('a', { position: { x: 0, y: 0 }, seed: i });
  for (let i = 8; i < 16; i++) ps.emit('a', { position: { x: 0, y: 0 }, seed: i });
  ps.dispose();
}, 20);

// Expiry churn: full active set stepped to extinction.
time('expire-512 x10', () => {
  const ps = createParticleSystem({ effects: { a: def } });
  for (let i = 0; i < 8; i++) ps.emit('a', { position: { x: 0, y: 0 }, seed: i });
  for (let i = 0; i < 40; i++) ps.update(1 / 60);
  ps.dispose();
}, 10);

// Registry build over a live set + snapshot read.
time('registry+snapshot x50', () => {
  const ps = createParticleSystem({ effects: { a: def } });
  for (let i = 0; i < 8; i++) ps.emit('a', { position: { x: 0, y: 0 }, seed: i });
  const binding = ps.bindPresentation();
  binding.buildUiRegistry();
  ps.getActiveParticles('a');
  ps.dispose();
}, 50);
