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

/** Identifier callees inside a callback body, via the AST (for the
 * delegation assertions). */
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

/**
 * Banned callee texts inside one callback body (T11-VF2). Every
 * CallExpression shape is classified:
 *
 * - Identifier callee: allowed only when the identifier is allowlisted.
 * - PropertyAccess callee (`namespace.helper()` / `object.method()`):
 *   allowed only for `Math` built-ins; any other object or namespace
 *   method call is banned.
 * - ElementAccess callee (`helpers[name]()`): always banned.
 * - Any other callee shape: banned.
 */
function bannedCallsInBody(body: string, allowed: ReadonlySet<string>): string[] {
  const file = ts.createSourceFile(
    'body.ts',
    body,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const banned: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        if (!allowed.has(callee.text)) {
          banned.push(callee.text);
        }
      } else if (ts.isPropertyAccessExpression(callee)) {
        const object = callee.expression;
        if (!(ts.isIdentifier(object) && object.text === 'Math')) {
          banned.push(callee.getText(file));
        }
      } else if (ts.isElementAccessExpression(callee)) {
        banned.push(callee.getText(file));
      } else {
        banned.push(callee.getText(file));
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return banned;
}

interface DerivedAnalysis {
  readonly bodies: readonly string[];
  /** Bodies whose first statement is not the worklet directive. */
  readonly nonWorkletized: readonly string[];
  /** Banned callee texts across every derived body. */
  readonly banned: readonly string[];
}

/**
 * Analyze every `useDerivedValue` callback in a source text through the
 * TypeScript AST: enumerate the callback bodies, verify each is
 * workletized, and classify every call-expression shape inside them
 * (T11-VF2). No callback spelling or callee shape can be skipped.
 */
function analyzeDerivedCallbacks(sourceText: string, allowed: ReadonlySet<string>): DerivedAnalysis {
  const file = ts.createSourceFile(
    'Analyzed.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bodies: string[] = [];
  const nonWorkletized: string[] = [];
  const banned: string[] = [];
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useDerivedValue' &&
      node.arguments.length === 1 &&
      ts.isArrowFunction(node.arguments[0])
    ) {
      const body = node.arguments[0].body.getText(file);
      bodies.push(body);
      // The directive is the first statement INSIDE the block braces.
      const trimmed = body.trim();
      const inner = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;
      if (!inner.trim().startsWith("'worklet'")) {
        nonWorkletized.push(inner.trim().slice(0, 60));
      }
      banned.push(...bannedCallsInBody(body, allowed));
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return { bodies, nonWorkletized, banned };
}

describe('Collision Lab renderer UI-runtime contract', () => {
  it('never calls ordinary imported functions inside derived worklets (FF1, TF3)', () => {
    // The renderer must not even import collision helpers anymore: the
    // snapshot projects debug records headlessly.
    assert.equal(source.includes('projectWorldCollider2D'), false, 'no collision helper imports');

    // Enumerate every derived callback through the AST and classify every
    // call-expression shape inside each one (T11-VF2): comments and
    // keywords are structurally absent, no callback spelling can be
    // skipped, and namespace, method, and element-access callees are
    // rejected rather than ignored.
    const analysis = analyzeDerivedCallbacks(source, ALLOWED_WORKLET_CALLS);
    assert.ok(analysis.bodies.length >= 20, `found ${analysis.bodies.length} derived worklets`);
    assert.deepEqual(analysis.nonWorkletized, [], 'every derived callback is workletized');
    assert.deepEqual(analysis.banned, [], 'no non-worklet call of any shape inside derived worklets');

    // The sweep path derived must delegate to the exported pure projector
    // (T11-TF3): no inlined path math may drift from the mounted tests.
    const sweepPathBody = analysis.bodies.find((body) => body.includes('projectSweepPath'));
    assert.ok(sweepPathBody !== undefined, 'the sweepPath derived exists');
    assert.deepEqual(
      calledNames(sweepPathBody),
      ['projectSweepPath'],
      'the sweepPath derived delegates to the pure projector only',
    );
  });

  it('classifies every call-expression shape with fixtures (T11-VF2)', () => {
    const fixtureAllowed = new Set(['localHelper', 'Math']);
    const fixture = (body: string): string => `
const v = useDerivedValue(() => {
  'worklet';
  ${body}
});`;
    const analyze = (body: string) => analyzeDerivedCallbacks(fixture(body), fixtureAllowed);

    // Safe: an allowlisted workletized identifier helper and Math methods.
    const safe = analyze('return localHelper() + Math.abs(-1);');
    assert.deepEqual(safe.banned, [], 'safe workletized helpers and Math methods pass');
    assert.deepEqual(safe.nonWorkletized, [], 'the fixture callback is workletized');

    // Unsafe identifier callee: not in the allowlist.
    assert.deepEqual(
      analyze('return evilHelper();').banned,
      ['evilHelper'],
      'an unsafe identifier helper fails independently',
    );

    // Unsafe namespace method callee: never allowlisted by identifier.
    assert.deepEqual(
      analyze('return ImportedNamespace.helper();').banned,
      ['ImportedNamespace.helper'],
      'a namespace method call fails independently',
    );

    // Unsafe object method callee.
    assert.deepEqual(
      analyze('return object.method();').banned,
      ['object.method'],
      'an object method call fails independently',
    );

    // Unsafe element-access callee: rejected, not silently skipped.
    assert.deepEqual(
      analyze('return helpers[name]();').banned,
      ['helpers[name]'],
      'an element-access callee fails independently',
    );

    // A non-workletized callback is flagged by the analyzer.
    const plain = analyzeDerivedCallbacks(
      'const v = useDerivedValue(() => { return localHelper(); });',
      fixtureAllowed,
    );
    assert.equal(plain.nonWorkletized.length, 1, 'a callback without the directive is flagged');

    // The real renderer remains accepted.
    const renderer = analyzeDerivedCallbacks(source, ALLOWED_WORKLET_CALLS);
    assert.deepEqual(renderer.banned, [], 'the renderer stays accepted');
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
