# Mossy Cavern 2 development memo

This is the implementation diary for a new game, deliberately separate from
the existing Mossy Cavern and every existing platformer in the playground.
It records decisions, useful outcomes, and GameKit feedback as the work
progresses.

## August 27, 2026 — Starting point

The game starts from the supplied `~/Downloads/Mossy` art and audio pack plus
the `~/Downloads/gdb-gamepad-2(all)` prompt pack. The intended experience is
a short portrait expedition: a blue wizard jumps, dashes through slimes,
collects dew relics, reaches moss checkpoints, and opens a final shrine.

I will keep simulation in a headless `GameSession`, render committed snapshots
through GameKit's Skia bridge, and keep React for controls, a coarse HUD,
audio, haptics, and save feedback only.

## August 27, 2026 — Positive findings

GameKit's separation of fixed-step scenes, typed events, camera bindings,
assets, particles, and touch buttons is a good fit for this game. In
particular, typed post-commit events make a clean boundary from gameplay to
audio, haptics, particles, and persistence.

## August 27, 2026 — Feedback: platform input

The supplied gamepad and keyboard prompt art cannot be connected to hardware
controllers or keyboards through GameKit today. `GameButtonPad` supports a
good multitouch button surface, but the documented input API does not expose
hardware gamepad, keyboard, virtual-stick, or hover input.

GameKit should add an optional semantic controller adapter that maps native
keyboard and gamepad buttons to declared `input.button(...)` actions. It
would let games use the same simulation controls across touch, keyboard, and
controller without treating the visual prompt art as a fake capability.

## August 27, 2026 — Feedback: save startup

(Superseded 2026-09-02: the shell now supports async session factories; see
the 2026-09-02 log entry below.)

The generic playground shell used to create sessions synchronously after
assets were ready, while GameKit saves are asynchronous and are intended to
load before a session is created. Mossy Cavern 2 therefore saved durable
expedition statistics at checkpoints and completion, but it could not restore
a checkpoint into its initial scene without changing the shell contract.

## August 27, 2026 — Feedback: source art and sprite sheets

The source pack ships animation frames as individual PNG files, but GameKit's
`spriteSheet` descriptor expects one pre-packed image and does not provide an
asset-pipeline helper for packing local frames. The game will preserve the
source art and use distinct state poses while keeping the render tree stable.

A development-only sprite atlas builder, or a documented Metro-time packing
recipe, would make GameKit friendlier to common artist exports and avoid
forcing each game to invent an external preprocessing step.

## August 27, 2026 — Asset preparation outcome

The supplied background and terrain sheets were very large (up to 4096 px on
one side), so I made compact, mobile-oriented runtime copies under
`apps/playground/assets/mossy-cavern-2/` rather than mounting the source-size
art directly. The game uses the blue wizard, both slime colors, plants,
terrain, background art, all nine supplied WAV files, and the controller
prompt pack. This is a positive fit for GameKit's static `require()` asset
manifest: the shell can load every image before publishing the live session.

## August 27, 2026 — Feedback: particle scale envelope

While authoring the first particle pools, `defineParticleEffect` rejected a
natural shrink envelope such as `{ min: 1, max: 0.35 }`: `scaleOverLife` is a
validated numeric range where `min` must be no greater than `max`. It means a
game cannot directly say “begin large and end small”; it can only supply an
unordered sample range and rely on the current implementation's sampling.

GameKit should expose explicit `scaleStart` and `scaleEnd` ranges (or a small
named envelope such as `shrink`) so common impact/dust effects are expressive,
deterministic, and self-documenting without reverse-engineering sampling
semantics.

## August 27, 2026 — First playable slice

The first independent vertical slice is now real rather than a visual mock:
the headless expedition uses GameKit's fixed-step scene, semantic `left`,
`right`, `jump`, and `dash` input, platformer tile movement, one-way shelves,
AABB collision, patrol slimes, poison, relics, checkpoints, a final shrine,
follow camera, and deterministic camera shake. The focused headless tests
cover jump input, dash/slime collision, relic collection, and camera bounds.

The presentation uses the shell asset gate, GameWorld2D/GameLayer2D parallax,
TileMapLayer2D, GameSprite pose selection, SpriteBatch for relics and slimes,
and shape-particle pools. The touch surface uses GameButtonPad with genuine
multitouch zones, which is a notably clean fit for holding movement while
pressing jump or dash.

## August 27, 2026 — Feedback: particle lifecycle binding

`useParticlePresentation` correctly wants a session lifecycle source, but a
GameKit renderer receives frame, alpha, viewport, camera, and assets — not
the session that owns them. I had to add a small session-keyed coordinator so
the session factory can establish the particle pool before the renderer
mounts, then the renderer can obtain the same lifecycle source.

This works, but GameKit could make it direct and safer by including a stable,
read-only session lifecycle handle in `GameRendererProps`, or by letting
GameView provide a `useGamePresentationSession()` hook. It would avoid global
coordinators, make concurrent/pictured sessions easier, and preserve the
otherwise excellent renderer isolation.

## August 27, 2026 — Native systems and saves

The content layer now maps committed events to supplied WAV audio, native
haptics, seeded particles, and profile saves. Audio, haptics, and
AsyncStorage are all treated as optional native capabilities: failure leaves
the game playable and reports a compact HUD message rather than breaking the
session. The journal saves mute preferences, relic totals, checkpoint
progress, completed runs, and best time; it deliberately does not pretend to
resume an in-progress scene. (Updated 2026-09-02: the shell's async factory
now hydrates the checkpoint index and aggregate totals before the session
constructs; see the September 2 entry below.)

## August 27, 2026 — Feedback: eager audio decoding

`createGameAudio` eagerly resolves and decodes every declared sound at startup.
For this small game that means the music bed and eight event WAVs are decoded
before the first jump; it is acceptable here, but it makes a long soundtrack
or a larger content pack an all-or-nothing memory and launch-time decision.

GameKit should consider an optional lazy sound descriptor or preloading group
API: games could make jump/dash feedback ready immediately, stream or defer
the larger music bed, and still keep the same typed `play()` surface. The
current API is simple and reliable, but its eager behavior deserves to be
explicit in performance guidance.

## August 27, 2026 — Verification diary

The dedicated gameplay tests and profile validation tests pass, as do the
full playground test suite, ESLint, and the playground TypeScript check. An
iOS Expo export also bundles Mossy Cavern 2 and its static images/prompts
successfully. The exporter content-deduplicates the copied WAV files against
the same supplied source files already present elsewhere in the playground;
that is expected and does not change the game-owned static handles.

## September 2, 2026 — Save startup resolved (T20F-R3/T20G-R2)

- The shell's async factory loads and validates the journal profile BEFORE
  constructing the session; the first published snapshot already hydrates the
  saved checkpoint index, and the aggregate relic count resumes from storage.
  Serial asset-then-save ordering means the save read starts only after the
  asset lease arrives, inside the factory's own promise.
- The ready slot publishes the validated projection as `startupSave`
  metadata. The HUD initializes its durable baseline from it synchronously
  before event listeners register, so a relic collected before the content-side
  journal read resolves persists on top of the hydrated record and can never
  overwrite stored best times, mute settings, or counters with default-derived
  data. Regression-tested with a gated storage read and an early gameplay
  event.
- Remaining friction: content and the shell still each open their own store,
  so the profile is read twice per open. A shared per-request store handle
  would remove the duplicate read.

