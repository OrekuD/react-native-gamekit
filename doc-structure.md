# Docs structure — React Native Gamekit

The target information architecture for the docs site (`apps/docs`), reviewed
and approved page by page. Each page is built one at a time; nothing here is
final until the page exists and is approved.

## Naming

- Brand: **React Native Gamekit** (shorthand: **Gamekit**) — never "GameKit".
- The npm package is `rn-gamekit`; the name appears in code only.
- Site title, metadata, and every page use the brand form.

## Target structure

Diátaxis model: four ways in, never forced in sequence — a beginner enters
through Getting Started, an engine-savvy reader through Core Concepts, a
builder through Guides, an expert straight to the API.

```
Docs
├── Introduction
│   ├── What is react native gamekit?   ✅
│   ├── Why react native gamekit?       ✅
│   ├── Requirements                    🆕  (pending)
│   ├── Supported platforms             ✅  ← compatibility.mdx
│   └── Roadmap                         🆕  (physics, camera, audio, particles,
│                                            storage, ECS, keyboard/gamepad,
│                                            tilemaps, TypeDoc pipeline)
│
├── Getting Started
│   ├── Installation                    ✅ rewritten (persistent PM tabs)
│   ├── Create your first game          ✅ rewritten (game-oriented tutorial)
│   ├── Project structure               🆕  consumer-facing
│   └── Next steps                      🆕
│
├── Core Concepts                       ← mental model (what/when/why)
│   ├── Game                            📦 game-definition.mdx
│   ├── Scene                           📦 scenes-and-transitions.mdx
│   ├── Scene state                     🆕  honest stand-in for "entities":
│   │                                       no ECS — state lives in scenes
│   ├── Game loop & time                🆕  fixed step, no delta time
│   ├── Coordinates & viewport          📦 viewport.mdx
│   └── Lifecycle                       🆕  session lifecycle
│
├── Engine Systems                      ← "what can Gamekit do"
│   ├── Rendering                       📦 renderer-guide.mdx
│   ├── Sprites                         📦 sprites.mdx + sprite-batching.mdx
│   ├── Animation                       📦 sprite-animation.mdx
│   ├── Input                           📦 pointer-input.mdx + input-guide.mdx
│   └── Assets                          📦 assets.mdx
│
├── React                               ← the differentiator; explicit boundary
│   ├── How Gamekit uses React          🆕  (does the loop re-render React? no)
│   ├── Components                      🆕  GameView, GamePointerInput, Sprite…
│   ├── Hooks                           🆕  useGameAssets
│   ├── State & re-rendering            🆕  where state lives, HUD selectors
│   └── Performance                     🆕  interpolation, batching, threads
│
├── Guides                              ← problems, not APIs
│   ├── Move a paddle with touch        🆕
│   ├── Detect collisions (no physics)  🆕
│   ├── Animate a sprite                🆕
│   ├── Pause a game                    ✅
│   ├── Transition between scenes       🆕
│   ├── Build a HUD that doesn't re-render  🆕
│   ├── Draw hundreds of sprites        🆕
│   ├── Load assets (boot → gameplay)   🆕
│   └── Test your game headlessly       🆕
│
├── Examples                            ← playable, source-linked
│   ├── Brick Breaker                   📦 reference/brick-breaker.mdx
│   ├── Sprite Field                    🆕
│   └── First runtime slice             🆕
│
├── API Reference                       ← boring, predictable, template-consistent
│   ├── Components / Hooks / Functions / Types   🆕 manual now, TypeDoc later
│   └── Asset errors                    📦 reference/asset-errors.mdx
│
├── Advanced
│   ├── Engine architecture             🆕
│   ├── Performance model               📦 concepts/performance-model.mdx
│   ├── Profiling                       📦 profiling.mdx + results.mdx
│   ├── Custom renderers                🆕
│   └── Contributing                    📦 getting-started/repository.mdx
│
├── Troubleshooting                     🆕
└── Changelog                           🆕  links to packages/gamekit/CHANGELOG.md
```

Legend: ✅ rewritten · 📦 exists, to be rewritten in place · 🆕 new page.
No roadmap stubs in the nav — the Roadmap page carries the future.

## Current → new mapping

| Current file | New home |
| --- | --- |
| `getting-started/installation.mdx` | Getting Started → Installation (✅) |
| `getting-started/create-your-first-game.mdx` | Getting Started → Create your first game (✅) |
| `getting-started/create-your-first-sprite-game.mdx` | **Archive** (not in new structure; material feeds Guides → Animate a sprite / Draw hundreds of sprites) |
| `getting-started/repository.mdx` | Advanced → Contributing |
| `concepts/game-definition.mdx` | Core Concepts → Game |
| `concepts/scenes-and-transitions.mdx` | Core Concepts → Scene |
| `concepts/viewport.mdx` | Core Concepts → Coordinates & viewport |
| `concepts/pointer-input.mdx` | Engine Systems → Input |
| `concepts/input-guide.mdx` | Engine Systems → Input (merged) |
| `concepts/sprites.mdx` | Engine Systems → Sprites |
| `concepts/sprite-batching.mdx` | Engine Systems → Sprites (merged) |
| `concepts/sprite-animation.mdx` | Engine Systems → Animation |
| `concepts/assets.mdx` | Engine Systems → Assets |
| `concepts/renderer-guide.mdx` | Engine Systems → Rendering |
| `concepts/performance-model.mdx` | Advanced → Performance model |
| `concepts/profiling.mdx` | Advanced → Profiling |
| `reference/brick-breaker.mdx` | Examples → Brick Breaker |
| `reference/results.mdx` | Advanced → Profiling (performance results) |
| `reference/asset-errors.mdx` | API Reference → Asset errors |
| `compatibility.mdx` | Introduction → Supported platforms (✅, moved to `introduction/supported-platforms.mdx`) |
| `index.mdx` | Site home (stays) |

## Archive

Pages that have no home in the new structure move to `apps/docs/archive/`
(outside `content/docs`, so they never enter the nav tree) instead of being
deleted.

- `getting-started/create-your-first-sprite-game.mdx` → `archive/create-your-first-sprite-game.mdx`

## Locked conventions

- **Persistent package-manager tabs**: install commands use
  `<Tabs items={['npm','yarn','pnpm','bun']} groupId="package-manager" persist>`.
- **No body H1**: the frontmatter title + description render at the top; pages
  must not repeat the title as `# H1`.
- **Page actions**: `MarkdownCopyButton` + `ViewOptionsPopover` in the
  `prism-page-actions` block at the top of every page (copy markdown, view as
  markdown, open in GitHub).
- **Voice**: warm, casual, a fellow game dev talking to another. Humanizer
  pass on every page; docs-writer rules (you-voice, present tense, serial
  comma, relative links, callouts, BLUF, imperative numbered steps).
- **Truthfulness**: every code sample is verified — docs examples live
  in-tree (`apps/playground/src/docs-examples/`) with headless behavior tests.
- **Before each new page**: re-read the relevant source code fresh; never
  write from memory.
- **One page at a time**: build → present → approval → next.

## Build order

1. Getting Started: Installation ✅ → Create your first game ✅ → Project
   structure → Next steps
2. Introduction (What / Why / Requirements / Platforms / Roadmap)
3. Core Concepts
4. React
5. Engine Systems
6. Guides
7. Examples
8. API Reference
9. Advanced
10. Troubleshooting + Changelog
