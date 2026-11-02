import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assetFailureMessage, GameAssetError } from '../src/assets/errors';

it('asset errors own an immutable path and preserve an optional failure cause', () => {
  const path = ['gameplay', 'player'];
  const cause = new Error('decoder failed');
  const error = new GameAssetError('ASSET_DECODE_FAILED', path, 'unable to decode image', { cause });
  path.push('changed');
  assert.deepEqual(error.path, ['gameplay', 'player']);
  assert.notEqual(error.path, path);
  assert.equal(Object.isFrozen(error.path), true);
  assert.equal(Object.isFrozen(path), false);
  assert.equal(error.cause, cause);
});

it('unknown asset failures never need object coercion to form a diagnostic', () => {
  const hostile = { toString: () => { throw new Error('must not coerce'); } };
  for (const value of [hostile, Object.create(null), () => undefined]) {
    assert.equal(assetFailureMessage(value), 'asset loading failed');
  }
  assert.equal(assetFailureMessage(new Error('failed')), 'failed');
  assert.equal(assetFailureMessage('reason'), 'reason');
  for (const value of [null, undefined, false, 0, 1n, Symbol('failure')]) {
    assert.equal(typeof assetFailureMessage(value), 'string');
  }
});
