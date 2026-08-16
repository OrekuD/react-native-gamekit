/**
 * T12-F2: the camera presentation worklet's complete call graph is
 * workletized — no ordinary JavaScript callees, no structured error
 * construction on the UI runtime.
 *
 * Source-level contract: inventories every identifier called from the
 * binding's `present` worklet and from the trusted scalar projector it
 * delegates to. The negative case strips a `'worklet'` directive from the
 * scalar projector and proves the contract fails.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const bindingSource = readFileSync('src/react/camera2d/usePresentedCameraBinding.ts', 'utf8');
const interpolationSource = readFileSync('src/camera2d/interpolation.ts', 'utf8');

/** Extract a named top-level function or method body via brace counting. */
function bodyOf(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker found: ${startMarker}`);
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
  throw new Error(`unterminated body for ${startMarker}`);
}

/** Call-expression callees inside a body, via the AST (comments excluded). */
function calledNames(body: string): string[] {
  const file = ts.createSourceFile('body.ts', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

/** Whether the body's first statement is the worklet directive. */
function hasWorkletDirective(body: string): boolean {
  const file = ts.createSourceFile('body.ts', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const first = file.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'worklet'
  );
}

/** Analyze the presentation call graph; returns banned callees + missing directives. */
function analyze(source: string, scalarSource: string): { banned: string[]; missingDirectives: string[] } {
  const present = bodyOf(source, 'present: (alpha: number) => {');
  const scalar = bodyOf(scalarSource, 'export function interpolateCameraScalar2D(');
  const bodies = { present, scalar };
  const banned: string[] = [];
  const missingDirectives: string[] = [];
  for (const [name, body] of Object.entries(bodies)) {
    if (!hasWorkletDirective(body)) {
      missingDirectives.push(name);
    }
    for (const callee of calledNames(body)) {
      if (callee !== 'Math' && callee !== 'interpolateCameraScalar2D') {
        banned.push(`${name} -> ${callee}`);
      }
    }
  }
  return { banned, missingDirectives };
}

describe('camera presentation worklet contract (T12-F2)', () => {
  it('keeps the complete presentation call graph workletized', () => {
    const result = analyze(bindingSource, interpolationSource);
    assert.deepEqual(result.banned, [], 'no ordinary callees in the presentation path');
    assert.deepEqual(result.missingDirectives, [], 'every presentation body carries the directive');
  });

  it('fails when a required worklet directive is removed', () => {
    // Negative evidence: strip the directive from the scalar projector and
    // the contract must report the missing directive.
    const stripped = interpolationSource.replace(
      `export function interpolateCameraScalar2D(\n  previous: CameraCut2D | undefined,\n  current: CameraCut2D,\n  alpha: number,\n): Camera2D {\n  'worklet';`,
      `export function interpolateCameraScalar2D(\n  previous: CameraCut2D | undefined,\n  current: CameraCut2D,\n  alpha: number,\n): Camera2D {`,
    );
    assert.notEqual(stripped, interpolationSource, 'the directive was actually stripped');
    const result = analyze(bindingSource, stripped);
    assert.ok(result.missingDirectives.includes('scalar'), 'the stripped directive is reported');
  });

  it('never constructs structured errors inside the presentation path', () => {
    const present = bodyOf(bindingSource, 'present: (alpha: number) => {');
    const scalar = bodyOf(interpolationSource, 'export function interpolateCameraScalar2D(');
    assert.ok(!present.includes('GeometryError'), 'no error construction in present');
    assert.ok(!present.includes('assertValid'), 'no validation in present');
    assert.ok(!scalar.includes('GeometryError'), 'no error construction in the scalar projector');
    assert.ok(!scalar.includes('assertValid'), 'no validation in the scalar projector');
  });
});
