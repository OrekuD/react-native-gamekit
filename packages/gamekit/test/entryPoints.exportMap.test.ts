import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

describe('entry-points: export-map and build outputs', () => {
  it('package.json has explicit exports for all seven new subpaths', () => {
    const expected = ['geometry', 'collision2d', 'camera2d', 'events', 'assets', 'sprites', 'storage'];
    for (const name of expected) {
      const key = `./${name}`;
      const entry = pkg.exports[key];
      assert.ok(entry, `missing export ${key}`);
      assert.equal(entry['react-native'], `./src/${name}.ts`, `${key} react-native condition`);
      assert.equal(entry.source, `./src/${name}.ts`, `${key} source condition`);
      assert.equal(entry.types, `./lib/typescript/src/${name}.d.ts`, `${key} types condition`);
      assert.equal(entry.default, `./lib/module/${name}.js`, `${key} default condition`);
    }
  });

  it('does not use wildcard exports', () => {
    for (const key of Object.keys(pkg.exports)) {
      assert.ok(!key.includes('*'), `wildcard export not allowed: ${key}`);
    }
  });

  it('existing subpaths unchanged', () => {
    for (const key of ['.', './react', './testing', './audio', './haptics', './particles', './tilemap']) {
      assert.ok(pkg.exports[key], `existing export ${key} missing`);
    }
    assert.equal(pkg.exports['./react'].default, './lib/module/react.js');
  });

  it('no export points at private path', () => {
    for (const [key, entry] of Object.entries(pkg.exports as Record<string, Record<string, string>>)) {
      for (const [, value] of Object.entries(entry)) {
        if (key === './package.json') continue;
        assert.ok(!value.includes('/private/'), `${key} points at private ${value}`);
        assert.ok(!value.includes('/internal/'), `${key} points at internal ${value}`);
        if (value.startsWith('./src/')) {
          const srcPath = path.join(pkgRoot, value);
          assert.ok(fs.existsSync(srcPath), `${key} src not shipped: ${value}`);
        }
      }
    }
  });

  it('Builder Bob emitted ESM and declarations for every export target', () => {
    const modules = fs.readdirSync(path.join(pkgRoot, 'lib/module'));
    const types = fs.readdirSync(path.join(pkgRoot, 'lib/typescript/src'));
    for (const name of ['geometry', 'collision2d', 'camera2d', 'events', 'assets', 'sprites', 'storage']) {
      assert.ok(modules.includes(`${name}.js`), `missing lib/module/${name}.js`);
      assert.ok(types.includes(`${name}.d.ts`), `missing lib/typescript/src/${name}.d.ts`);
      const js = fs.readFileSync(path.join(pkgRoot, `lib/module/${name}.js`), 'utf8');
      assert.ok(js.length > 0, `${name}.js empty`);
      const dts = fs.readFileSync(path.join(pkgRoot, `lib/typescript/src/${name}.d.ts`), 'utf8');
      assert.ok(dts.length > 0, `${name}.d.ts empty`);
      // Smoke: ensure no React import leaked into headless built modules
      if (['geometry', 'collision2d', 'camera2d', 'events', 'assets', 'sprites', 'storage'].includes(name)) {
        assert.ok(!/react-native-reanimated|@shopify\/react-native-skia/.test(js), `${name}.js leaked native import`);
      }
    }
  });

  it('built package re-exports match source barrels (types exist)', () => {
    const dtsRoot = fs.readFileSync(path.join(pkgRoot, 'lib/typescript/src/index.d.ts'), 'utf8');
    // Root still re-exports via export * for compatibility — must not have been removed
    assert.ok(dtsRoot.includes(`from './geometry`), 'root d.ts missing geometry re-export');
    assert.ok(dtsRoot.includes(`from './collision2d`), 'root d.ts missing collision2d re-export');
    // Subpath barrels are thin re-exports — verify they point at the feature index and that the underlying declarations exist
    const geomDts = fs.readFileSync(path.join(pkgRoot, 'lib/typescript/src/geometry.d.ts'), 'utf8');
    assert.ok(geomDts.includes(`from './geometry/index`), 'geometry.d.ts should re-export from ./geometry/index');
    const geomIndex = fs.readFileSync(path.join(pkgRoot, 'lib/typescript/src/geometry/index.d.ts'), 'utf8');
    assert.ok(geomIndex.includes('GeometryError'), 'geometry/index.d.ts missing GeometryError');
    const collDts = fs.readFileSync(path.join(pkgRoot, 'lib/typescript/src/collision2d.d.ts'), 'utf8');
    assert.ok(collDts.includes(`from './collision2d/index`), 'collision2d.d.ts should re-export from ./collision2d/index');
  });
});
