import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRICK_BREAKER_LAYOUT } from './brickBreakerLayout.ts';

/**
 * Structural interaction contract (T8.1 / T8.9).
 *
 * Native z-order hit testing cannot run headless; the contract pins the
 * layout regions AND the pointer-events policy the screen renders from, and
 * the source-consumption check proves the rendered component actually wires
 * that policy (not just a parallel metadata object). The native acceptance
 * matrix (T8.8) proves the overlay cannot steal the back press and that
 * stage touches reach the paddle.
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

  it('the stage container is touch-transparent so gameplay touches reach the pointer surface', () => {
    assert.equal(
      BRICK_BREAKER_LAYOUT.stage.pointerEvents,
      'box-none',
      'an auto stage would intercept every gameplay touch before RNGH',
    );
  });

  it('the rendered component wires the contract pointer-events policy, not a parallel copy', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'BrickBreakerContent.tsx'),
      'utf8',
    );
    assert.match(
      source,
      /pointerEvents=\{BRICK_BREAKER_LAYOUT\.stage\.pointerEvents\}/,
      'the stage View must render its pointerEvents from the layout contract',
    );
    // The stage's only interactive child is the start/restart Pressable; the
    // HUD layer must stay non-interactive so it never blocks the pointer.
    assert.match(
      source,
      /pointerEvents="none" style=\{StyleSheet\.absoluteFill\}/,
      'the HUD overlay stays touch-transparent',
    );
    assert.doesNotMatch(
      source,
      /pointerEvents="none"[\s\S]{0,400}testID=\{BRICK_BREAKER_LAYOUT\.stage\.startSurface\.testID\}/,
      'the start surface must not be non-interactive',
    );
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
