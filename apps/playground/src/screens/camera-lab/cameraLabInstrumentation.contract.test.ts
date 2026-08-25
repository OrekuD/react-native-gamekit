/**
 * T12-SF2: the Camera Lab instrumentation classifies callbacks by their
 * ACTUAL invocation runtime.
 *
 * UI-runtime callbacks (`onRawTouch`, `onForwarded`) must carry the
 * `'worklet'` directive and mutate shared values only. RN-runtime callbacks
 * (`onDispatchResult`, `onDispatchRejected`, `onPresentCommit`,
 * `onUiRevisionObserved`) are delivered on JS — GameView schedules the
 * observed-revision callback onto RN — so they must NOT carry a worklet
 * directive and must NOT mutate shared values. `readCounters()` must never
 * read a UI-owned `.value`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/screens/camera-lab/cameraLabInstrumentation.ts', 'utf8');

/** Callback -> invocation runtime. */
const CALLBACKS: readonly [string, 'ui' | 'rn'][] = [
  ['onRawTouch', 'ui'],
  ['onForwarded', 'ui'],
  ['onDispatchResult', 'rn'],
  ['onDispatchRejected', 'rn'],
  ['onPresentCommit', 'rn'],
  ['onUiRevisionObserved', 'rn'],
];

function bodyOf(text: string, marker: string): string {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `callback found: ${marker}`);
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

function hasWorkletDirective(body: string): boolean {
  return body.trim().startsWith("'worklet';");
}

function mutatesSharedValue(body: string): boolean {
  return /\.value\s*(\+=|-=|\+\+|--|=\s)/.test(body);
}

function analyze(text: string): { misclassified: string[] } {
  const misclassified: string[] = [];
  for (const [callback, runtime] of CALLBACKS) {
    const body = bodyOf(text, `${callback}:`);
    const isWorklet = hasWorkletDirective(body);
    const mutatesShared = mutatesSharedValue(body);
    if (runtime === 'ui') {
      if (!isWorklet) {
        misclassified.push(`${callback}: missing worklet directive`);
      }
      if (!mutatesShared) {
        misclassified.push(`${callback}: no shared-value mutation`);
      }
    } else {
      if (isWorklet) {
        misclassified.push(`${callback}: RN callback carries a worklet directive`);
      }
      if (mutatesShared) {
        misclassified.push(`${callback}: RN callback mutates a shared value`);
      }
    }
  }
  return { misclassified };
}

describe('Camera Lab instrumentation runtime classification (T12-SF2)', () => {
  it('classifies every callback by its actual invocation runtime', () => {
    const result = analyze(source);
    assert.deepEqual(result.misclassified, [], 'every callback matches its runtime');
  });

  it('keeps readCounters free of shared-value reads', () => {
    const body = bodyOf(source, 'readCounters = useCallback(');
    assert.ok(!body.includes('.value'), 'readCounters reads refs/snapshots only, never a UI-owned .value');
  });

  it('fails when an RN callback is workletized or a UI callback loses its directive', () => {
    const rnWorkletized = source.replace(
      "      onUiRevisionObserved: () => {\n        uiObservedRef.current += 1;\n      },",
      "      onUiRevisionObserved: () => {\n        'worklet';\n        uiObservedRef.current += 1;\n      },",
    );
    assert.notEqual(rnWorkletized, source, 'the directive was inserted');
    assert.ok(analyze(rnWorkletized).misclassified.some((m) => m.includes('onUiRevisionObserved')),
      'an RN callback with a directive is reported');

    const uiStripped = source.replace("      onRawTouch: () => {\n        'worklet';", "      onRawTouch: () => {");
    assert.notEqual(uiStripped, source, 'the directive was stripped');
    assert.ok(analyze(uiStripped).misclassified.some((m) => m.includes('onRawTouch')),
      'a UI callback without its directive is reported');
  });
});
