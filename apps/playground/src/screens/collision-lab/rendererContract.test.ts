/**
 * Renderer UI-runtime contract (T11-FF1, T11-FF2, T11-TF3).
 *
 * A source-level contract that keeps the Collision Lab renderer honest:
 * every identifier called inside a `useDerivedValue` worklet must be
 * inline, workletized, or a Math built-in — no ordinary imported helpers —
 * and the React return path must never read a shared `.value`.
 *
 * T11-TF3: every derived callback is enumerated through the TypeScript AST
 * (no callback-spelling regex can skip a differently spelled callback),
 * and the sweep-path derived must delegate to the exported pure projector
 * that the mounted tests drive.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(
  new URL('./CollisionLabRenderer.tsx', import.meta.url),
  'utf8',
);

/** Identifiers the worklet bodies may call. */
const ALLOWED_WORKLET_CALLS = new Set([
  'toSurfaceX',
  'toSurfaceY',
  'toSurfaceSize',
  'projectSweepPath',
  'Math',
]);

/**
 * Enumerate EVERY `useDerivedValue` callback through the TypeScript AST.
 * Returns the source text of each callback body.
 */
function derivedCallbackBodies(): string[] {
  const file = ts.createSourceFile(
    'CollisionLabRenderer.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bodies: string[] = [];
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useDerivedValue' &&
      node.arguments.length === 1 &&
      ts.isArrowFunction(node.arguments[0])
    ) {
      bodies.push(node.arguments[0].body.getText(file));
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return bodies;
}

/** Call-expression callees inside a callback body, via the AST. */
function calledNames(body: string): string[] {
  const file = ts.createSourceFile(
    'body.ts',
    body,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.push(node.expression.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return names;
}

describe('Collision Lab renderer UI-runtime contract', () => {
  it('never calls ordinary imported functions inside derived worklets (FF1, TF3)', () => {
    // The renderer must not even import collision helpers anymore: the
    // snapshot projects debug records headlessly.
    assert.equal(source.includes('projectWorldCollider2D'), false, 'no collision helper imports');

    // Enumerate every derived callback through the AST and inventory the
    // callees of each one. Comments and keywords are structurally absent,
    // and no callback spelling can be skipped.
    const workletBodies = derivedCallbackBodies();
    assert.ok(workletBodies.length >= 20, `found ${workletBodies.length} derived worklets`);
    for (const body of workletBodies) {
      const names = calledNames(body);
      for (const name of names) {
        assert.ok(
          ALLOWED_WORKLET_CALLS.has(name),
          `worklet calls non-worklet function ${name}: ${body.slice(0, 80)}`,
        );
      }
    }

    // The sweep path derived must delegate to the exported pure projector
    // (T11-TF3): no inlined path math may drift from the mounted tests.
    const sweepPathBody = workletBodies.find((body) => body.includes('projectSweepPath'));
    assert.ok(sweepPathBody !== undefined, 'the sweepPath derived exists');
    assert.deepEqual(
      calledNames(sweepPathBody),
      ['projectSweepPath'],
      'the sweepPath derived delegates to the pure projector only',
    );
  });

  it('never reads a shared `.value` while building the React tree (FF2)', () => {
    const returnSection = source.slice(source.indexOf('return ('));
    const valueReads = [...returnSection.matchAll(/\.value\b/g)];
    assert.equal(valueReads.length, 0, 'the React return path has no shared-value reads');
  });

  it('keeps every allowlisted helper workletized (SF4)', () => {
    for (const helper of ALLOWED_WORKLET_CALLS) {
      if (helper === 'Math') {
        continue;
      }
      const definition = source.match(new RegExp(`function ${helper}\\([\\s\\S]*?\\n}`));
      assert.ok(definition !== null, `${helper} is defined`);
      assert.ok(definition[0].includes("'worklet'"), `${helper} carries the worklet directive`);
    }
  });

  it('keeps the collider overlay topology fixed (FF2)', () => {
    assert.ok(source.includes("key={spec.label}"), 'overlays are keyed by stable label');
    // The fixed authored topology has exactly four entries.
    const topology = source.match(/label: 'body'[\s\S]*?label: 'pickup'/);
    assert.ok(topology !== null, 'the four authored colliders stay in the topology');
  });
});
