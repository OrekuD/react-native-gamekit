import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  EXPO_INSTALL_EXCEPTIONS,
  checkRepositoryDependencies,
  validateDependencyPolicy,
} from './dependencies.mjs';

const baseline = () => ({
  workspace: {
    catalogs: {
      native: {
        expo: '57.0.25',
        react: '19.2.3',
        'react-dom': '19.2.3',
        'react-test-renderer': '19.2.3',
        'react-native': '0.86.3',
      },
    },
  },
  playground: {
    dependencies: {
      expo: 'catalog:native',
      react: 'catalog:native',
      'react-dom': 'catalog:native',
      'react-native': 'catalog:native',
    },
    devDependencies: { 'react-test-renderer': 'catalog:native' },
    expo: { install: { exclude: [] } },
  },
  library: {
    peerDependencies: { expo: '~57.0.25', react: '^19.2.3', 'react-native': '~0.86.3' },
    devDependencies: {
      expo: 'catalog:native',
      react: 'catalog:native',
      'react-native': 'catalog:native',
      'react-native-builder-bob': '^0.43.0',
    },
  },
});

test('accepts a shared native catalog with independently defined public peer ranges', () => {
  assert.deepEqual(validateDependencyPolicy(baseline()), []);
});

const invalidPolicies = [
  ['missing catalog', (p) => { delete p.workspace.catalogs; }, /catalogs\.native/],
  ['range in catalog', (p) => { p.workspace.catalogs.native.expo = '~57.0.25'; }, /expo.*exact/],
  ['invalid version', (p) => { p.workspace.catalogs.native.expo = 'latest'; }, /expo.*exact/],
  ['app version repeated', (p) => { p.playground.dependencies.expo = '57.0.25'; }, /playground.*expo.*catalog:native/],
  ['library version repeated', (p) => { p.library.devDependencies.expo = '57.0.25'; }, /gamekit.*expo.*catalog:native/],
  ['missing catalog reference target', (p) => { p.playground.dependencies['expo-camera'] = 'catalog:native'; }, /expo-camera.*catalog/],
  ['new Expo module unmanaged', (p) => { p.playground.dependencies['expo-camera'] = '57.0.0'; }, /expo-camera.*catalog/],
  ['new scoped Expo module unmanaged', (p) => { p.playground.dependencies['@expo/ui'] = '57.0.0'; }, /@expo\/ui.*catalog/],
  ['new scoped native module unmanaged', (p) => { p.playground.dependencies['@react-native-async-storage/async-storage'] = '2.2.0'; }, /async-storage.*catalog/],
  ['new scoped native package unmanaged', (p) => { p.playground.dependencies['@notifee/react-native'] = '1.0.0'; }, /@notifee\/react-native.*catalog/],
  ['new scoped native suffix unmanaged', (p) => { p.playground.dependencies['@stripe/stripe-react-native'] = '1.0.0'; }, /@stripe\/stripe-react-native.*catalog/],
  ['peer incompatible', (p) => { p.library.peerDependencies.react = '^18.0.0'; }, /react.*does not satisfy/],
  ['peer protocol', (p) => { p.library.peerDependencies.react = 'catalog:native'; }, /react.*explicit.*range/],
  ['peer missing app install', (p) => { delete p.playground.dependencies.react; }, /peer react.*playground/],
  ['peer missing library dev install', (p) => { delete p.library.devDependencies.react; }, /peer react.*devDependencies/],
  ['native library dependency', (p) => { p.library.dependencies = { 'react-native-camera': '1.0.0' }; }, /gamekit.*dependencies.*react-native-camera/],
  ['native library optional dependency', (p) => { p.library.optionalDependencies = { expo: '57.0.25' }; }, /gamekit.*optionalDependencies.*expo/],
  ['scoped native library dependency', (p) => { p.library.dependencies = { '@notifee/react-native': '1.0.0' }; }, /gamekit.*dependencies.*@notifee\/react-native/],
  ['unknown Expo exclusion', (p) => { p.playground.expo.install.exclude = ['expo-camera']; }, /expo-camera.*exception/],
  ['uninstalled Expo exception', (p) => { p.playground.expo.install.exclude = ['react-native-worklets']; }, /react-native-worklets.*catalog.*playground/],
  ['malformed exclusion', (p) => { p.playground.expo.install.exclude = 'expo'; }, /exclude.*array/],
  ['unused catalog entry', (p) => { p.workspace.catalogs.native['expo-camera'] = '57.0.0'; }, /expo-camera.*unused/],
  ['React renderer mismatch', (p) => { p.workspace.catalogs.native['react-test-renderer'] = '19.2.4'; }, /react-test-renderer.*react/],
];

for (const [name, change, message] of invalidPolicies) {
  test(`rejects ${name}`, () => {
    const policy = baseline();
    change(policy);
    assert.match(validateDependencyPolicy(policy).join('\n'), message);
  });
}

test('documents only the four intentional Expo exceptions', () => {
  assert.deepEqual(Object.keys(EXPO_INSTALL_EXCEPTIONS).sort(), [
    '@shopify/react-native-skia', 'react-native-gesture-handler',
    'react-native-reanimated', 'react-native-worklets',
  ]);
  const policy = baseline();
  policy.playground.expo.install.exclude = Object.keys(EXPO_INSTALL_EXCEPTIONS);
  for (const name of Object.keys(EXPO_INSTALL_EXCEPTIONS)) {
    policy.workspace.catalogs.native[name] = '1.0.0';
    policy.playground.dependencies[name] = 'catalog:native';
  }
  assert.deepEqual(validateDependencyPolicy(policy), []);
  assert.ok(Object.values(EXPO_INSTALL_EXCEPTIONS).every((reason) => reason.length > 20));
  // An exception can be removed when the package returns to Expo's defaults.
  policy.playground.expo.install.exclude = [];
  assert.deepEqual(validateDependencyPolicy(policy), []);
});

test('optional public peers are installed by the playground to exercise those features', () => {
  const policy = baseline();
  policy.library.peerDependenciesMeta = { expo: { optional: true } };
  assert.deepEqual(validateDependencyPolicy(policy), []);
  delete policy.playground.dependencies.expo;
  assert.match(validateDependencyPolicy(policy).join('\n'), /peer expo.*playground/);
});

function withLockfile(policy = baseline()) {
  const catalog = policy.workspace.catalogs.native;
  const importers = Object.fromEntries([
    ['apps/playground', policy.playground], ['packages/gamekit', policy.library],
  ].map(([path, manifest]) => [path, Object.fromEntries(
    ['dependencies', 'devDependencies'].map((field) => [field, Object.fromEntries(
      Object.entries(manifest[field] ?? {}).filter(([, specifier]) => specifier === 'catalog:native')
        .map(([name, specifier]) => [name, { specifier, version: `${catalog[name]}(peer@1.0.0)` }]),
    )]),
  )]));
  return { ...policy, lockfile: {
    catalogs: { native: Object.fromEntries(Object.entries(catalog)
      .map(([name, version]) => [name, { specifier: version, version }])) },
    importers,
  } };
}

test('accepts catalog lock entries and peer-qualified importer versions', () => {
  assert.deepEqual(validateDependencyPolicy(withLockfile()), []);
});

for (const [name, change, message] of [
  ['missing locked catalog', (p) => { delete p.lockfile.catalogs; }, /lockfile.*catalog/],
  ['stale locked catalog', (p) => { p.lockfile.catalogs.native.react.version = '19.2.4'; }, /lockfile.*react/],
  ['stale locked specifier', (p) => { p.lockfile.catalogs.native.react.specifier = '^19.2.3'; }, /lockfile.*react/],
  ['missing importer', (p) => { delete p.lockfile.importers['apps/playground']; }, /lockfile.*apps\/playground/],
  ['stale importer specifier', (p) => { p.lockfile.importers['apps/playground'].dependencies.react.specifier = '^19.2.3'; }, /lockfile.*apps\/playground.*react/],
  ['stale importer version', (p) => { p.lockfile.importers['packages/gamekit'].devDependencies.react.version = '19.2.4'; }, /lockfile.*packages\/gamekit.*react/],
]) {
  test(`rejects ${name}`, () => {
    const policy = withLockfile();
    change(policy);
    assert.match(validateDependencyPolicy(policy).join('\n'), message);
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gamekit-dependencies-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const policy = withLockfile();
  writeFileSync(join(root, 'pnpm-workspace.yaml'), JSON.stringify(policy.workspace));
  writeFileSync(join(root, 'pnpm-lock.yaml'), JSON.stringify(policy.lockfile));
  writeJson(join(root, 'apps/playground/package.json'), policy.playground);
  writeJson(join(root, 'packages/gamekit/package.json'), policy.library);
  for (const [name, version] of Object.entries(policy.workspace.catalogs.native)) {
    writeJson(join(root, 'node_modules', name, 'package.json'), { name, version });
  }
  return root;
}

test('checks an installed workspace without comparing the independent docs app', (t) => {
  const root = fixture(t);
  writeJson(join(root, 'apps/docs/node_modules/react/package.json'), { name: 'react', version: '18.0.0' });
  assert.deepEqual(checkRepositoryDependencies(root), []);
});

test('ignores a separate React used only by unrelated development tooling', (t) => {
  const root = fixture(t);
  const policy = baseline();
  writeJson(join(root, 'apps/playground/package.json'), {
    ...policy.playground,
    devDependencies: { ...policy.playground.devDependencies, 'web-linter': '1.0.0' },
  });
  writeJson(join(root, 'node_modules/web-linter/package.json'), {
    name: 'web-linter', version: '1.0.0', dependencies: { react: '18.0.0' },
  });
  writeJson(join(root, 'node_modules/web-linter/node_modules/react/package.json'), { name: 'react', version: '18.0.0' });
  assert.deepEqual(checkRepositoryDependencies(root), []);
});

test('reports installed version drift', (t) => {
  const root = fixture(t);
  writeJson(join(root, 'node_modules/expo/package.json'), { name: 'expo', version: '57.0.30' });
  assert.match(checkRepositoryDependencies(root).join('\n'), /expo.*57\.0\.30.*57\.0\.25/);
});

test('reports duplicate native instances even when their versions match', (t) => {
  const root = fixture(t);
  writeJson(join(root, 'packages/gamekit/node_modules/react/package.json'), { name: 'react', version: '19.2.3' });
  assert.match(checkRepositoryDependencies(root).join('\n'), /react.*multiple.*instances/);
});

test('compares peer resolution from app dependencies, including JS-only wrappers', (t) => {
  const root = fixture(t);
  const policy = baseline();
  writeJson(join(root, 'apps/playground/package.json'), {
    ...policy.playground, dependencies: { ...policy.playground.dependencies, wrapper: '1.0.0' },
  });
  writeJson(join(root, 'node_modules/wrapper/package.json'), { name: 'wrapper', version: '1.0.0', peerDependencies: { react: '*' } });
  writeJson(join(root, 'node_modules/wrapper/node_modules/react/package.json'), { name: 'react', version: '19.2.3' });
  assert.match(checkRepositoryDependencies(root).join('\n'), /react.*multiple.*instances/);
});

test('canonicalizes symlinks pointing to the same installed package', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'packages/gamekit/node_modules'), { recursive: true });
  symlinkSync(join(root, 'node_modules/react'), join(root, 'packages/gamekit/node_modules/react'));
  assert.deepEqual(checkRepositoryDependencies(root), []);
});

test('reports missing installed native packages', (t) => {
  const root = fixture(t);
  rmSync(join(root, 'node_modules/react'), { recursive: true });
  assert.match(checkRepositoryDependencies(root).join('\n'), /resolve react.*pnpm install/);
});

test('reports missing and malformed workspace input without a stack trace', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'catalogs: [');
  assert.match(checkRepositoryDependencies(root).join('\n'), /pnpm-workspace.yaml/);
  rmSync(join(root, 'apps/playground/package.json'));
  assert.match(checkRepositoryDependencies(root).join('\n'), /package.json|pnpm-workspace.yaml/);
});

test('CLI reports success and a nonzero exit on invalid policy', (t) => {
  const root = fixture(t);
  const script = fileURLToPath(new URL('./dependencies.mjs', import.meta.url));
  assert.match(execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8' }), /passed/);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), '{}');
  assert.throws(() => execFileSync(process.execPath, [script, '--root', root], { stdio: 'pipe' }),
    (error) => error.status === 1 && /catalogs.native/.test(error.stderr.toString()));
});
