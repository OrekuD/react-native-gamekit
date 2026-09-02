# Mossy Cavern build memo

This memo records the implementation decisions, source assets, and GameKit API
friction encountered while building the Mossy Cavern reference game.

## 2026-08-27 — initial pass

- The game is a fixed-step, side-scrolling platformer: a blue wizard crosses a
  moss-covered cavern, defeats slimes, collects crystals, reaches checkpoints,
  and finds the exit.
- Source art was found in `/Users/david/Downloads/Mossy` and is credited in the
  repository README to maaot's Mossy Cavern pack. The local game bundle uses
  derived, atlas-friendly PNGs for the wizard, slimes, plants, tiles, and hill
  background, plus the supplied WAV effects/music.
- `/Users/david/Downloads/gdb-gamepad-2(all)` contains keyboard,
  PlayStation, Switch, and Xbox prompt atlases plus the Aseprite source. These
  are useful for the on-screen control legend; the game will use a compact
  derived prompt strip so the touch controls can still show familiar keyboard
  / controller hints without loading an entire editor atlas into the UI.
- Runtime ownership: the `GameSession` owns physics, input interpretation,
  enemy/collectible/checkpoint state, camera authoring, and typed events.
  React owns only the low-frequency HUD, audio/haptic effect bindings,
  persistence effects, and controls. The renderer reads committed snapshots
  through `GameWorld2D`, `TileMapLayer2D`, `GameSprite`, `SpriteBatch`, and
  `ParticleView`.
- Planned GameKit systems: tilemap collision, animated sprites, camera follow
  and deterministic shake, seeded particles, audio, haptics, versioned saves,
  lifecycle pause/resume, and the semantic `GameButtonPad` input surface.

## API notes to verify during implementation

1. (Superseded 2026-09-02) The playground surface registry used to expose only
   a synchronous `createSession` factory, so the initial scene could not be
   seeded from AsyncStorage. The shell now supports async preparation: entries
   declare an async factory and the shell loads the validated save before
   constructing the session (see the 2026-09-02 log entry below).
2. A `GameRendererProps` value does not include the owning session or a
   lifecycle-scoped effect registry. The particle clock and event listeners
   therefore need a small session-keyed coordinator shared by the screen and
   renderer. GameKit should provide an effect-system binding owned by
   `GameView`, or pass a typed session/effect context to renderers, so sibling
   HUD and renderer code cannot need module-level coordination.

The notes above are provisional; append new entries whenever an API gap or
surprising integration detail is confirmed.

## Ongoing log

- 2026-08-27 — Added the first fixed-step simulation contract: solid and
  one-way moss terrain, coyote-time/buffered jumping, dash, enemy patrols and
  stomps, poison hazards, crystals, four checkpoints, respawn lives, finish,
  game-over, and authored camera shake. Positive: these behaviors fit cleanly
  in one immutable `defineScene` update and typed event stream; no React state
  is needed for the game loop.
- 2026-08-27 — Added the keyboard-arrow crop from `gdb-gamepad-2(all)` as a
  control hint asset. Positive: the source atlas is reusable art, but the
  focused crop avoids shipping a full multi-style reference sheet into the
  HUD.
- 2026-08-27 — Confirmed a current GameKit limitation while wiring effects:
  `GameRendererProps` exposes frame/alpha/viewport/camera/assets, but not the
  session or a lifecycle-owned particle system. The screen and renderer are
  siblings, so a small session-keyed coordinator is required to give
  `ParticleView` the same system that event listeners emit into. GameKit
  should expose a typed `GameView` effect context or allow a renderer to
  receive a session-scoped presentation system directly; this would remove
  module-level coordination and make disposal ownership explicit.
- 2026-08-27 — Particle effect validation rejected the intended dash trail
  range `{ min: 0.9, max: 0.35 }` because `scaleOverLife` only permits ascending
  ranges. The sampler already has separate `scaleStart`/`scaleEnd` values, so
  descending scale is a useful effect that should be supported (for example by
  accepting a direction flag or a start/end pair). Mossy uses the valid
  ascending fallback for now.
- 2026-08-27 — The same descending-scale constraint appeared in the crystal,
  hit, and finish bursts while importing the effect table. All three now use
  valid ascending ranges; this is a confirmed API ergonomics issue rather than
  a one-off authoring typo.
- 2026-08-27 — Headless trace found the first bridge authored 192 units above
  the floor while the jump arc only cleared about 177 units. The level was
  technically valid but unfair; bridges now sit 128 units up and the
  regression test deliberately walks into a gap to verify respawn.
- 2026-08-27 — A second trace showed the fall test was dying to an early slime
  / poison plant before it reached the opening gap. The opening combat was
  moved deeper into the level and the first gap widened to six cells; its
  one-way bridge still spans the full gap for a normal jump, while holding
  Drop now reaches the intended fall path.
- 2026-08-27 — Focused headless tests now pass for spawn settling, unique
  checkpoint events, and fall respawn. Positive: the game can be exercised
  without React Native or native assets, and the frame driver makes physics
  regressions reproducible.
- 2026-08-27 — TypeScript passed. ESLint then rejected synchronizing a mute
  ref during render under the project's React rules. The fix is a small
  effect-scoped synchronization and a stable audio setup effect, which also
  prevents toggling mute from tearing down and re-decoding every sound.
  GameKit could make this pattern easier with a lifecycle-owned audio policy
  hook, but the current API is usable once ownership is kept outside render.
- 2026-08-27 — Renderer, particles, audio, haptics, save-store bindings, and
  shell registration are implemented. Remaining validation: full playground
  tests, an authored long-run finish trace, and native-device behavior for
  decoder/haptics fallbacks.
- 2026-08-27 — The first 45-second default-input trace reached game-over at
  column 28: a runner that never varies its jump rhythm hit the opening slime
  cluster repeatedly. This was useful negative feedback, not a reason to
  remove hazards; the authored route now has a regression trace with a
  readable 55-frame jump rhythm that reaches all four checkpoints and the
  finish in about 24 seconds. The game still rewards dodging/stomping rather
  than silently making hazards harmless.
- 2026-08-27 — Final audio pass caught a semantic mistake in the game-over
  listener: it was playing the completion cue after stopping the music. The
  listener now uses the supplied losing cue; finish alone owns the completion
  fanfare. This is a reminder that the event API is easy to wire mechanically,
  but event-to-feedback meaning still needs an authored pass.
- 2026-08-27 — Final event review found game-over UI reading the render frame
  from inside its own event callback, which could be one commit stale. The
  typed game-over payload now carries elapsed time, score, crystals, and falls,
  so the end screen consumes the same committed facts that persistence and
  effects receive. GameKit's typed event stream made this correction small;
  richer terminal payloads should be the default pattern.
- 2026-08-27 — Final validation is green: playground lint, TypeScript,
  170 headless tests, 46 component tests, and the iOS Expo export all pass;
  Metro includes the full Mossy audio/image bundle. Native device playback
  and haptics were not available in this shell, so the UI intentionally reports
  graceful fallback status if a decoder or haptics peer cannot initialize.
- 2026-08-27 — Maintenance pass split the authored data and internal state
  shapes out of the scene module; the behavior file is now 755 lines instead
  of 1,154. Positive: the simulation remains self-contained while assets,
  events, saves, and state contracts can be reviewed independently. The
  post-refactor lint, typecheck, full test suite, and iOS export stayed green.

- 2026-09-02 — T20F-R3/T20G-R2 save startup landed. The shell's async factory
  loads and validates `mossy-cavern` storage BEFORE constructing the session,
  and the session's first published snapshot already reflects the saved
  checkpoint, score, crystals, falls, and best time. The ready slot also
  publishes the validated projection as `startupSave` metadata, which this
  screen uses to seed the journal display synchronously; the content-side
  store load remains only as a display refresh and recovery path. Positive:
  serial asset-then-save ordering kept the hostile-ordering work in the shell,
  so the game factory stays a pure function of the loaded projection. Remaining
  friction: content and the shell each open their own store, so the record is
  read twice per open; a shared per-request store handle would remove the
  duplicate read.

