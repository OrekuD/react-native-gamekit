import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTable, renderInstall, replaceBlock, syncDocuments } from './dependency-docs.mjs';

test('compatibility table distinguishes support ranges from exact test versions', () => {
  assert.equal(renderTable({ react: '19.2.3' }, { react: '^19.2.0' }),
    '| Package | Workspace version | Supported peer range |\n| --- | --- | --- |\n| `react` | `19.2.3` | `^19.2.0` |');
  assert.throws(() => renderTable({}, { react: '^19.2.0' }), /react/);
});

test('installation recipe uses the catalog, including scoped packages', () => {
  const result = renderInstall({ '@shopify/react-native-skia': '2.11.0', 'expo-asset': '57.0.18' },
    ['@shopify/react-native-skia', 'expo-asset'], 'npx');
  assert.equal(result, 'npx expo install @shopify/react-native-skia@2.11.0 expo-asset@57.0.18');
  assert.throws(() => renderInstall({}, ['missing'], 'npx'), /missing/);
});

test('generated block replacement preserves surrounding content and is idempotent', () => {
  const source = 'before\n<!-- deps:table:start -->\nstale\n<!-- deps:table:end -->\nafter';
  const result = replaceBlock(source, 'table', 'fresh', false);
  assert.equal(result, source.replace('stale', 'fresh'));
  assert.equal(replaceBlock(result, 'table', 'fresh', false), result);
});

test('MDX uses JSX comments and invalid markers fail without overwriting content', () => {
  const source = 'before\n{/* deps:table:start */}\nold\n{/* deps:table:end */}\nafter';
  assert.equal(replaceBlock(source, 'table', 'new', true), source.replace('old', 'new'));
  assert.throws(() => replaceBlock('no markers', 'table', 'new', false), /markers/);
  assert.throws(() => replaceBlock(source + source, 'table', 'new', true), /markers/);
  assert.throws(() => replaceBlock('<!-- deps:table:end --><!-- deps:table:start -->', 'table', 'new', false), /markers/);
});

test('repository docs stay in sync; check mode detects drift without writing', (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'gamekit-dependency-docs-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const path of [
    'pnpm-workspace.yaml', 'packages/gamekit/package.json', 'apps/playground/package.json',
    'README.md', 'packages/gamekit/README.md',
    'apps/docs/content/docs/introduction/supported-platforms.mdx',
    'apps/docs/content/docs/getting-started/installation.mdx', 'scripts/dependency-docs.mjs',
  ]) {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    copyFileSync(join(root, path), join(fixture, path));
  }
  symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  const command = (...args) => spawnSync(process.execPath, [join(fixture, 'scripts/dependency-docs.mjs'), ...args], { encoding: 'utf8' });
  assert.deepEqual(syncDocuments(fixture, { check: true }), []);
  assert.equal(command('--check').status, 0);
  assert.match(command('--check').stdout, /match the catalog/);
  const path = join(fixture, 'packages/gamekit/README.md');
  const original = readFileSync(path, 'utf8');
  const stale = original.replace(/npx expo install [^\n]+/, 'npx expo install unpinned-package');
  writeFileSync(path, stale);
  assert.deepEqual(syncDocuments(fixture, { check: true }), ['packages/gamekit/README.md']);
  assert.equal(readFileSync(path, 'utf8'), stale);
  assert.match(command('--check').stderr, /stale/);
  assert.equal(command().status, 0);
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.deepEqual(syncDocuments(fixture), []);
  assert.match(command('--unknown').stderr, /Usage/);
  const install = readFileSync(join(fixture, 'apps/docs/content/docs/getting-started/installation.mdx'), 'utf8');
  assert.match(install, /pnpm exec expo install/);
  writeFileSync(path, 'missing markers');
  assert.throws(() => syncDocuments(fixture), /markers/);
  assert.match(command('--check').stderr, /markers/);
});
