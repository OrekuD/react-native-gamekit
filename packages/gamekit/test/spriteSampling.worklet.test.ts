/** Installed Babel-plugin output executed in an isolated JS context.
 * This checks transferred code and closures, not native UI scheduling. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const workletsRequire = createRequire(require.resolve('react-native-worklets/package.json'));
const babel = workletsRequire('@babel/core') as {
  transformSync(source: string, options: Record<string, unknown>): { code: string };
};
const filename = new URL('../src/sprites/sampleSpriteClip.ts', import.meta.url);

type Callable = (...args: unknown[]) => unknown;
type Transferred = Callable & {
  __closure: Record<string, unknown>;
  __initData: { code: string };
  __workletHash: number;
};

function compile(source: string): Record<string, Transferred> {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  const transformed = babel.transformSync(javascript, {
    filename: filename.pathname,
    babelrc: false,
    configFile: false,
    plugins: [
      workletsRequire.resolve('react-native-worklets/plugin'),
    ],
  });
  // Lower exports after workletization: the plugin turns function declarations
  // into const factories, so pre-hoisted CommonJS assignments would hit a TDZ.
  const commonjs = ts.transpileModule(transformed.code, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exported: Record<string, Transferred> = {};
  runInNewContext(commonjs, { exports: exported, global: { Error } });
  return exported;
}

function transfer(fn: Transferred): Callable {
  assert.equal(typeof fn.__workletHash, 'number', 'every reachable function must be workletized');
  const closure = Object.fromEntries(Object.entries(fn.__closure).map(([key, value]) => {
    assert.equal(typeof value, 'function', `unexpected captured value: ${key}`);
    return [key, transfer(value as Transferred)];
  }));
  const isolated = createContext({});
  const executable = runInContext(`(${fn.__initData.code})`, isolated) as Callable;
  return (...args) => executable.apply({ __closure: closure }, args);
}

describe('sprite sampler transferred worklet code', () => {
  it('executes sampling and error paths with only transferred function dependencies', () => {
    const exports = compile(readFileSync(filename, 'utf8'));
    const sample = transfer(exports.sampleSpriteClipFrame!);
    const name = transfer(exports.sampleSpriteClipFrameName!);
    const duration = transfer(exports.spriteClipDurationMs!);
    const select = transfer(exports.spriteFrameNameForClip!);
    const loop = { frames: ['a', 'b'], frameDurationMs: 100, mode: 'loop' };
    const once = { ...loop, mode: 'once' };
    assert.equal(sample(loop, -1), 1);
    assert.equal(sample(loop, -Number.MIN_VALUE), 1);
    assert.equal(sample({ ...loop, frameDurationMs: 0.1 }, 900719925474098.1), 0);
    assert.equal(sample(once, -1), 0);
    assert.equal(name(loop, 100), 'b');
    assert.equal(name(once, 500), 'b');
    assert.equal(duration(loop), 200);
    assert.equal(select({ idle: loop }, 'idle', 200), 'a');
    assert.throws(() => select({ idle: loop }, 'toString', 0), /ASSET_UNKNOWN_CLIP/);
    assert.throws(() => sample(loop, NaN), /finite/);
    assert.throws(() => sample({ ...loop, frames: [] }, 0), /at least one frame/);
    assert.throws(() => sample({ ...loop, frameDurationMs: 0 }, 0), /duration/);
    assert.throws(() => duration({ ...loop, frameDurationMs: Number.MAX_VALUE }), /finite/);
    assert.throws(() => sample({ ...loop, mode: 'bad' }, 0), /mode/);
    assert.throws(() => name({ ...loop, frames: new Array(2) }, 0), /frame name/);
  });

  it('detects a reachable ordinary JS function even when the entry point is a worklet', () => {
    const source = readFileSync(filename, 'utf8');
    const missingDirective = source.replace("  'worklet';", '');
    assert.notEqual(source, missingDirective);
    const exports = compile(missingDirective);
    assert.throws(() => transfer(exports.sampleSpriteClipFrame!), /every reachable function/);
  });
});
