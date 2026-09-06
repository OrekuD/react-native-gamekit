/**
 * GS-VALIDATION-01 parser fixtures: incorrect parsing must fail the gate,
 * never silently pass it. Synthetic LCOV inputs exercise per-path
 * attribution (two validation.ts files measured independently), missing
 * data, duplicates, malformed numbers, empty reports, and threshold
 * enforcement — including a deliberately under-covered tracked fixture.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLcov, checkGate } from '../scripts/coverage-parse.mjs';

function record(path: string, lh: number, lf: number, brh = 0, brf = 0, fnh = 0, fnf = 0) {
  return [
    `SF:${path}`,
    'FNF:' + fnf,
    'FNH:' + fnh,
    'BRF:' + brf,
    'BRH:' + brh,
    'LF:' + lf,
    'LH:' + lh,
    'end_of_record',
  ].join('\n');
}

describe('coverage gate parsing (GS-VALIDATION-01)', () => {
  it('attributes same-basename files to independent paths', () => {
    const coverage = parseLcov(
      [
        record('src/assets/validation.ts', 93, 100),
        record('src/geometry/validation.ts', 75, 100),
        '',
      ].join('\n'),
    );
    assert.equal(coverage.get('src/assets/validation.ts')?.lines.percent, 93);
    assert.equal(coverage.get('src/geometry/validation.ts')?.lines.percent, 75);
    const { ok, lines } = checkGate(coverage, [
      { path: 'src/assets/validation.ts', min: 80 },
      { path: 'src/geometry/validation.ts', min: 80 },
    ]);
    assert.equal(ok, false, 'the under-covered geometry file fails');
    assert.ok(lines.some((l) => l.includes('src/geometry/validation.ts') && l.includes('FAIL')));
    assert.ok(lines.some((l) => l.includes('src/assets/validation.ts') && l.includes('ok')));
  });

  it('rejects a deliberately under-covered tracked fixture', () => {
    const coverage = parseLcov(record('src/example.ts', 10, 100) + '\n');
    const { ok } = checkGate(coverage, [{ path: 'src/example.ts', min: 80 }]);
    assert.equal(ok, false);
  });

  it('fails clearly on missing data, duplicates, and malformed rows', () => {
    const coverage = parseLcov(record('src/a.ts', 100, 100) + '\n');
    const missing = checkGate(coverage, [{ path: 'src/absent.ts', min: 80 }]);
    assert.equal(missing.ok, false);
    assert.ok(missing.lines.some((l) => l.includes('no coverage data')));

    assert.throws(
      () => parseLcov(record('src/a.ts', 100, 100) + '\n' + record('src/a.ts', 50, 100) + '\n'),
      /duplicate coverage record/,
    );
    assert.throws(() => parseLcov('SF:src/a.ts\nLF:abc\nLH:1\nend_of_record\n'), /malformed LF/);
    assert.throws(() => parseLcov('SF:src/a.ts\nend_of_record\n'), /missing line summary/);
    assert.throws(() => parseLcov(''), /zero coverage records/);
    assert.throws(() => parseLcov('SF:\nend_of_record\n'), /empty SF/);
    const dupTracked = checkGate(coverage, [
      { path: 'src/a.ts', min: 80 },
      { path: 'src/a.ts', min: 80 },
    ]);
    assert.equal(dupTracked.ok, false);
    assert.ok(dupTracked.lines.some((l) => l.includes('duplicate tracked identity')));
  });

  it('reports branch and function scope without gating on it', () => {
    const coverage = parseLcov(record('src/a.ts', 90, 100, 10, 100, 5, 5) + '\n');
    const { ok, lines } = checkGate(coverage, [{ path: 'src/a.ts', min: 80 }]);
    assert.equal(ok, true, 'line threshold passes despite low branch coverage');
    assert.ok(lines.some((l) => l.includes('branch 10.0%')));
    assert.ok(lines.some((l) => l.includes('func 100.0%')));
  });
});
