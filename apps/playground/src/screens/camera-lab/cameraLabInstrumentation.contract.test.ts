/**
 * T12-RF2: the Camera Lab instrumentation callbacks are worklet-safe.
 *
 * Every callback the lab registers with `GamePointerInput` / `GameView` and
 * that the UI runtime can invoke (raw touches, forwarded events, UI-observed
 * revisions) must carry an explicit `'worklet'` directive and mutate shared
 * values only — never closure-local `let` state. The negative fixture strips
 * a directive and proves the contract fails.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/screens/camera-lab/cameraLabInstrumentation.ts', 'utf8');

/** UI-runtime-callable instrumentation callbacks that must be workletized. */
const UI_CALLBACKS = ['onRawTouch', 'onForwarded', 'onUiRevisionObserved'];

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

function analyze(text: string): { missing: string[]; sharedValueMutations: boolean } {
  const missing: string[] = [];
  let sharedValueMutations = true;
  for (const callback of UI_CALLBACKS) {
    const body = bodyOf(text, `${callback}:`);
    if (!hasWorkletDirective(body)) {
      missing.push(callback);
    }
    if (!/\.value\s*(\+=|-=|\+\+|--|=\s)/.test(body)) {
      sharedValueMutations = false;
    }
  }
  return { missing, sharedValueMutations };
}

describe('Camera Lab instrumentation worklet contract (T12-RF2)', () => {
  it('workletizes every UI-runtime callback and mutates shared values only', () => {
    const result = analyze(source);
    assert.deepEqual(result.missing, [], 'every UI callback carries the worklet directive');
    assert.ok(result.sharedValueMutations, 'UI callbacks mutate shared values, not closure state');
    // No closure-local let counters exist in the file.
    assert.ok(!/\blet\s+\w+\s*=\s*0\b/.test(source), 'no closure-local counter state');
  });

  it('fails when a required directive is removed', () => {
    const stripped = source.replace("      onRawTouch: () => {\n        'worklet';", "      onRawTouch: () => {");
    assert.notEqual(stripped, source, 'the directive was actually stripped');
    const result = analyze(stripped);
    assert.ok(result.missing.includes('onRawTouch'), 'the stripped directive is reported');
  });
});
