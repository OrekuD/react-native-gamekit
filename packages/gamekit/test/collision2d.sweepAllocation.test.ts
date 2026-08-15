/**
 * T11-SF3: the circle sweep's miss path allocates nothing.
 *
 * Structural evidence: the sweep body contains no locally created arrow
 * function and no array literal. Behavioral evidence: 100k miss sweeps
 * leave the heap within GC noise.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { sweepCircleAabb2D } from '../src/collision2d/sweeps.ts';

/** Extract a named top-level function body via brace counting. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `function ${name} found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  throw new Error(`unterminated body for ${name}`);
}

describe('circle sweep miss-path allocation (T11-SF3)', () => {
  it('contains no locally created function or array in its body', () => {
    const source = readFileSync('src/collision2d/sweeps.ts', 'utf8');
    const body = functionBody(source, 'sweepCircleAabb2D');
    // Strip comments so prose cannot masquerade as code.
    const code = body
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!code.includes('=>'), 'no local arrow functions');
    assert.ok(!code.includes('[') && !code.includes(']'), 'no array literals');
  });

  it('keeps the miss path within GC noise across 100k calls', () => {
    // The circle at x=60 never reaches the target's right edge (36 + 4),
    // so every call is a true miss.
    const miss = (index: number): undefined =>
      sweepCircleAabb2D({
        circle: { x: 60, y: 40 + (index % 4), radius: 4 },
        displacement: { x: 0, y: 40 },
        target: { x: 0, y: 80, width: 36, height: 10 },
      });
    // Warm the JIT before measuring so the delta reflects the miss path,
    // not first-run compilation.
    for (let index = 0; index < 50_000; index += 1) {
      assert.equal(miss(index), undefined);
    }
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let index = 0; index < 100_000; index += 1) {
      assert.equal(miss(index), undefined);
    }
    const elapsed = performance.now() - start;
    const after = process.memoryUsage().heapUsed;
    const delta = (after - before) / 1024;
    console.log(`sweep misses: 100k calls in ${elapsed.toFixed(1)}ms, heap delta ${delta.toFixed(1)} KiB`);
    assert.ok(delta < 512, `miss path allocates nothing (heap delta ${delta.toFixed(1)} KiB)`);
  });
});
