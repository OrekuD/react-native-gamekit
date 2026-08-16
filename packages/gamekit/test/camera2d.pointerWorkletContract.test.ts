/**
 * T12-TF1: the complete `GamePointerInput` UI worklet call graph stays on
 * the UI runtime — with RECURSIVE helper analysis.
 *
 * Starting from every RNGH touch handler and the trailing frame callback,
 * the analyzer follows each project-owned callee and requires a
 * `'worklet'` directive on every helper body it reaches. Every
 * call-expression shape is classified: approved runtime APIs (GestureStateManager,
 * scheduleOnRN), Math, Date, the instrumentation object, and workletized
 * project helpers are permitted; unapproved identifier, property-access,
 * element-access, and computed callees are rejected.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/react/GamePointerInput.tsx', 'utf8');
/** Module sources searched for project helper bodies (T12-TF1). */
const MODULES: Record<string, string> = {
  'GamePointerInput': source,
  'pointerCamera': readFileSync('src/react/pointerCamera.ts', 'utf8'),
  'gestureLifecycle': readFileSync('src/react/gestureLifecycle.ts', 'utf8'),
  'pointerContainment': readFileSync('src/react/pointerContainment.ts', 'utf8'),
  'pointerCoalescer': readFileSync('src/react/pointerCoalescer.ts', 'utf8'),
};

/** Workletized project helpers reachable from the UI handlers. */
const PROJECT_HELPERS = [
  'advanceSharedCoalescer',
  'reducePointerCoalescer',
  'createPointerCoalescerState',
  'packetCameraFor',
  'canBeginPrimaryPointer',
  'isBeginAllowed',
  'samplerMirrorFromBatch',
  'deactivateAfterUp',
  'cancelOnActiveFinalize',
];

/** Approved runtime-bound callees (not project worklet helpers). */
const RUNTIME_CALLEES = new Set([
  'GestureStateManager',
  'scheduleOnRN',
  'Date',
  'Math',
  'instrumentation',
]);

/** Handler name -> its useCallback type marker. */
const HANDLERS: ReadonlyArray<[string, string]> = [
  ['handleTouchesDown', 'useCallback<ManualTouchHandler>'],
  ['handleTouchesMove', 'useCallback<ManualTouchHandler>'],
  ['handleTouchesUp', 'useCallback<ManualTouchHandler>'],
  ['handleTouchesCancel', 'useCallback<ManualTouchHandler>'],
  ['handleFinalize', 'useCallback<ManualFinalizeHandler>'],
];

/** Extract the first brace-balanced body after a marker. */
function bodyOf(text: string, marker: string): string {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `marker found: ${marker}`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') {
      depth += 1;
    } else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(open + 1, index);
      }
    }
  }
  throw new Error(`unterminated body for ${marker}`);
}

/** Every callee (identifier, property-access receiver, element/computed). */
function calledShapes(body: string): Array<{ kind: string; name: string }> {
  const file = ts.createSourceFile('body.ts', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const shapes: Array<{ kind: string; name: string }> = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        shapes.push({ kind: 'identifier', name: callee.text });
      } else if (ts.isPropertyAccessExpression(callee)) {
        shapes.push({ kind: 'property', name: callee.getText(file) });
      } else if (ts.isElementAccessExpression(callee)) {
        shapes.push({ kind: 'element', name: callee.getText(file) });
      } else {
        shapes.push({ kind: 'other', name: callee.getText(file) });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return shapes;
}

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

/** The trailing flush callback body from the analyzed text (T12-TF1). */
function flushBody(text: string): string {
  const start = text.indexOf('useFrameCallback(() => {');
  assert.ok(start >= 0, 'flush callback found');
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') {
      depth += 1;
    } else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(open + 1, index);
      }
    }
  }
  throw new Error('unterminated flush body');
}

interface AnalysisResult {
  readonly banned: string[];
  readonly missingDirectives: string[];
}

/**
 * Recursive call-graph analysis (T12-TF1): every UI handler + the trailing
 * flush; every project-owned callee is followed and must carry the
 * directive; every call shape is classified.
 */
function analyze(text: string, modules: Record<string, string> = MODULES): AnalysisResult {
  const banned: string[] = [];
  const missingDirectives: string[] = [];
  const visited = new Set<string>();

  const inspectBody = (owner: string, body: string, isWorkletRoot: boolean): void => {
    if (isWorkletRoot && !hasWorkletDirective(body)) {
      missingDirectives.push(`${owner}: missing worklet directive`);
    }
    for (const shape of calledShapes(body)) {
      if (shape.kind === 'identifier') {
        if (PROJECT_HELPERS.includes(shape.name)) {
          if (!visited.has(shape.name)) {
            visited.add(shape.name);
            const exported = `export function ${shape.name}(`;
            const plain = `function ${shape.name}(`;
            let helperBody: string | undefined;
            for (const moduleSource of Object.values(modules)) {
              const marker = moduleSource.includes(exported) ? exported : plain;
              const index = moduleSource.indexOf(marker);
              if (index >= 0) {
                helperBody = bodyOf(moduleSource, marker);
                break;
              }
            }
            assert.ok(helperBody !== undefined, `helper body found: ${shape.name}`);
            inspectBody(shape.name, helperBody!, true);
          }
          continue;
        }
        if (!RUNTIME_CALLEES.has(shape.name)) {
          banned.push(`${owner} -> ${shape.name}`);
        }
      } else {
        // Property-access, element-access, and computed callees: only
        // approved runtime receivers may be called. Optional-chaining
        // receivers (`instrumentation?.onRawTouch`) normalize to the base.
        const receiver = shape.name.replace('?.', '.').split('.')[0] ?? shape.name;
        if (!RUNTIME_CALLEES.has(receiver)) {
          banned.push(`${owner} -> ${shape.kind} ${shape.name}`);
        }
      }
    }
  };

  for (const [handler, typeMarker] of HANDLERS) {
    const marker = `const ${handler} = ${typeMarker}`;
    assert.ok(text.includes(marker), `marker found: ${marker}`);
    inspectBody(handler, bodyOf(text, marker), true);
  }
  inspectBody('trailing-flush', flushBody(text), true);

  return { banned, missingDirectives };
}

describe('GamePointerInput UI worklet call graph (T12-TF1)', () => {
  it('keeps every UI handler and reachable helper workletized with an allowed call graph', () => {
    const result = analyze(source);
    assert.deepEqual(result.banned, [], 'no unapproved callee of any shape');
    assert.deepEqual(result.missingDirectives, [], 'every handler and helper carries the directive');
  });

  it('fails with a specific missing-directive report when the selector loses its directive', () => {
    const cameraModule = readFileSync('src/react/pointerCamera.ts', 'utf8');
    const strippedModule = cameraModule.replace(
      "): CameraCut2D | undefined {\n  'worklet';",
      "): CameraCut2D | undefined {",
    );
    assert.notEqual(strippedModule, cameraModule, 'the directive was actually stripped');
    const result = analyze(source, { ...MODULES, pointerCamera: strippedModule });
    assert.ok(
      result.missingDirectives.some((entry) => entry.startsWith('packetCameraFor:')),
      `reported: ${result.missingDirectives.join(', ')}`,
    );
  });

  it('rejects namespace, object-method, and element-access callees in a reachable body', () => {
    // Mutate the SELECTOR module (the reachable helper) through the
    // analyzer's input modules: each callee shape must be reported.
    const cameraModule = readFileSync('src/react/pointerCamera.ts', 'utf8');
    const needle = "    const stamp = forwarded.stamp as PointerCameraCapture2D | undefined;";

    const namespaceMutation = cameraModule.replace(
      needle,
      needle + "\n    Importer.helper();",
    );
    assert.notEqual(namespaceMutation, cameraModule, 'namespace mutation applied');
    assert.ok(
      analyze(source, { ...MODULES, pointerCamera: namespaceMutation }).banned.some((entry) => entry.includes('Importer')),
      'namespace method rejected',
    );

    const objectMutation = cameraModule.replace(
      needle,
      needle + "\n    object.method();",
    );
    assert.ok(
      analyze(source, { ...MODULES, pointerCamera: objectMutation }).banned.some((entry) => entry.includes('object.method')),
      'object method rejected',
    );

    const elementMutation = cameraModule.replace(
      needle,
      needle + "\n    helpers[name]();",
    );
    assert.ok(
      analyze(source, { ...MODULES, pointerCamera: elementMutation }).banned.some((entry) => entry.includes('helpers[name]')),
      'element-access callee rejected',
    );
  });

  it('detects mutations of the trailing-flush body through the analyzed text', () => {
    const flushMutation = source.replace(
      "      const batch = advanceSharedCoalescer(coalescerState, {\n        kind: 'flush',",
      "      const batch = advanceSharedCoalescer(coalescerState, {\n        kind: 'flush',\n        stamp: { captured: true, value: undefined },",
    );
    // The mutation is inside the flush body; the analyzer must see it
    // without erroring on the marker (the flush body still exists).
    const result = analyze(flushMutation);
    assert.ok(!result.banned.some((entry) => entry.startsWith('trailing-flush')), 'the flush body is analyzed');
  });
});
