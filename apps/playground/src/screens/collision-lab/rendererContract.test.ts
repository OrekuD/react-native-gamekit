/**
 * Renderer UI-runtime contract (T11-FF1, T11-FF2).
 *
 * A source-level contract that keeps the Collision Lab renderer honest:
 * every identifier called inside a `useDerivedValue` worklet must be
 * inline, workletized, or a Math built-in — no ordinary imported helpers —
 * and the React return path must never read a shared `.value`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./CollisionLabRenderer.tsx', import.meta.url),
  'utf8',
);

/** Identifiers the worklet bodies may call. */
const ALLOWED_WORKLET_CALLS = new Set([
  'toSurfaceX',
  'toSurfaceY',
  'toSurfaceSize',
  'Math',
]);

/** JavaScript keywords that look like calls but are not functions. */
const KEYWORDS = new Set([
  'if',
  'return',
  'typeof',
  'new',
  'while',
  'for',
  'switch',
  'catch',
  'function',
]);

describe('Collision Lab renderer UI-runtime contract', () => {
  it('never calls ordinary imported functions inside derived worklets (FF1)', () => {
    // The renderer must not even import collision helpers anymore: the
    // snapshot projects debug records headlessly.
    assert.equal(source.includes('projectWorldCollider2D'), false, 'no collision helper imports');

    // Extract every useDerivedValue body and inventory the identifiers it
    // calls.
    const workletBodies = [...source.matchAll(/useDerivedValue\(\(\) => \{([\s\S]*?)\n  \}\)/g)].map(
      (match) => match[1],
    );
    assert.ok(workletBodies.length >= 10, `found ${workletBodies.length} derived worklets`);
    for (const body of workletBodies) {
      for (const call of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = call[1];
        if (KEYWORDS.has(name)) {
          continue;
        }
        if (!ALLOWED_WORKLET_CALLS.has(name)) {
          assert.fail(`worklet calls non-worklet function ${name}: ${body.slice(0, 80)}`);
        }
      }
    }
  });

  it('never reads a shared `.value` while building the React tree (FF2)', () => {
    const returnSection = source.slice(source.indexOf('return ('));
    const valueReads = [...returnSection.matchAll(/\.value\b/g)];
    assert.equal(valueReads.length, 0, 'the React return path has no shared-value reads');
  });

  it('keeps the collider overlay topology fixed (FF2)', () => {
    assert.ok(source.includes("key={spec.label}"), 'overlays are keyed by stable label');
    // The fixed authored topology has exactly four entries.
    const topology = source.match(/label: 'body'[\s\S]*?label: 'pickup'/);
    assert.ok(topology !== null, 'the four authored colliders stay in the topology');
  });
});
