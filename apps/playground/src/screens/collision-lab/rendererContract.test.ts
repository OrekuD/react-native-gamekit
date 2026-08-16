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

/** Approved `Math` methods (T11-FVF1): only these property names may be
 * called on `Math` inside a derived worklet. An arbitrary property such as
 * `Math.notAFunction()` must be rejected rather than approved by receiver
 * text alone. */
const APPROVED_MATH_METHODS = new Set([
  'abs',
  'atan2',
  'cbrt',
  'ceil',
  'cos',
  'exp',
  'floor',
  'hypot',
  'log',
  'max',
  'min',
  'pow',
  'round',
  'sign',
  'sin',
  'sqrt',
  'tan',
  'trunc',
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
        const name = callee.name.text;
        if (!(ts.isIdentifier(object) && object.text === 'Math' && APPROVED_MATH_METHODS.has(name))) {
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
  /** Every `useDerivedValue` call found in the source. */
  readonly discovered: number;
  /** Updater bodies that were analyzed (arrow or function expression). */
  readonly bodies: readonly string[];
  /** Updater bodies whose first statement is not the worklet directive. */
  readonly nonWorkletized: readonly string[];
  /** Banned callee texts across every analyzed body. */
  readonly banned: readonly string[];
  /** `useDerivedValue` calls with an unsupported updater shape. */
  readonly unsupported: readonly string[];
}

/**
 * True when the first statement of a callback block is an actual
 * string-literal expression statement `'worklet'` (T11-FVF1). The check is
 * structural: an expression that merely BEGINS with the same text, such as
 * `'worklet' + suffix;`, is not a directive.
 */
function hasWorkletDirective(body: ts.Node): boolean {
  if (!ts.isBlock(body)) {
    return false;
  }
  const first = body.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'worklet'
  );
}

/**
 * Analyze every `useDerivedValue` call in a source text through the
 * TypeScript AST (T11-VF2, T11-FVF1). Discovery accepts an arrow-function
 * or function-expression updater in argument position zero and tolerates
 * the supported optional dependency argument; any other updater shape is
 * recorded in `unsupported` (fail closed) instead of silently disappearing
 * from the analysis.
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
  const unsupported: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useDerivedValue') {
      if (node.arguments.length === 0) {
        unsupported.push('useDerivedValue() with no updater');
        ts.forEachChild(node, walk);
        return;
      }
      const updater = node.arguments[0];
      if (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater)) {
        const body = updater.body.getText(file);
        bodies.push(body);
        if (!hasWorkletDirective(updater.body)) {
          nonWorkletized.push(body.trim().slice(0, 60));
        }
        banned.push(...bannedCallsInBody(body, allowed));
      } else {
        unsupported.push(updater.getText(file).trim().slice(0, 60));
      }
      // Additional arguments are the supported optional dependency list;
      // they are not updaters and need no analysis.
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return { discovered: bodies.length + unsupported.length, bodies, nonWorkletized, banned, unsupported };
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
    assert.deepEqual(analysis.unsupported, [], 'every derived call has a supported updater');
    assert.equal(
      analysis.discovered,
      analysis.bodies.length,
      'the exact number of discovered derived calls equals the analyzed bodies',
    );
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

    // FVF1: a function-expression updater is discovered and analyzed.
    const functionExpression = analyzeDerivedCallbacks(
      "const v = useDerivedValue(function () { 'worklet'; return localHelper(); });",
      fixtureAllowed,
    );
    assert.equal(functionExpression.discovered, 1, 'the function-expression updater is discovered');
    assert.equal(functionExpression.bodies.length, 1, 'its body is analyzed');
    assert.deepEqual(functionExpression.banned, [], 'its calls are classified');
    assert.deepEqual(functionExpression.nonWorkletized, [], 'its directive is recognized');

    // FVF1: the supported optional dependency argument is tolerated.
    const twoArgument = analyzeDerivedCallbacks(
      "const v = useDerivedValue(() => { 'worklet'; return localHelper(); }, [dep]);",
      fixtureAllowed,
    );
    assert.equal(twoArgument.discovered, 1, 'a two-argument call is discovered');
    assert.equal(twoArgument.bodies.length, 1, 'its updater is analyzed');

    // FVF1: an unsupported updater shape fails CLOSED instead of lowering
    // the body count.
    const unsupportedUpdater = analyzeDerivedCallbacks(
      'const v = useDerivedValue(someUpdater);',
      fixtureAllowed,
    );
    assert.equal(unsupportedUpdater.bodies.length, 0, 'nothing is silently analyzed');
    assert.deepEqual(
      unsupportedUpdater.unsupported,
      ['someUpdater'],
      'the unsupported updater is reported, not omitted',
    );

    // FVF1: approved Math methods pass, arbitrary Math properties fail.
    assert.deepEqual(
      analyze("return Math.abs(-1) + Math.sqrt(4);").banned,
      [],
      'approved Math methods pass',
    );
    assert.deepEqual(
      analyze('return Math.notAFunction();').banned,
      ['Math.notAFunction'],
      'an arbitrary Math property is rejected',
    );

    // FVF1: a false directive — an expression that merely BEGINS with the
    // worklet text — is reported as non-workletized by the structural check.
    const falseDirective = analyzeDerivedCallbacks(
      "const v = useDerivedValue(() => { 'worklet' + suffix; return localHelper(); });",
      fixtureAllowed,
    );
    assert.equal(
      falseDirective.nonWorkletized.length,
      1,
      "an expression beginning with 'worklet' is not a directive",
    );

    // The real renderer remains accepted, with every call discovered.
    const renderer = analyzeDerivedCallbacks(source, ALLOWED_WORKLET_CALLS);
    assert.deepEqual(renderer.unsupported, [], 'the renderer has no unsupported updater');
    assert.equal(renderer.discovered, renderer.bodies.length, 'renderer callbacks are all analyzed');
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
