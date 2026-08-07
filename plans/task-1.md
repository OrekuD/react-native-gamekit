# Task 1: Bootstrap the React Native GameKit monorepo

## Objective

Create a clean, reproducible monorepo containing:

- a publishable React Native GameKit TypeScript library;
- an Expo development-build playground for iOS, iPadOS, and Android;
- a Fumadocs documentation app;
- shared workspace commands, validation, and CI;
- one minimal `defineGame` compile/build smoke path proving that the playground can consume the local package.

This task establishes the development and release foundation. It does not implement the game runtime.

## Source material

- Product and architecture direction: [`../REACT_NATIVE_GAMEKIT_RESEARCH.md`](../REACT_NATIVE_GAMEKIT_RESEARCH.md)
- Monorepo reference: `../react-native-showcase`
- Preserve the initial functional API direction:

  ```ts
  const game = defineGame({
    viewport,
    assets,
    input,
    scenes,
    initialScene,
  })
  ```

- Do not introduce the React-blueprint or class-based API alternatives.

## Locked decisions

1. Use Node.js 22, pnpm 11, and Turborepo.
2. Use `apps/*` and `packages/*` workspace globs with one shared lockfile.
3. Keep pnpm settings in `pnpm-workspace.yaml` using camel-case keys. Use `.npmrc` only if registry authentication is later required.
4. Create one public package named `react-native-gamekit` for now. Do not split `core`, `react`, `skia`, or `input` into published packages during bootstrap.
5. Build the package with React Native Builder Bob, targeting ESM JavaScript and generated TypeScript declarations.
6. Use Expo Prebuild/Continuous Native Generation. Generated `apps/playground/ios` and `apps/playground/android` directories must remain untracked.
7. Expo Go is not a supported requirement. The playground uses local native development builds.
8. Use a simple `App.tsx` entry in the playground. Do not add Expo Router during bootstrap.
9. Set `ios.supportsTablet` to `true` and allow both portrait and landscape orientations.
10. Native singleton packages belong in the playground's `dependencies`, the library's `peerDependencies`, and the library's exact `devDependencies`. Do not put native singleton packages in the library's normal `dependencies`.
11. Task 1 does not publish to npm, create EAS projects, or add credentials.
12. Write the minimal library test before its implementation.

## Target structure

```text
react-native-gamekit/
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── docs/
│   └── playground/
├── packages/
│   └── gamekit/
│       ├── src/
│       │   ├── definition/
│       │   └── index.ts
│       ├── test/
│       ├── package.json
│       ├── tsconfig.json
│       └── tsconfig.build.json
├── plans/
│   └── task-1.md
├── .gitignore
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── turbo.json
```

Generated folders such as `.expo`, `.next`, `.source`, `.turbo`, `lib`, `dist`, `coverage`, `ios`, and `android` must not appear in the committed source tree unless a later decision explicitly changes the CNG policy.

## Execution order

Complete the following sections in order. Do not scaffold all three projects independently and reconcile them afterward; establish the root workspace first so every generator and install contributes to the same pnpm lockfile.

## 1. Preflight and repository foundation

- [x] Confirm the working directory is exactly `/Users/david/Desktop/Oreku/code/prep/projects/react-native-gamekit`.
- [x] Confirm `REACT_NATIVE_GAMEKIT_RESEARCH.md` is preserved.
- [x] Check whether the directory is already inside a Git worktree. Initialize a new Git repository only when it is not.
- [x] Record the installed Node and pnpm versions.
- [x] Require Node `>=22.13.0` and pin the selected pnpm 11 release through the root `packageManager` field.
- [x] Create a private root `package.json` with version `0.0.0`.
- [x] Create `pnpm-workspace.yaml` with `apps/*` and `packages/*`.
- [x] Enable `linkWorkspacePackages`, `preferWorkspacePackages`, and `sharedWorkspaceLockfile`.
- [x] Add a tooling-only pnpm catalog, initially for TypeScript. Keep Expo and React Native runtime versions app-local so Expo compatibility remains visible.
- [x] Do not copy dependency overrides or `allowBuilds` entries blindly from React Native Showcase. Review every requested install script and approve only packages actually required by this workspace.
- [x] Create a root `.gitignore` covering dependencies, caches, generated package output, Expo output, Fumadocs output, environment files, native credentials, and generated native projects.
- [x] Add a minimal root `README.md` describing the three workspace projects and the supported development-build workflow.
- [x] Add a root `AGENTS.md` containing the project invariants: no per-frame React state, generated native directories stay untracked, native dependency singleton policy, test-first changes, and the canonical workspace commands.

### Root scripts

Add these root scripts using pnpm filters and Turbo:

| Script | Responsibility |
| --- | --- |
| `dev` | Start persistent development tasks for docs, playground, and any library watcher. |
| `dev:docs` | Start only Fumadocs. |
| `dev:playground` | Start only Expo/Metro. |
| `ios` | Build and run the playground on iOS. |
| `android` | Build and run the playground on Android. |
| `expo:prebuild` | Generate native playground projects. |
| `expo:prebuild:clean` | Regenerate native playground projects from a clean state. |
| `build` | Build workspace packages and production-build the docs. |
| `lint` | Lint all participating workspaces. |
| `typecheck` | Type-check all participating workspaces. |
| `test` | Run all workspace tests. |
| `test:coverage` | Run tests with coverage where supported. |
| `check` | Run lint, typecheck, tests, and builds in that order. |

Do not place `ios`, `android`, or `expo:prebuild` inside cached Turbo tasks. They alter or compile native projects and must remain explicit root commands.

## 2. Configure Turborepo and shared TypeScript

- [x] Add Turborepo as a root development dependency.
- [x] Create `turbo.json` tasks for `build`, `dev`, `lint`, `typecheck`, `test`, and `test:coverage`.
- [x] Make `dev` persistent and uncached.
- [x] Cache only declared outputs such as `lib/**` and `.next/**`. Leave tasks without generated artifacts uncached by output.
- [x] Do not cache `.next/cache/**` as a build artifact.
- [x] Make build tasks depend on dependency builds.
- [x] Create a strict `tsconfig.base.json` for non-framework packages.
- [x] Allow Expo and Next.js to extend their framework-owned base configurations instead of forcing one incompatible root configuration onto every workspace.

## 3. Scaffold the GameKit library

Create `packages/gamekit` as the only publishable package.

- [x] Set its package name to `react-native-gamekit`, version to `0.0.0`, and license to MIT unless the project license changes before implementation.
- [x] Configure React Native Builder Bob in the existing package rather than generating a second repository or example app.
- [x] Set Bob's source directory to `src` and generated output to `lib`.
- [x] Generate ESM output and TypeScript declarations.
- [x] Configure `main`, `types`, and `exports` according to Bob's current ESM guidance.
- [x] Publish only intentional files: compiled output, source maps where useful, source needed for debugging, README, and license.
- [x] Add `build`, `clean`, `lint`, `typecheck`, `test`, `test:coverage`, `prepack`, and package-inspection scripts.
- [x] Keep `src/index.ts` as a barrel containing exports only.
- [x] Add no Swift, Kotlin, C++, Turbo Module, Nitro Module, or Expo Module implementation in Task 1.

### Minimal test-first package smoke

- [x] First, write a failing unit test and compile-time fixture for the bootstrap `defineGame` contract.
- [x] Add the smallest implementation needed to make it pass.
- [x] The bootstrap implementation may preserve and return the supplied definition; it must not start a scheduler, allocate a session, load assets, or pretend that runtime behavior exists.
- [x] Infer scene names so `initialScene` must be one of the keys in `scenes`.
- [x] Cover the initial viewport shape used in the research: logical size, scale policy, and overflow policy.
- [x] Export `defineGame` and its directly required public types from `src/index.ts`.
- [x] Add JSDoc to every exported declaration.
- [x] Keep this as the only gameplay-facing implementation in Task 1.

### Dependency policy

- [x] Add `react`, `react-native`, and `expo` as narrow peer dependencies and exact development dependencies matching the playground.
- [x] Add Skia, Gesture Handler, Reanimated, Worklets, and required Expo modules as native peer dependencies only when they are installed and validated in the playground.
- [x] Mirror those peers as exact library development dependencies so the package can type-check and test against the supported combination.
- [x] Keep ordinary, implementation-owned, pure JavaScript utilities in normal `dependencies` only when they are truly needed. Start with none.
- [x] Document that applications must contain one compatible copy of every native peer.
- [x] Do not add `peerDependenciesMeta.optional` merely to suppress warnings for dependencies required by the stable v1 path.

## 4. Scaffold the Expo playground

Create `apps/playground` using the current Expo TypeScript blank template, then adapt it to the workspace.

- [x] Name the workspace package `@react-native-gamekit/playground` and keep it private.
- [x] Use the current supported Expo SDK selected for the first compatibility line.
- [x] Retain a direct `App.tsx` and `index.ts` entry. Remove template navigation or example code not needed by the playground.
- [x] Add `react-native-gamekit` as `workspace:*`.
- [x] Install native GameKit peers directly in the playground using `expo install` so Expo chooses SDK-compatible versions.
- [x] Include React Native Skia, Gesture Handler, Reanimated/Worklets if required by their current compatibility contract, Expo Asset, Expo Audio, Expo Haptics, Safe Area Context, and `expo-dev-client`.
- [x] Align the library's peer and development dependency ranges with the versions resolved in the playground.
- [x] Do not manually customize Metro for normal workspace resolution. Add a Metro configuration only if a demonstrated asset extension or package-resolution requirement remains after using Expo's standard monorepo support.

### Playground app configuration

- [x] Use the name `React Native GameKit Playground` and a non-production playground slug.
- [x] Enable the New Architecture when it is not already the Expo default.
- [x] Set `ios.supportsTablet` to `true`.
- [x] Do not lock the whole app to portrait.
- [x] Add non-production iOS bundle and Android package identifiers without creating external credentials.
- [x] Use CNG-compatible app configuration and config plugins only where required.
- [x] Keep generated `ios` and `android` directories ignored.

### Playground bootstrap screen

- [x] Replace the template screen with a restrained status screen that shows the app name, current platform, current window size, and whether the local GameKit import loaded.
- [x] Instantiate the minimal `defineGame` configuration in a separate `src/games/bootstrapGame.ts` file.
- [x] Do not implement `GameView`, a game loop, Skia rendering, navigation, or a sample game yet.
- [x] Ensure resizing and rotation update the displayed window size so the playground already exposes tablet/window behavior during development.

### Playground commands

- [x] Add `dev`, `start`, `ios`, `android`, `expo:prebuild`, `expo:prebuild:clean`, `lint`, `typecheck`, `test`, and `build` scripts.
- [x] Make the initial `build` perform a deterministic Expo export suitable for CI without implying an app-store build.
- [x] Run a clean prebuild and confirm native autolinking discovers one copy of each native module.
- [x] Run Expo's dependency compatibility check.

## 5. Scaffold the Fumadocs app

Create `apps/docs` using the current Fumadocs Next.js template and align it with the React Native Showcase documentation structure.

- [x] Name the workspace package `@react-native-gamekit/docs` and keep it private.
- [x] Use Next.js, Fumadocs MDX, Tailwind, strict TypeScript, and ESM configuration generated by the current template.
- [x] Keep generated `.source` and `.next` files ignored.
- [x] Add `dev`, `build`, `start`, `lint`, and `typecheck` scripts.
- [x] Configure the Fumadocs loader and MDX components without importing React Native, Skia, or the native GameKit runtime into the Next.js server bundle.
- [x] Link documentation source examples to normal TypeScript files or compile them as fixtures; do not maintain unverified snippets that can silently drift.

### Initial documentation content

- [x] Create a landing page that states the product boundary: mobile/tablet, Expo/React Native, excellent 2D first, future-aware 3D seams.
- [x] Add `Getting Started / Installation` describing development builds and prebuild rather than Expo Go.
- [x] Add `Getting Started / Repository` describing the monorepo commands.
- [x] Add `Concepts / Game Definition` documenting the initial `defineGame` shape as provisional until reference games validate it.
- [x] Add `Compatibility` documenting the tested Expo, React Native, React, Skia, Gesture Handler, and Reanimated lines.
- [x] Add a prominent link to the research document for architectural background.
- [x] Do not document unimplemented runtime methods such as `start`, `pause`, `setScene`, or `dispose` as available yet.

## 6. Add workspace validation

- [x] Run lint independently in every workspace.
- [x] Run TypeScript checks independently in every workspace.
- [x] Run the library test suite and collect coverage.
- [x] Build the library through Bob.
- [x] Build the docs in production mode.
- [x] Run the playground's CI export.
- [x] Run `expo config --type public` for the playground.
- [x] Run Expo dependency validation.
- [x] Run Expo autolinking verification and fail on duplicated native modules.
- [x] Run a clean prebuild without committing its generated output.
- [x] Inspect the package tarball contents with a dry run or temporary pack destination.
- [x] Confirm the tarball contains compiled JavaScript, declarations, package metadata, README/license, and no tests, caches, native build products, documentation app, or playground.
- [x] Confirm a workspace install uses exactly one lockfile.

## 7. Add CI

Create `.github/workflows/ci.yml` modeled on React Native Showcase but scoped to this repository.

- [x] Trigger on pull requests and pushes to `main`.
- [x] Use read-only repository contents permission.
- [x] Cancel older runs for the same branch/ref.
- [x] Set a finite timeout.
- [x] Set up the pinned pnpm release and Node 22 with pnpm caching.
- [x] Install with `pnpm install --frozen-lockfile`.
- [x] Run lint, typecheck, tests, library build, docs build, playground CI export, Expo config validation, and package inspection.
- [x] Add clean prebuild/autolinking verification where it runs reliably without signing credentials.
- [x] Do not publish, submit, provision devices, create EAS projects, or require repository secrets in Task 1.

## 8. Final verification and handoff

- [x] Run `pnpm check` from the repository root.
- [x] Run `pnpm expo:prebuild:clean` and confirm both generated native projects are ignored by Git.
- [ ] Run the playground on at least one local simulator/emulator when the environment is available.
- [x] Confirm the playground imports `react-native-gamekit` through `workspace:*`, not a relative source path or Metro alias.
- [x] Confirm docs start and build without importing native runtime code.
- [x] Confirm package output can be packed successfully.
- [x] Review `git status` for caches, generated native projects, credentials, logs, and unrelated files.
- [x] Record the resolved compatibility versions in the root README and docs compatibility page.
- [x] Update this task with any deliberate deviations and their reasons.

## Required acceptance criteria

Task 1 is complete only when all of the following are true:

1. `pnpm install --frozen-lockfile` succeeds from a clean checkout after the lockfile exists.
2. `pnpm lint` succeeds.
3. `pnpm typecheck` succeeds.
4. `pnpm test` succeeds.
5. `pnpm build` succeeds.
6. The library emits ESM JavaScript and TypeScript declarations.
7. The package tarball contains only intended publishable files.
8. The playground consumes `react-native-gamekit` through the workspace protocol.
9. Expo dependency checks and native-module deduplication checks pass.
10. Clean Expo prebuild succeeds and generated native projects remain untracked.
11. `ios.supportsTablet` is enabled and the app is not globally portrait-locked.
12. Fumadocs starts locally and produces a production build.
13. CI performs the same non-device validation from a clean install.
14. No credentials, tokens, signing files, generated build output, or dependency caches are committed.

## Explicitly out of scope

Do not add any of the following in Task 1:

- `GameSession` or scheduler implementation;
- `GameView`;
- Skia drawing primitives or render snapshots;
- Gesture/action processing implementation;
- asset loading, audio buses, or haptic services;
- physics or collision;
- scene lifecycle implementation;
- Breakout or another reference game;
- the R3F/Expo GL experiment;
- custom Swift, Kotlin, C++, Expo Module, Turbo Module, or Nitro Module code;
- `gamekit setup`, `doctor`, `validate`, `inspect`, or `benchmark` implementations;
- public npm publishing or EAS project creation;
- agent skills beyond the root project instructions.

These belong in later tasks after the workspace foundation is verified.

## Handoff to Task 2

Task 2 should implement the first vertical runtime slice: a fixed-step headless `GameSession`, fake-clock tests, one scene, one input action, a minimal `GameView`, and a single Skia-rendered object in the playground. It should build on the initial functional `defineGame` interface without revisiting the rejected React-blueprint or class-based designs.

## Deviations recorded during implementation

Deliberate deviations from this task as written, with reasons.

1. **Library test runner: `tsx` loader instead of raw `node --test` type stripping.** Node 22.22 does not resolve extensionless relative imports across modules, so a test importing `src/index.ts` (which re-exports through extensionless specifiers) fails under `node --experimental-strip-types --test`. The showcase's pattern only tests leaf modules. Resolution: keep `node:test` (no test framework) and load TS through `node --import tsx --test`. `tsx` is the only added dev dependency; `test:coverage` uses `--experimental-test-coverage` (verified 100% line coverage on `.ts` sources). `esbuild` (tsx's engine) was added to `allowBuilds`.
2. **TypeScript 6.0.3 compatibility line.** The catalog pins `~6.0.3` (current stable line; 7.0 is the new native compiler). TS 6 enforces an explicit `rootDir` (TS5011) for Bob's `typescript` target, so `tsconfig.build.json` sets `"rootDir": "."`, which keeps the documented `lib/typescript/src/*.d.ts` output layout. The `typescript` target is configured with `project: tsconfig.build.json`.
3. **Curated `allowBuilds`.** Only four packages are approved: `esbuild` (tsx), `@shopify/react-native-skia` (postinstall downloads prebuilt native binaries), `unrs-resolver` (validates its native binding; used by the ESLint toolchain), and `sharp` (Next.js production image optimization).
4. **Worklets aligned with Expo's compatibility map.** Expo SDK 57 resolves `react-native-worklets@0.10.1`, while `react-native-reanimated@4.5.1` accepts `0.10.x`. Both the playground and the library's exact compatibility line therefore use `0.10.1`, allowing `expo install --check` to validate Worklets normally. Note: `react-native-worklets/plugin` is a **Babel plugin**, not an Expo config plugin — the plugin list in `app.json` must not contain it; `babel-preset-expo` applies it automatically.
5. **Config plugins only where they exist.** `expo-dev-client`, `expo-asset`, and `expo-audio` are listed in `app.json` plugins. `expo-haptics` has no `app.plugin.*` file and is intentionally not listed.
6. **CI prebuild uses `expo prebuild --clean --no-install`.** CocoaPods and Gradle cannot run on the Linux runner; the step verifies CNG generation and then runs the autolinking CLI's supported `verify --verbose` command, which exits nonzero for duplicated native modules.
7. **Template `AGENTS.md`/`CLAUDE.md` removed from `apps/playground`.** The SDK 57 blank template ships generic agent instructions; the root `AGENTS.md` is canonical for this repository.
8. **Docs modeled on the current Fumadocs 16 setup** used by the reference repository (`fumadocs-core`/`fumadocs-mdx` 16.x/15.x, `fumadocs-ui` aliased to `@fumadocs/base-ui@16.14.0`, Next 16.2.12, Tailwind v4). It uses the classic `DocsLayout`/`HomeLayout` (not the glass layout) and a system font stack instead of `next/font/google` to avoid a network dependency in CI. `eslint-config-expo`'s flat config is imported as `eslint-config-expo/flat.js` (explicit extension required by Node ESM resolution).
9. **`del-cli` pinned to `^7.0.0`** — `^8.0.0` does not exist on the registry.
10. **New Architecture is the Expo SDK 57 default** (RN 0.86 ships New Arch only), so no `newArchEnabled` flag was added; this satisfies the "enable when not already default" requirement by construction.
11. **Device verification completed with Task 2.** The iOS development build launched on an iPhone 17 Pro Max simulator, loaded a fresh Metro bundle, and rendered the Skia playground without native or JavaScript errors. A prior HMR replacement error was isolated to a stale Metro process started with `CI=true`; the standard interactive Expo server resolved and bundled the same dependency graph successfully without a custom Metro configuration.
12. **Security floors for transitive build tooling.** The workspace overrides `postcss@8.5.25`, `sharp@0.35.3`, and `uuid@11.1.1` to patched versions after the initial dependency audit reported known advisories in the docs/build dependency graph. The frozen install, peer check, complete build suite, and `pnpm audit` must all pass with these overrides.
