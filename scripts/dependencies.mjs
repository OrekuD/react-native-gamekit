import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';
import YAML from 'yaml';

const CATALOG_REFERENCE = 'catalog:native';

// These libraries intentionally use the tested native stack rather than Expo's
// defaults. Exclusion is not evidence of compatibility; native builds still are.
export const EXPO_INSTALL_EXCEPTIONS = Object.freeze({
  '@shopify/react-native-skia': 'The renderer uses the explicitly tested Skia API and native binaries.',
  'react-native-gesture-handler': 'Pointer input uses the explicitly tested Gesture Handler API.',
  'react-native-reanimated': 'Presentation worklets use the explicitly tested Reanimated/Worklets pair.',
  'react-native-worklets': 'The Worklets runtime must be upgraded and tested with Reanimated.',
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// Cover the current catalog and common native package names, including scoped
// packages such as @notifee/react-native and @stripe/stripe-react-native. Naming
// cannot identify every native module; Expo autolinking is checked separately.
const isNativeRuntime = (name) => /^(?:react$|react-dom$|react-test-renderer$|expo(?:-|$)|@expo\/|@react-native(?:-|\/))/.test(name)
  || /(?:^|[\/-])react-native(?:-|$)/.test(name);

function checkManifestReferences(errors, label, manifest, fields, catalog) {
  for (const field of fields) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (Object.hasOwn(catalog, name) && version !== CATALOG_REFERENCE) {
        errors.push(`${label} ${field}.${name} must reference ${CATALOG_REFERENCE}.`);
      } else if (version === CATALOG_REFERENCE && !Object.hasOwn(catalog, name)) {
        errors.push(`${label} ${field}.${name} has no catalogs.native entry.`);
      }
    }
  }
}

function checkPeers(errors, playground, library, catalog) {
  for (const [name, range] of Object.entries(library.peerDependencies ?? {})) {
    if (typeof range !== 'string' || !semver.validRange(range)) {
      errors.push(`gamekit peer ${name} must have an explicit semver range, not a catalog or workspace reference.`);
    } else if (semver.valid(catalog[name]) && !semver.satisfies(catalog[name], range)) {
      errors.push(`gamekit peer ${name}: tested ${catalog[name]} does not satisfy ${range}.`);
    }
    if (!Object.hasOwn(catalog, name)) errors.push(`gamekit peer ${name} needs a catalogs.native entry.`);
    // Even optional public peers are installed here so the playground exercises
    // every optional feature; consumers can still omit unused optional peers.
    if (playground.dependencies?.[name] !== CATALOG_REFERENCE) {
      errors.push(`gamekit peer ${name} must be installed in playground dependencies using ${CATALOG_REFERENCE}.`);
    }
    if (library.devDependencies?.[name] !== CATALOG_REFERENCE) {
      errors.push(`gamekit peer ${name} must be installed in gamekit devDependencies using ${CATALOG_REFERENCE}.`);
    }
  }
}

function checkExclusions(errors, playground, catalog) {
  const exclude = playground.expo?.install?.exclude ?? [];
  if (!Array.isArray(exclude)) {
    errors.push('playground expo.install.exclude must be an array.');
    return;
  }
  for (const name of exclude) {
    if (typeof name !== 'string' || !Object.hasOwn(EXPO_INSTALL_EXCEPTIONS, name)) {
      errors.push(`Expo exclusion ${String(name)} needs a documented, reviewed exception in scripts/dependencies.mjs.`);
    } else if (!Object.hasOwn(catalog, name) || playground.dependencies?.[name] !== CATALOG_REFERENCE) {
      errors.push(`Expo exclusion ${name} must be a catalog-backed playground dependency.`);
    }
  }
}

function checkLockfile(errors, lockfile, catalog, playground, library) {
  for (const [name, version] of Object.entries(catalog)) {
    const locked = lockfile?.catalogs?.native?.[name];
    if (locked?.specifier !== version || locked?.version !== version) {
      errors.push(`lockfile catalogs.native.${name} must lock ${version}. Run pnpm install and commit pnpm-lock.yaml.`);
    }
  }
  for (const [path, manifest] of [['apps/playground', playground], ['packages/gamekit', library]]) {
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (specifier !== CATALOG_REFERENCE) continue;
        const locked = lockfile?.importers?.[path]?.[field]?.[name];
        // pnpm lockfile v9 appends peer contexts in parentheses to versions.
        const version = typeof locked?.version === 'string' ? locked.version.split('(')[0] : undefined;
        if (locked?.specifier !== specifier || version !== catalog[name]) {
          errors.push(`lockfile ${path} ${field}.${name} must reference ${specifier} at ${catalog[name]}. Run pnpm install and commit pnpm-lock.yaml.`);
        }
      }
    }
  }
}

/** Validate authored policy without reading files or contacting registries. */
export function validateDependencyPolicy({ workspace, playground, library, lockfile }) {
  const errors = [];
  const catalog = workspace?.catalogs?.native;
  if (!isRecord(catalog) || Object.keys(catalog).length === 0) {
    return ['pnpm-workspace.yaml must define a nonempty catalogs.native map.'];
  }
  for (const [label, manifest] of [['playground', playground], ['gamekit', library]]) {
    if (!isRecord(manifest)) return [`${label} package.json must contain an object.`];
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (manifest[field] !== undefined && !isRecord(manifest[field])) {
        errors.push(`${label} ${field} must be an object of package names and versions.`);
      }
    }
  }
  if (errors.length) return errors;
  for (const [name, version] of Object.entries(catalog)) {
    if (typeof version !== 'string' || semver.valid(version) !== version) {
      errors.push(`catalogs.native.${name} must be an exact canonical version, received ${String(version)}.`);
    }
    const used = [playground.dependencies, playground.devDependencies, library.devDependencies]
      .some((dependencies) => dependencies?.[name] === CATALOG_REFERENCE);
    if (!used) errors.push(`catalogs.native.${name} is unused; reference it or remove it.`);
  }
  checkManifestReferences(errors, 'playground', playground, ['dependencies', 'devDependencies'], catalog);
  checkManifestReferences(errors, 'gamekit', library, ['devDependencies'], catalog);
  for (const name of Object.keys(playground.dependencies ?? {})) {
    if (isNativeRuntime(name) && !Object.hasOwn(catalog, name)) {
      errors.push(`playground native dependency ${name} needs an exact catalogs.native entry.`);
    }
  }
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const name of Object.keys(library[field] ?? {})) {
      if (isNativeRuntime(name)) errors.push(`gamekit ${field}.${name} must be a peer dependency with a catalog-backed devDependency.`);
    }
  }
  for (const name of ['react-dom', 'react-test-renderer']) {
    if (catalog[name] !== undefined && catalog[name] !== catalog.react) {
      errors.push(`catalogs.native.${name} must match react (${catalog.react}).`);
    }
  }
  checkPeers(errors, playground, library, catalog);
  checkExclusions(errors, playground, catalog);
  if (lockfile !== undefined) checkLockfile(errors, lockfile, catalog, playground, library);
  return errors;
}

function readPolicyFile(path, parse) {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
}

const readJson = (path) => readPolicyFile(path, JSON.parse);

function resolvePackage(name, fromManifest) {
  const require = createRequire(fromManifest);
  let path;
  try {
    path = require.resolve(`${name}/package.json`);
  } catch {
    // Some packages export their entry point but hide package.json.
    let directory = dirname(require.resolve(name));
    while (true) {
      const candidate = join(directory, 'package.json');
      try {
        if (readJson(candidate).name === name) { path = candidate; break; }
      } catch { /* Keep walking toward the package root. */ }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`No package.json found for ${name}`);
      directory = parent;
    }
  }
  const canonicalPath = realpathSync(path);
  return { path: canonicalPath, manifest: readJson(canonicalPath) };
}

/**
 * Check direct installs and the native dependency/peer edges reachable from app
 * dependencies. This is a Node-resolution check, not a Metro/autolinking solver;
 * Expo autolinking verification and native builds remain separate checks.
 */
function checkInstalledDependencies(root, { workspace, playground, library }) {
  const catalog = workspace.catalogs.native;
  const singletons = new Set(Object.keys(catalog).filter(isNativeRuntime));
  const errors = [];
  const instances = new Map();
  const visited = new Set();
  const queue = [];
  const inspect = (name, from, required) => {
    try {
      const item = resolvePackage(name, from);
      if (catalog[name] && item.manifest.version !== catalog[name]) {
        errors.push(`${name} resolves to ${item.manifest.version} from ${from}; expected catalog version ${catalog[name]}. Run pnpm install.`);
      }
      if (singletons.has(name)) {
        const paths = instances.get(name) ?? new Set();
        paths.add(item.path);
        instances.set(name, paths);
      }
      if (!visited.has(item.path)) {
        visited.add(item.path);
        queue.push(item);
      }
    } catch (error) {
      if (required) errors.push(`Cannot resolve ${name} from ${from}: ${error.message.split('\n')[0]}. Run pnpm install.`);
    }
  };
  for (const [directory, manifest] of [['apps/playground', playground], ['packages/gamekit', library]]) {
    const from = join(root, directory, 'package.json');
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const name of Object.keys(declared)) {
      const appDependency = directory === 'apps/playground' && Object.hasOwn(manifest.dependencies ?? {}, name);
      if (appDependency || Object.hasOwn(catalog, name)) {
        inspect(name, from, Object.hasOwn(catalog, name));
      }
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const { path, manifest } = queue[index];
    const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(dependencies)) {
      if (!singletons.has(name)) continue;
      const optional = manifest.peerDependenciesMeta?.[name]?.optional || Object.hasOwn(manifest.optionalDependencies ?? {}, name);
      inspect(name, path, !optional);
    }
  }
  for (const [name, paths] of instances) {
    if (paths.size > 1) errors.push(`${name} resolves to multiple native app instances:\n  ${[...paths].join('\n  ')}\nAlign dependency and peer resolutions in the native app and library.`);
  }
  return [...new Set(errors)];
}

/** Read the repository baseline and validate it against the current install. */
export function checkRepositoryDependencies(root) {
  let policy;
  try {
    policy = {
      workspace: readPolicyFile(join(root, 'pnpm-workspace.yaml'), YAML.parse),
      playground: readJson(join(root, 'apps/playground/package.json')),
      library: readJson(join(root, 'packages/gamekit/package.json')),
      lockfile: readPolicyFile(join(root, 'pnpm-lock.yaml'), YAML.parse),
    };
  } catch (error) {
    return [`Could not read dependency policy files under ${root}: ${error.message}`];
  }
  const errors = validateDependencyPolicy(policy);
  return errors.length ? errors : checkInstalledDependencies(root, policy);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const validArgs = args.length === 0 || (args.length === 2 && args[0] === '--root');
  const root = args.length ? resolve(args[1] ?? '.') : fileURLToPath(new URL('..', import.meta.url));
  const errors = validArgs ? checkRepositoryDependencies(root) : ['Usage: node scripts/dependencies.mjs [--root <repository>]'];
  if (errors.length) {
    console.error(`Dependency policy failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Dependency policy and installed native resolution checks passed.');
  }
}
