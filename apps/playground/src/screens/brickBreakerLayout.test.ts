import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BRICK_BREAKER_LAYOUT } from './brickBreakerLayout.ts';

/**
 * Structural interaction contract (T8.1). Native z-order hit testing cannot
 * run headless; this test pins the layout regions the screen renders from,
 * and the native acceptance matrix (T8.8) proves the overlay cannot steal
 * the back press.
 */
describe('brick breaker interaction layout (T8.1)', () => {
  it('the start surface is contained by the gameplay stage, never the top bar', () => {
    assert.equal(
      BRICK_BREAKER_LAYOUT.stage.startSurface.action,
      'start',
      'the stage owns the full-body start/restart target',
    );
    assert.ok(
      !('startSurface' in BRICK_BREAKER_LAYOUT.topBar),
      'the top bar must not contain a gameplay surface',
    );
    assert.ok(!('startSurface' in BRICK_BREAKER_LAYOUT), 'the start surface must be scoped to the stage');
  });

  it('the back control lives in the top bar and maps to exit, never to start', () => {
    assert.equal(
      BRICK_BREAKER_LAYOUT.topBar.back.action,
      'exit',
      'the back control exits; it must never pulse the semantic start action',
    );
    assert.ok(!('back' in BRICK_BREAKER_LAYOUT.stage), 'the stage never hosts the back control');
  });

  it('top bar, stage, and start surface have distinct stable test ids', () => {
    const ids = [
      BRICK_BREAKER_LAYOUT.topBar.testID,
      BRICK_BREAKER_LAYOUT.stage.testID,
      BRICK_BREAKER_LAYOUT.stage.startSurface.testID,
    ];
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) {
      assert.ok(id.length > 0);
    }
  });
});
