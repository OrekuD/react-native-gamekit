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

## Session ownership (Task 9 — agents writing game screens)

Pick exactly one owner per call site:

- **Conventional mounted screen**: `useGameSession(definition)` from
  `rn-gamekit/react`. The hook creates the session, disposes it exactly once
  on replacement or unmount, and is Strict Mode safe. It returns `undefined`
  only until a session is committed; render a deliberate fallback for that
  frame. Never call `session.dispose()` on a hook-owned session.
- **Headless scripts, tests, non-React owners**: `createGameSession()` (or
  `createGameSessionWithDriver()` for deterministic frames) with an explicit
  `try/finally` dispose.
- **Persistent surfaces, session swapping, asset-readiness orchestration**:
  explicit controller ownership (the playground shell's `SurfaceController`
  is the reference model). Do not migrate these to the hook.

`GameView` always borrows: it starts a session while mounted, pauses it on
unmount and app backgrounding, and never terminally disposes it.

Definitions normally live at module scope. Asset-backed games mount the
session-owning child only after `useGameAssets()` reports `ready`.

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
- [ ] No hook-plus-manual ownership: never combine `useGameSession` with a
      manual `session.dispose()`; the hook owns terminal disposal.
- [ ] No per-render definitions: `defineGame()` belongs at module scope,
      never inside a component render.
- [ ] No delayed disposal: no timers, animation frames, or deferred calls to
      guess whether an unmount is real; dispose in the effect cleanup.
- [ ] Sessions are created only after assets are ready and disposed once on
      close.

## Surface ownership contract (Task 8 — agents adding games)

The playground shell owns every session through one `SurfaceController`
(`apps/playground/src/shell/surfaceController.ts`); content, `GameView`, and
`GamePointerInput` only borrow the published slot:

- Navigation creates a **unique request id** and a **fresh binding
  generation** every time, even for the same catalog id. Never key anything
  by `gameId` or `String(game)`.
- All consumers bind from the one immutable slot (`surfaceSlot.ts`):
  `game`, `renderer`, `content`, `assets`, and the pointer all come from the
  same published value. The `presentationKey` and pointer key are the slot
  generation.
- A session superseded by a new binding is **retired, not disposed**: it
  stays in the slot's `retiring` list until the replacement generation is
  acknowledged (the surface's post-commit effect), then it is disposed
  exactly once. Never dispose a session from content or a child cleanup.
- Closing publishes the neutral Home binding first; the closed game is
  disposed only after the neutral binding commits.
- The Sprite Field asset controller is keyed by the request id; late
  readiness from a superseded request is ignored and its lease released.
- The header/back control of a game screen must be a separate layout region
  from the gameplay stage; a full-stage start surface must be absolutely
  filled inside the stage only, never the whole screen.
- [ ] Content roots are `pointerEvents="box-none"` so touches reach the
      pointer surface.

## Recipes

**One sprite** — see `sprites.mdx`. **One clip** — see `sprite-animation.mdx`.
**One batch** — see `sprite-batching.mdx`. The docs pages are compiled from
the same fixtures as the package tests.

## Recipes

React screen with a hook-owned session:

```tsx
function GameScreen() {
  const session = useGameSession(myGame);

  if (session === undefined) {
    return null;
  }

  return (
    <GameView game={session} renderer={MyRenderer}>
      <GamePointerInput game={session} action="primary" />
    </GameView>
  );
}
```

Headless test with an imperative owner:

```ts
const driver = new ManualFrameDriver();
const session = createGameSessionWithDriver(myGame, { frameDriver: driver });
try {
  session.start();
  // drive frames and assert
} finally {
  session.dispose();
}
```

## Pause and resume (Task 10 — agents adding pause UI)

- Pause with `session.pause()`, resume with `session.start()` — there is no
  `play()` or `resume()` alias, and no pause scene.
- Derive pause UI from `useGameSessionStatus(session)`. Reject any second
  `isPaused` React state that could drift from the session.
- A pause overlay is React UI above the frozen frame: it issues commands,
  captures its own touches, and never owns or disposes the session.
- Input is cancelled at the pause boundary; after resume a fresh touch is
  required. Never synthesize a begin to "restore" a held pointer.
- App backgrounding pauses an app-bound game; foreground resumes only the
  pause the lifecycle caused. Never resume a user pause on foreground.

## Collision (Task 11 — agents adding collision)

- Use the public Collision2D API for detection; keep response authored in
  the scene update. Never write private overlap math.
- Static pairs: `collideCircleAabb2D` / `collideAabbAabb2D` /
  `collideCircleCircle2D`. Fast objects: `sweepCircleAabb2D` /
  `sweepAabbAabb2D` before movement.
- Colliders are authored on objects as local records and placed with
  `placeCollider2D`; never pass local colliders to world-only operations.
  Colliders are translation-only; a rotated sprite keeps an axis-aligned
  gameplay collider.
- Use category/mask filters for system separation and `sensor: true` for
  detection-only intent. Collision never mutates scene state.
- Many objects: build a spatial hash once, query per moving object, and
  keep the narrow phase on the candidates.

## Diagnostics

- Missing asset: `ASSET_RESOLVE_FAILED` / `ASSET_DECODE_FAILED` with the
  field path; fix the module handle or the file.
- Bad frame rectangle: `ASSET_INVALID_FRAME_RECT` or
  `ASSET_FRAME_OUT_OF_BOUNDS`; fix the rectangle or the image.
- Disposed lease: `ASSET_STORE_DISPOSED`; never reuse a disposed owner.
- Full error table: `apps/docs/content/docs/api/asset-errors.mdx`.
