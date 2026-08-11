# GameKit asset workflow (Task 7)

This addendum wires the pixel-art pipeline to the accepted React Native
GameKit asset API (T7.1–T7.8). Use the Sprite Field reference game
(`apps/playground/src/games/spriteFieldGame.ts`) as the canonical template.

## Prescribed file layout

```text
apps/playground/assets/            # lowercase, kebab-case PNG files
apps/playground/scripts/           # generators that produce the assets
apps/playground/src/games/<game>.ts        # manifest + definition + rules
apps/playground/src/games/<game>.test.ts   # deterministic headless rules
apps/playground/src/renderers/<Game>Renderer.tsx
apps/playground/src/screens/<Game>Content.tsx   # loading boundary + HUD
apps/playground/src/catalog/games.ts      # typed catalog id
apps/playground/src/shell/PlaygroundShell.tsx   # exhaustive content registry
```

## The API in one view

```ts
import { defineAssets, image, spriteSheet } from 'react-native-gamekit';

const assets = defineAssets({
  gameplay: {
    player: spriteSheet(require('./assets/player.png'), {
      frames: { 'idle-0': { x: 0, y: 0, width: 32, height: 32 } },
      animations: { idle: { frames: ['idle-0'], frameDurationMs: 140, mode: 'loop' } },
    }),
  },
});

// Loading (react entry):
const state = useGameAssets(assets, { groups: ['gameplay'] });
// state: { status: 'loading', progress } | { status: 'error', error, retry } | { status: 'ready', assets }

// Presentation (react entry):
<GameWorld2D viewport={viewport}>
  <GameSprite scene="play" commit={frame} alpha={alpha} source={assets.get(assets.gameplay.player)}
    anchor={{ x: 0.5, y: 1 }}
    select={({ previous, current, alpha: t }) => { 'worklet'; return { x: current.x, y: current.y, clip: current.clip, elapsedMs: current.elapsedMs }; }} />
  <SpriteBatch scene="play" commit={frame} alpha={alpha} source={...} capacity={64}
    select={({ current }) => current.enemies}
    write={(write, item, i) => { 'worklet'; write.set(i, item.frame, item.x, item.y, item.rotation, item.scale, item.visible); }} />
</GameWorld2D>
```

## Checklist (reject these)

- [ ] No per-frame React state: positions/frames live in the scene snapshot
      or UI-runtime shared values only.
- [ ] No wall-clock animation: `Date.now()`, timers, and per-frame setState
      are forbidden in animation sampling; use the fixed-step helpers
      (`startSpriteAnimation` / `advanceSpriteAnimation`).
- [ ] No unowned native handles: assets are borrowed from the ready lease;
      the renderer never disposes images.
- [ ] No untyped asset strings: lookups use the typed descriptor reference
      (`assets.get(manifest.group.name)`), never `'group/name'` strings.
- [ ] No remote URLs: sources are static `require(...)` module handles only.
- [ ] Sessions are created only after assets are ready and disposed once on
      close.
- [ ] Content roots are `pointerEvents="box-none"` so touches reach the
      pointer surface.

## Recipes

**One sprite** — see `sprites.mdx`. **One clip** — see `sprite-animation.mdx`.
**One batch** — see `sprite-batching.mdx`. The docs pages are compiled from
the same fixtures as the package tests.

## Diagnostics

- Missing asset: `ASSET_RESOLVE_FAILED` / `ASSET_DECODE_FAILED` with the
  field path; fix the module handle or the file.
- Bad frame rectangle: `ASSET_INVALID_FRAME_RECT` or
  `ASSET_FRAME_OUT_OF_BOUNDS`; fix the rectangle or the image.
- Disposed lease: `ASSET_STORE_DISPOSED`; never reuse a disposed owner.
- Full error table: `apps/docs/content/docs/reference/asset-errors.mdx`.
