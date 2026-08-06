# React Native GameKit

A React Native game toolkit for mobile and tablet, built on Expo. This repository is a pnpm + Turborepo monorepo containing three projects:

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/gamekit` | `react-native-gamekit` | The publishable TypeScript library. Bootstrap stage: the `defineGame` definition contract only. |
| `apps/playground` | `@react-native-gamekit/playground` | Expo development-build playground for iOS, iPadOS, and Android. |
| `apps/docs` | `@react-native-gamekit/docs` | Fumadocs (Next.js) documentation site. |

Product and architecture research lives in [`REACT_NATIVE_GAMEKIT_RESEARCH.md`](./REACT_NATIVE_GAMEKIT_RESEARCH.md).

## Requirements

- Node.js `>=22.13.0`
- pnpm 11 (pinned via `packageManager` in the root `package.json`)

## Getting started

```sh
pnpm install
```

### Development builds (not Expo Go)

The playground targets local native development builds. Expo Go is not a supported requirement.

```sh
# generate native projects once (continuous native generation)
pnpm expo:prebuild

# run on a simulator/emulator
pnpm ios
pnpm android
```

Generated `apps/playground/ios` and `apps/playground/android` directories are untracked. Regenerate them from scratch with `pnpm expo:prebuild:clean` and review them only when CNG changes are intentional.

### Docs

```sh
pnpm dev:docs   # http://localhost:3000
pnpm build:docs
```

## Workspace commands

Run these from the repository root. They use Turborepo filters to cover all participating workspaces.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start persistent development tasks (docs + playground). |
| `pnpm dev:docs` | Start only Fumadocs. |
| `pnpm dev:playground` | Start only Expo/Metro. |
| `pnpm ios` | Build and run the playground on iOS. |
| `pnpm android` | Build and run the playground on Android. |
| `pnpm expo:prebuild` | Generate native playground projects. |
| `pnpm expo:prebuild:clean` | Regenerate native playground projects from a clean state. |
| `pnpm build` | Build workspace packages and production-build the docs. |
| `pnpm lint` | Lint all participating workspaces. |
| `pnpm typecheck` | Type-check all participating workspaces. |
| `pnpm test` | Run all workspace tests. |
| `pnpm test:coverage` | Run tests with coverage where supported. |
| `pnpm check` | Run lint, typecheck, tests, and builds in that order. |

`ios`, `android`, and `expo:prebuild*` alter or compile native projects and are intentionally not cached by Turborepo.

## Compatibility

The first supported line (validated in the playground):

| Dependency | Version |
| --- | --- |
| Expo | SDK 57 (`~57.0.10`) |
| React Native | `0.86.2` |
| React | `19.2.3` |
| React Native Skia | `2.6.2` |
| React Native Gesture Handler | `~2.32.0` |
| React Native Reanimated | `4.5.1` |
| React Native Worklets | `0.10.1` |
| React Native Safe Area Context | `~5.7.0` |
| Expo Asset | `~57.0.8` |
| Expo Audio | `~57.0.3` |
| Expo Haptics | `~57.0.1` |

See `apps/docs/content/docs/compatibility.mdx` for the documented compatibility page.
