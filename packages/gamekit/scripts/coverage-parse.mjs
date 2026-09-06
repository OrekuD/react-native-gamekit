/**
 * LCOV coverage parsing for the library gate (GS-VALIDATION-01).
 *
 * The default table reporter keys rows by basename, so four different
 * `validation.ts` files are indistinguishable. The built-in `lcov`
 * reporter (`--test-reporter=lcov`) emits `SF:` records with
 * repository-relative paths, letting this parser attribute line, branch,
 * and function coverage per path — two validation.ts files are measured
 * independently.
 *
 * Scope is reported precisely per kind; the gate threshold applies to
 * LINE coverage only (never claim branch coverage from this check).
 * Any parsing failure — missing data, duplicate records, malformed
 * numbers, zero files — fails the gate loudly instead of passing
 * silently. Pinned by `test/coverageGate.test.ts`.
 */

/**
 * Parse LCOV text into per-path coverage.
 *
 * @param {string} text lcov output
 * @returns {Map<string, {lines:{hit:number,total:number,percent:number}, branches:{...}, functions:{...}}>}
 */
export function parseLcov(text) {
  const files = new Map();
  let current = null;
  const finish = () => {
    if (current !== null) {
      if (current.lf === null || current.lh === null) {
        throw new Error(`coverage gate: missing line summary for ${current.path}`);
      }
      if (current.lf === 0) {
        throw new Error(`coverage gate: no executable lines for ${current.path}`);
      }
      const line = { hit: current.lh, total: current.lf, percent: (current.lh / current.lf) * 100 };
      const branch =
        current.brf === null || current.brh === null
          ? null
          : { hit: current.brh, total: current.brf, percent: current.brf === 0 ? 100 : (current.brh / current.brf) * 100 };
      const func =
        current.fnf === null || current.fnh === null
          ? null
          : { hit: current.fnh, total: current.fnf, percent: current.fnf === 0 ? 100 : (current.fnh / current.fnf) * 100 };
      files.set(current.path, { lines: line, branches: branch, functions: func });
      current = null;
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      finish();
      const path = line.slice(3).trim();
      if (path === '') throw new Error('coverage gate: empty SF record');
      if (files.has(path)) {
        throw new Error(`coverage gate: duplicate coverage record for ${path}`);
      }
      current = { path, lf: null, lh: null, brf: null, brh: null, fnf: null, fnh: null };
    } else if (current !== null) {
      const num = (label) => {
        const value = Number(line.slice(label.length).trim());
        if (!Number.isFinite(value)) {
          throw new Error(`coverage gate: malformed ${label} in ${current.path}: ${line}`);
        }
        return value;
      };
      if (line.startsWith('LF:')) current.lf = num('LF:');
      else if (line.startsWith('LH:')) current.lh = num('LH:');
      else if (line.startsWith('BRF:')) current.brf = num('BRF:');
      else if (line.startsWith('BRH:')) current.brh = num('BRH:');
      else if (line.startsWith('FNF:')) current.fnf = num('FNF:');
      else if (line.startsWith('FNH:')) current.fnh = num('FNH:');
      else if (line === 'end_of_record') finish();
    }
  }
  finish();
  if (files.size === 0) {
    throw new Error('coverage gate: zero coverage records parsed');
  }
  return files;
}

/**
 * Check tracked modules against line thresholds.
 *
 * @param {Map<string, {lines:{percent:number}, branches:any, functions:any}>} coverage
 * @param {Array<{path:string,min:number}>} tracked
 * @returns {{ok:boolean, lines:string[]}}
 */
export function checkGate(coverage, tracked) {
  const lines = [];
  let ok = true;
  const seen = new Set();
  for (const { path, min } of tracked) {
    if (seen.has(path)) {
      ok = false;
      lines.push(`coverage gate: duplicate tracked identity ${path}`);
      continue;
    }
    seen.add(path);
    const entry = coverage.get(path);
    if (entry === undefined) {
      ok = false;
      lines.push(`coverage gate: no coverage data for ${path}`);
      continue;
    }
    if (!Number.isFinite(entry.lines.percent)) {
      ok = false;
      lines.push(`coverage gate: malformed percentage for ${path}`);
      continue;
    }
    const status = entry.lines.percent >= min ? 'ok' : 'FAIL';
    if (status === 'FAIL') ok = false;
    const branch = entry.branches === null ? 'branch n/a' : `branch ${entry.branches.percent.toFixed(1)}%`;
    const func = entry.functions === null ? 'func n/a' : `func ${entry.functions.percent.toFixed(1)}%`;
    lines.push(
      `coverage gate: ${path} line ${entry.lines.percent.toFixed(1)}% (>= ${min}%) ${branch} ${func} ${status}`,
    );
  }
  return { ok, lines };
}
