import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

export function renderTable(native, peers) {
  return [
    '| Package | Workspace version | Supported peer range |',
    '| --- | --- | --- |',
    ...Object.entries(peers).map(([name, range]) => {
      if (!native[name]) throw new Error(`Missing native catalog entry: ${name}`);
      return `| \`${name}\` | \`${native[name]}\` | \`${range}\` |`;
    }),
  ].join('\n');
}

export function renderInstall(native, packages, runner) {
  const args = packages.map((name) => {
    if (!native[name]) throw new Error(`Missing native catalog entry: ${name}`);
    return `${name}@${native[name]}`;
  });
  return `${runner} expo install ${args.join(' ')}`;
}

export function replaceBlock(source, name, content, mdx) {
  const marker = (edge) => mdx ? `{/* deps:${name}:${edge} */}` : `<!-- deps:${name}:${edge} -->`;
  const start = marker('start');
  const end = marker('end');
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end);
  if (startAt < 0 || endAt < startAt || source.split(start).length !== 2 || source.split(end).length !== 2) {
    throw new Error(`Missing, duplicate or unordered markers for ${name}`);
  }
  return `${source.slice(0, startAt + start.length)}\n${content}\n${source.slice(endAt)}`;
}

const code = (language, content) => `\`\`\`${language}\n${content}\n\`\`\``;
const runners = { npm: 'npx', yarn: 'yarn', pnpm: 'pnpm exec', bun: 'bunx' };
const tabs = (native, packages) => [
  '<Tabs items={[\'npm\', \'yarn\', \'pnpm\', \'bun\']} groupId="package-manager" persist>',
  ...Object.entries(runners).map(([manager, runner]) =>
    `  <Tab value="${manager}">\n${code('sh', renderInstall(native, packages, runner)).split('\n').map((line) => `    ${line}`).join('\n')}\n  </Tab>`),
  '</Tabs>',
].join('\n');

// Stage every replacement before writing so broken markers cannot cause a partial update.
export function syncDocuments(root, { check = false } = {}) {
  const read = (path) => readFileSync(resolve(root, path), 'utf8');
  const native = YAML.parse(read('pnpm-workspace.yaml')).catalogs.native;
  const library = JSON.parse(read('packages/gamekit/package.json'));
  const playground = JSON.parse(read('apps/playground/package.json'));
  const peers = library.peerDependencies;
  const optional = Object.keys(peers).filter((name) => library.peerDependenciesMeta?.[name]?.optional);
  const required = Object.keys(peers).filter((name) => !optional.includes(name) && !['expo', 'react', 'react-native'].includes(name));
  const table = renderTable(native, peers);
  const excludes = code('json', JSON.stringify({ expo: { install: { exclude: playground.expo.install.exclude } } }, null, 2));
  const blocks = {
    'README.md': { table },
    'packages/gamekit/README.md': {
      table,
      install: code('sh', `npm install rn-gamekit\n${renderInstall(native, required, 'npx')}`),
      optional: code('sh', optional.map((name) => renderInstall(native, [name], 'npx')).join('\n')),
      excludes,
    },
    'apps/docs/content/docs/introduction/supported-platforms.mdx': { table },
    'apps/docs/content/docs/getting-started/installation.mdx': {
      table,
      install: tabs(native, required),
      audio: tabs(native, ['react-native-audio-api', 'react-native-worklets', 'react-native-pulsar']),
      storage: code('sh', renderInstall(native, ['@react-native-async-storage/async-storage'], 'npx')),
      excludes,
    },
  };
  const changes = Object.entries(blocks).flatMap(([path, replacements]) => {
    const source = read(path);
    const updated = Object.entries(replacements).reduce(
      (text, [name, content]) => replaceBlock(text, name, content, path.endsWith('.mdx')), source);
    return source === updated ? [] : [{ path, updated }];
  });
  if (!check) for (const { path, updated } of changes) writeFileSync(resolve(root, path), updated);
  return changes.map(({ path }) => path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: pnpm deps:docs [--check]');
    const check = process.argv.includes('--check');
    const changes = syncDocuments(fileURLToPath(new URL('../', import.meta.url)), { check });
    if (check && changes.length) {
      console.error(`Dependency docs are stale: ${changes.join(', ')}. Run pnpm deps:docs.`);
      process.exitCode = 1;
    } else console.log(check ? 'Dependency docs match the catalog and peers.' : `Updated ${changes.length} dependency documents.`);
  } catch (error) {
    console.error(`Dependency docs: ${error.message}`);
    process.exitCode = 1;
  }
}
