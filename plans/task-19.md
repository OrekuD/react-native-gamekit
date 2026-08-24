# Task 19: Normalize public package entry points

## Status

**Planned.** This task is additive and may be implemented before Tasks 17 and
18 so their new subpaths follow the same tested package policy.

Task 19 is complete when the existing headless engine systems have intentional
subpath exports, current root imports remain compatible, and the published
tarball proves that every documented entry point resolves independently.

## Objective

Make the public import surface reflect Gamekit's engine-system boundaries while
continuing to publish one `rn-gamekit` npm package.

Preferred imports after this task:

```ts
import { collideCircleAabb2D } from 'rn-gamekit/collision2d';
import { createCamera2D } from 'rn-gamekit/camera2d';
import type { Aabb2D } from 'rn-gamekit/geometry';
import { defineGameEvents, gameEvent } from 'rn-gamekit/events';
import { defineAssets, image, spriteSheet } from 'rn-gamekit/assets';
import {
  sampleSpriteClipFrame,
  startSpriteAnimation,
} from 'rn-gamekit/sprites';
import {
  GameView,
  GameWorld2D,
  Sprite,
} from 'rn-gamekit/react';
```

Existing imports from `rn-gamekit` must continue to work in this task. The new
subpaths are preferred organization boundaries, not separate packages and not
an excuse for an immediate breaking change.

## Why this task exists

The current package already exposes these dedicated subpaths:

```text
rn-gamekit/react
rn-gamekit/audio
rn-gamekit/haptics
rn-gamekit/particles
rn-gamekit/tilemap
rn-gamekit/testing
```

Tasks 17 and 18 also plan `rn-gamekit/storage` and
`rn-gamekit/physics2d`. Earlier systems are currently exported only through the
root entry point, which makes the package organization inconsistent and makes
headless import boundaries harder to explain and verify.

This task normalizes those boundaries without moving implementation code or
changing runtime behavior.

## Package model

There is one npm package:

```text
rn-gamekit
```

Paths such as `rn-gamekit/collision2d` are package export subpaths. They are not
separately versioned, installed, or published packages.

All subpaths:

- use the same `rn-gamekit` version;
- ship in the same npm tarball;
- share one peer-dependency policy;
- are governed by the package's `exports` map;
- must resolve to the same underlying implementations as compatibility exports
  from the root.

## V1 entry-point policy

### New headless system subpaths

| Entry point | Public responsibility | Must not load |
| --- | --- | --- |
| `rn-gamekit/geometry` | Points, vectors, AABBs, circles, segments, immutable geometry helpers, and geometry errors | React, React Native, Skia, Reanimated, Worklets, or native peers |
| `rn-gamekit/collision2d` | Collision predicates, manifolds, sweeps, filters, colliders, spatial hash, and renderer-neutral debug projections | React, Skia drawing nodes, physics backends, or native peers |
| `rn-gamekit/camera2d` | Pure camera values, transforms, following, clamping, shake, interpolation, and visibility queries | React hooks/components, Skia, Reanimated, or native peers |
| `rn-gamekit/events` | Typed event definitions, envelopes, payload limits, seeding, and public event errors | Effect consumers, audio, haptics, particles, React, or native peers |
| `rn-gamekit/assets` | Asset manifests, image/spritesheet descriptors, public asset types, and manifest errors | React hooks, Skia decoding, Expo Asset acquisition, or native resources |
| `rn-gamekit/sprites` | Deterministic sprite-clip sampling and immutable playback-state helpers | React components, Skia Atlas nodes, asset loading, or native peers |

### Existing entry points

- `rn-gamekit` remains the foundational and compatibility entry point.
- `rn-gamekit/react` remains the home of React hooks, GameView, pointer
  integration, Skia-backed rendering, camera presentation components, asset
  acquisition hooks, sprite rendering, particle rendering, and tilemap
  rendering.
- `rn-gamekit/audio`, `rn-gamekit/haptics`, `rn-gamekit/particles`, and
  `rn-gamekit/tilemap` retain their current ownership.
- `rn-gamekit/testing` remains test-only public support and must not leak into
  production entry points.
- Future `rn-gamekit/storage` and `rn-gamekit/physics2d` entries must follow the
  same isolation and packaging rules.

### Intentionally not added in v1

Do not create a subpath for every source directory.

- Do not add `rn-gamekit/core` as a second catch-all entry point.
- Keep session creation, scenes, game definitions, input contracts, and
  viewport contracts at the root for v1.
- Do not add `rn-gamekit/rendering`; React/Skia presentation remains in
  `rn-gamekit/react`.
- Do not add nested system paths such as
  `rn-gamekit/collision2d/debug` in this task.
- Do not expose private validation, storage, queue, registry, or runtime bridge
  modules merely because a source file exists.

The package should be understandable without becoming fragmented.

## Compatibility contract

Task 19 must not remove existing root exports. The package has already been
published, so an import such as this remains valid:

```ts
import {
  collideCircleAabb2D,
  createCamera2D,
  defineAssets,
} from 'rn-gamekit';
```

The following rules are required:

- Root compatibility exports and subpath exports reference the same underlying
  symbol. Do not wrap functions or recreate classes.
- Error constructors must preserve identity across entry points so
  `instanceof GeometryError`, `instanceof GameEventError`, and similar checks
  behave consistently.
- Do not duplicate module state, caches, counters, registries, or constants.
- Do not mark root symbols deprecated until there is an approved migration and
  release policy. Documentation may call subpath imports preferred.
- Do not announce a future root removal date in this task.
- Preserve type names and runtime behavior. This task is packaging and public
  API organization only.

## Source-boundary design

Add one top-level source barrel for each new exported subpath:

```text
packages/gamekit/src/geometry.ts
packages/gamekit/src/collision2d.ts
packages/gamekit/src/camera2d.ts
packages/gamekit/src/events.ts
packages/gamekit/src/assets.ts
packages/gamekit/src/sprites.ts
```

Each barrel should re-export the existing public implementation from its
feature directory. It should contain no runtime setup, mutable state, adapter
resolution, or side effects.

Use explicit public exports where a directory contains internal helpers. In
particular:

- `events` should expose definitions, types, errors, payload limits, and
  seeding, but not turn internal validation helpers into public API by accident.
- `assets` should expose manifest definitions, public descriptor/loaded-value
  types, and `GameAssetError`, but not React asset stores or Skia decoding.
- `sprites` should expose clip sampling and playback-state helpers only.
  `Sprite`, `GameSprite`, and `SpriteBatch` remain in `rn-gamekit/react`.

Internal Gamekit source files should continue using relative imports. Do not
self-import through `rn-gamekit/...`; doing so can introduce cycles, confuse
Builder Bob, and create duplicate module identity under Metro.

## Export-map contract

Add every new subpath to `packages/gamekit/package.json` using the existing
condition order and output conventions:

```json
"./collision2d": {
  "react-native": "./src/collision2d.ts",
  "source": "./src/collision2d.ts",
  "types": "./lib/typescript/src/collision2d.d.ts",
  "default": "./lib/module/collision2d.js"
}
```

Apply the same shape to `geometry`, `camera2d`, `events`, `assets`, and
`sprites`.

Do not add wildcard exports. An explicit map prevents private source paths from
becoming accidental public API.

## Implementation tasks

### T19.0 — Freeze the public inventory

- [ ] Record every runtime and type export currently owned by geometry,
      Collision2D, Camera2D, events, assets, and headless sprite animation.
- [ ] Classify each symbol as public, React/presentation-only, or internal.
- [ ] Resolve duplicate names and ambiguous ownership before adding barrels.
- [ ] Add compile-only fixtures showing the intended imports from all six new
      subpaths.
- [ ] Add negative type fixtures proving React/Skia presentation primitives do
      not leak through headless subpaths.
- [ ] Freeze the decision that session, scene, definition, input, and viewport
      contracts remain root-owned in v1.

Required approach:

1. Derive the inventory from the current public `src/index.ts`, feature index
   files, generated declarations, and real docs/examples.
2. Treat existing root exports as compatibility requirements.
3. Do not export a helper solely to make a test convenient.
4. Review names from the consumer's perspective, including type-only imports.

### T19.1 — Add the six headless entry barrels

- [ ] Add `geometry.ts`, `collision2d.ts`, `camera2d.ts`, `events.ts`,
      `assets.ts`, and `sprites.ts` at the source root.
- [ ] Re-export existing implementations without wrappers or copied logic.
- [ ] Keep barrels declarative and side-effect-free.
- [ ] Prevent internal validation and runtime bridge helpers from leaking.
- [ ] Add source-boundary tests for each barrel.

Required approach:

Use the feature's existing index only when that index already represents the
desired public API. Otherwise list explicit exports in the new barrel. Do not
move implementations as part of this task unless a move is strictly required
to remove an import cycle and is covered by a focused test.

### T19.2 — Update the package export map and build outputs

- [ ] Add explicit `react-native`, `source`, `types`, and `default` conditions
      for all six subpaths.
- [ ] Confirm Builder Bob emits the matching ESM modules and declarations.
- [ ] Verify type-only and runtime imports resolve from the built package.
- [ ] Verify no export points directly at an unshipped or private path.
- [ ] Keep `./package.json` and every existing subpath unchanged.

Required approach:

Test the built package rather than trusting source resolution in the monorepo.
Inspect `lib/module`, `lib/typescript`, and the dry-run npm file list. A source
fixture passing through workspace aliases is not sufficient evidence.

### T19.3 — Preserve root compatibility and module identity

- [ ] Keep all currently published root exports available.
- [ ] Prove representative root and subpath runtime exports are strict-equal.
- [ ] Prove public error constructors preserve `instanceof` across import
      paths.
- [ ] Prove no duplicate mutable module state is created.
- [ ] Add an export-name snapshot or equivalent inventory test so accidental
      additions and removals are reviewed intentionally.

Required approach:

The root should re-export the same feature modules used by subpath barrels. Do
not implement compatibility using proxy functions, subclasses, duplicate
constants, or copied objects. If an export-name snapshot changes, review and
explain the API change instead of blindly updating it.

### T19.4 — Enforce headless and optional-system isolation

- [ ] Prove each new headless subpath imports without React, React Native,
      Skia, Reanimated, Worklets, Expo Asset, audio, haptics, or future optional
      backends being installed or initialized.
- [ ] Prove importing `rn-gamekit` does not initialize optional audio, haptics,
      storage, or Physics2D backends.
- [ ] Detect cross-system cycles introduced by the new barrels.
- [ ] Confirm entry imports allocate no sessions, renderers, asset stores,
      audio contexts, particle systems, or tile indexes.
- [ ] Keep test-only instrumentation out of production subpaths.

Required approach:

Use an isolated package-import harness or built-module import-graph check. Avoid
brittle assertions tied only to local `require.cache` behavior. Test both the
happy import and the absence of forbidden native/runtime dependencies.

### T19.5 — Migrate consumer-facing imports

- [ ] Update package compile fixtures to use the preferred system subpaths.
- [ ] Update playground imports where the code is demonstrating a specific
      public engine system.
- [ ] Update documentation examples for Collision2D, Camera2D, events, assets,
      and sprite animation.
- [ ] Keep React components and hooks imported from `rn-gamekit/react`.
- [ ] Do not rewrite internal package source imports to self-referential
      package imports.
- [ ] Do not perform unrelated formatting or refactors while changing imports.

Required approach:

Migrate public examples and package-consumer fixtures first. Root imports can
remain in application code when they intentionally demonstrate the foundational
API. The goal is clear ownership, not a mechanical ban on the root entry point.

### T19.6 — Document the package API model

- [ ] Add or update one documentation page explaining that subpaths belong to
      one npm package and require one installation.
- [ ] Add a concise entry-point matrix to the package README.
- [ ] Update affected engine-system pages with preferred imports.
- [ ] Add an additive migration note: old root imports remain valid.
- [ ] Update the changelog with all six new public subpaths.
- [ ] Compile-check every documented import example.
- [ ] Do not rewrite the historical completion records in Tasks 11–13.

The documentation must explicitly distinguish:

- headless simulation/math APIs from React/Skia presentation;
- public subpaths from separate npm packages;
- required package peers from optional native peers;
- preferred imports from compatibility imports.

### T19.7 — Package and release verification

- [ ] Run the focused API fixture, identity, isolation, and export-map tests.
- [ ] Run package typecheck and build.
- [ ] Run `pnpm pack --dry-run` and inspect all new modules and declarations.
- [ ] Resolve all six subpaths through the packed artifact or an equivalent
      installed-tarball fixture.
- [ ] Run the docs build after import migrations.
- [ ] Run the repository's normal final gate once implementation is complete.
- [ ] Record the implementation commit and any intentionally deferred work.

No simulator or physical-device matrix is required for Task 19 unless an
entry-point change exposes an actual Metro-only resolution failure. This task
must not publish to npm. Version bumping and `npm publish` require a separate,
explicit release action.

## Required test matrix

| Area | Required evidence |
| --- | --- |
| Public types | Each new subpath has a compile fixture with representative values and types |
| Negative ownership | React/Skia primitives cannot be imported from headless subpaths |
| Runtime identity | Root and subpath functions, constants, and error classes are identical |
| Headless isolation | New subpaths import without React Native or native peers |
| Optional isolation | Root and unrelated subpaths do not initialize optional systems |
| Build output | ESM and declaration files exist for every export-map target |
| Packed package | Dry-run or installed tarball resolves every documented path |
| Consumer examples | README and docs imports compile against the built public API |

## V1 definition of done

- [ ] `geometry`, `collision2d`, `camera2d`, `events`, `assets`, and `sprites`
      are explicit subpaths of the single `rn-gamekit` package.
- [ ] Existing root imports continue to work without behavior or identity
      changes.
- [ ] Headless subpaths do not pull React/Skia/native integrations into their
      import graph.
- [ ] Presentation primitives remain in `rn-gamekit/react`.
- [ ] Internal package code continues to use safe relative imports.
- [ ] Source, built JavaScript, declarations, and the packed artifact agree.
- [ ] Documentation consistently teaches the preferred import boundaries.
- [ ] No separate npm packages are created.
- [ ] No npm publication occurs as part of implementation.
- [ ] Focused and final automated gates pass.

## Future expansion backlog

These items are intentionally preserved but do not block Task 19.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| ENTRY-F1 | Reduce selected root compatibility exports | A versioned breaking-change policy and migration evidence are approved |
| ENTRY-F2 | More granular nested subpaths | A system becomes large enough that real consumers need independent loading or ownership |
| ENTRY-F3 | Dedicated input or viewport subpaths | Those contracts grow beyond their foundational root role |
| ENTRY-F4 | Automated API report generation | Manual export inventory becomes error-prone across several releases |
| ENTRY-F5 | Conditional web or native implementations | A supported platform requires genuinely different runtime modules |
| ENTRY-F6 | CommonJS output | A supported consumer cannot use the current ESM package |

## Implementation order

Implement Task 19 in this order:

1. T19.0 freeze the public inventory and ownership rules.
2. T19.1 add side-effect-free source barrels.
3. T19.2 wire and inspect the package export map.
4. T19.3 prove compatibility and symbol identity.
5. T19.4 prove headless and optional-system isolation.
6. T19.5 migrate consumer-facing imports only.
7. T19.6 update documentation and changelog.
8. T19.7 verify the built and packed package.

Do not remove root exports, create separate npm packages, or turn this into an
implementation refactor. The value of Task 19 is a clear, stable, and tested
public package surface.
