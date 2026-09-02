# Mossy Cavern 3 — rn-gamekit field memo

This is a build diary for a clean-room reference game. I deliberately did not use the existing Mossy Cavern, Mossy Cavern 2, or Platformer Lab implementations as a starting point.

## 2026-08-27 — Asset reconnaissance

- The supplied `Downloads/Mossy` folder is generous but not runtime-ready as a whole: 892 PNGs, nine WAV files, and roughly 87 MB. Most animation frames use oversized transparent 512×512 or 768×768 canvases. I will import a curated subset, keep gameplay hitboxes independent from image bounds, and avoid decoding the six huge atlases when a smaller standalone frame can do the job.
- The art has a strong, coherent silhouette language. The Blue Wizard, green/orange slimes, poison plant, floating-platform atlas, and deep cave decorations are enough to build a distinct level without generating replacement art.
- The supplied `gdb-gamepad-2(all)` folder contains keyboard, Xbox, PlayStation, and Switch prompt atlases plus an Aseprite source file. These are prompt sheets, not a controller runtime.
- No README, attribution, or license file exists in either supplied folder. Mixkit is suggested by the WAV filenames, but the local bundle does not prove licensing. GameKit cannot solve licensing, but a production asset pipeline would benefit from optional per-asset attribution/license metadata that can generate a credits screen and build-time report.

## 2026-08-27 — API reconnaissance

### Positives

- `movePlatformerBody2D` is an excellent foundation: deterministic X-then-Y AABB movement, solids, one-way-up platforms, high-speed sweeps, starting-overlap recovery, floor snapping, and classified contacts. This saved the game from needing a private collision solver.
- The fixed-step session, immutable scene state, presentation interpolation, typed committed events, and manual frame driver form a clean boundary between simulation and effects.
- `GameWorld2D`, `defineGameCamera2D`, follow/clamp/shake helpers, and camera cuts cover the full 2D presentation path without React becoming a per-frame state store.
- Particles have deterministic seeded bursts, capacity/overflow controls, pause/resume behavior, and retained Skia renderers.
- Audio, haptics, and storage are optional subpath APIs, so the core stays headless and testable.

### Friction and missing support

- GameKit input currently exposes buttons and a primary pointer only. There is no keyboard, gamepad/controller, analog axis, stick dead-zone/hysteresis, device connection, or prompt-family API. The supplied controller art can only be used as a visual legend; it cannot be backed by GameKit controller input. A `GameInputSource`/`GamepadInput` abstraction should normalize devices into declared actions.
- Input ownership is not source-aware. If touch and a future gamepad both hold `right`, one source releasing it could release the effective action for both. GameKit should ref-count declared actions by input-source id.
- `GameButtonPad` writes directly to a `GameSession`. A callback/diff sink option would let games compose touch, accessibility switches, keyboard, and controllers before forwarding one effective action stream.
- Tile collision roles stop at `solid` and `one-way-up`; Tiled object layers are not a gameplay trigger system. Pickups, hazards, checkpoints, exits, enemies, and moving platforms therefore need game-owned records and queries.
- Collider `sensor` is descriptive metadata, not a contact/event world. A small deterministic sensor world that reports enter/stay/exit pairs would remove repetitive trigger bookkeeping while keeping physics game-owned.
- Higher-level platformer feel remains game-owned: acceleration, braking, coyote time, jump buffering, variable jump height, dash windows, hurt/respawn, enemies, moving platforms, ladders, slopes, and water.
- (Superseded 2026-09-02) Save loading used to be asynchronous while scene creation was synchronous, so save-hydrated session bootstrap needed application choreography. The shell now supports async session factories with serial asset-then-save ordering; see the 2026-09-02 entry below.
- Audio, haptics, particles, storage, and session lifecycle are intentionally separate, but a small optional committed-event effects coordinator would eliminate repeated pause/resume/dispose/error-handling glue across games.
- Scene transitions carry no typed payload. This makes it awkward to pass a loaded run, selected level, or results into the next scene without closing over external mutable state.
- `TileMapLayer2D` correctly enforces cell-sized sprite frames, but supplied production art often uses irregular atlas chunks. A static chunk/baked-layer companion would help render authored irregular terrain without abandoning GameKit culling.

## 2026-08-27 — Architecture decisions before the first implementation

- Simulation will remain pure and fixed-step. React will only observe coarse semantic events for HUD text; player, camera, enemy, and particle animation will not use React state per frame.
- The GameKit platformer solver will own terrain collision. Swept AABB checks will own fast-moving trigger detection so collectibles and hazards cannot be skipped.
- Gameplay events will be emitted from the scene and consumed only after commit. Audio, haptics, particles, and persistence must never run from `scene.update`.
- Camera shake is represented as deterministic scene state and sampled by the GameKit camera definition. Respawn increments a camera cut id so presentation never interpolates across a teleport.
- The first shipping pass will favor a small set of carefully selected sprite frames over loading every animation sequence. This is better for decode time, memory, bundle size, and iteration speed. It also exposes a useful GameKit need: asset diagnostics currently describe loaded resources but do not offer an author-facing mobile texture-budget report.

## 2026-08-27 — First RED/GREEN loop

- Pure tests now exercise GameKit tile landing, high-speed swept pickups, jump buffering, coyote time, checkpoint-before-hazard ordering, respawn/camera cuts, locked victory, immutability, save round trips, and hostile/stale save normalization.
- The simulation tests went green without replacing `movePlatformerBody2D`. That is strong validation that the low-level helper composes well with authored platformer feel.
- A headless integration test initially failed before executing because `defineGameCamera2D` is exported from `rn-gamekit/react`; importing it in the otherwise-headless game module loaded React Native's Flow entry in Node. Splitting the camera binding into a presentation-only module fixes the architecture, but the helper itself has no React dependency and would be more reusable from `rn-gamekit/camera2d` (with a React re-export).

## 2026-08-28 — Rendering and asset integration

- The curated runtime bundle is about 13 MB on disk instead of copying the 87 MB source folder. It includes one 2048² irregular platform atlas, selected wizard/slime/plant frames, two prompt sheets, and seven audio files. The successful Expo export content-hashed identical files already used elsewhere in the playground, so several copied sources were deduplicated in the final asset list.
- `GameSprite` works well for snapshot-driven interpolation and discrete pose visibility. Because the supplied animations are separate PNG files rather than one sheet, each pose is a retained sprite node. A first-party atlas builder would reduce native image resources, boilerplate, and the risk of inconsistent union-crops across animation frames.
- The irregular floating-platform atlas cannot drive `TileMapLayer2D` because its useful chunks are not cell-sized. I used it as cropped visual decoration while the GameKit tilemap remains authoritative and a small fixed set of Skia platform shapes guarantees visual/collision alignment. A baked static chunk layer remains the missing middle ground.
- The GDB Xbox and keyboard sheets are now rendered through named cropped frames as prompt art. The HUD explicitly says they are prompt-only because GameKit cannot observe either physical input source.
- Seeded GameKit particle systems now cover dust, magic pickup/checkpoint bursts, hurt bursts, and victory confetti. A single scalar presentation clock drives four fixed-topology views.
- Renderer props do not include the owning `GameSession`, so a renderer-local particle presentation cannot subscribe to session pause/status without a game-owned out-of-band bridge. `requestAnimationFrame` naturally sleeps in the background, but an explicit paused session can let a currently active burst finish. `GameRendererProps` should expose a read-only lifecycle/status source, or `GameView` should bind particle presentations supplied by the renderer.
- The particle API accepts effect-wide count/color/direction, not per-emission overrides. The snapshot also carries only the latest semantic visual effect, so two different bursts on one fixed tick collapse visually even though both committed game events still reach audio/haptics/save listeners. A bounded committed-event presentation feed would solve this without pushing per-frame arrays through React.

## 2026-08-28 — Device effects and persistence

- Audio initialization is asynchronous and eager-decodes the declared map. Music, UI/dash, crystal, checkpoint, hurt, and completion cues are driven only from committed GameKit events. Session pause/resume is forwarded explicitly, and effect concurrency is bounded.
- Haptics are committed-event driven, rate-limited by GameKit, and pause-aware. The only lifecycle pause hook available is the private `_setPaused` seam; a public `bindGameSession`/`setPaused` method would remove an unsafe cast used by reference games.
- The supplied audio library has no short jump/landing sound. Using the 4.25-second UI notification on each jump was audibly inappropriate, so jump keeps a light haptic and particles but no sound. Asset validation cannot catch semantic mismatch; this belongs in the game diary rather than the engine.
- Storage uses `defineGameSave`, the AsyncStorage adapter, schema v2 migration, validation, stable authored-id filtering, queued writes, flush, and corrupt/stale-data normalization. Checkpoints, collected mooncaps, deaths, music preference, and best completion ticks are durable. Audio initialization waits for the validated load and honors a stored disabled-music preference.
- (Superseded 2026-09-02) The synchronous playground session factory used to prevent an asynchronously loaded checkpoint from hydrating the already-created scene; see the 2026-09-02 entry below for the resolved async startup.

## 2026-08-28 — Verification and review notes

- A review test found that the early `won` and `respawning` branches froze the camera-shake countdown, producing a constant offset. A regression test now proves shake decays while gameplay authority is frozen, and both branches decrement it deterministically.
- New headless tests: 19 passing. Coverage for authored headless modules is at least 89.95% lines for the GameKit integration, 99% for simulation, 100% for level/save, and 97% for feedback mapping. Renderer/content native behavior is compile/bundle checked but still needs physical-device visual and interaction testing.
- The full playground test suite passes. Playground lint and TypeScript checks pass with no diagnostics.
- `expo export --platform ios` succeeds and bundles Mossy Cavern 3 assets and code. This proves Metro resolution/bundling, not real GPU/audio/haptic performance.
- The repository-wide `pnpm check` gate also passes: lint, typecheck, package/playground tests, library build, docs production build, and playground iOS export.
- No claim is made about 60/120 Hz device stability yet. A release development build should be measured on iPhone, iPad, and a mid-range Android device, with special attention to the decoded 2048² platform texture, six retained wizard pose images, particle burst overlap, landscape safe areas, and audio startup latency.

## 2026-08-28 — First device-runtime correction

- The initial device launch exposed a module-load crash that compile, bundle, and headless gameplay tests did not catch: dust authored `scaleOverLife` as `{ min: 1, max: 0.2 }` to describe shrinking, while `defineParticleEffect` requires every `Range` to be ascending. The effect definitions now live in a headless module with a contract test that constructs the real particle system, so invalid authoring fails before Metro/device startup.
- I removed the dust scale envelope instead of reversing it, because `{ min: 0.2, max: 1 }` changes the visual intent to growth. The API is internally ambiguous: `scaleOverLife` is typed as a generic `{ min, max }` sampling range, but sampling treats the sampled value as the start and `max` as the end. It therefore cannot clearly express a deterministic `from: 1, to: 0.2` shrink. GameKit should use an explicit curve/envelope shape such as `{ from: Range, to: Range }` (or at least `{ start, end }`) and document whether values are randomized per particle.
- The next device run found an unsafe presentation assumption in my particle bridge: the UI worklet eagerly dereferenced `effectPosition.x` even for an idle `effectKind: 'none'` frame. Static typing describes committed snapshots but cannot make a UI-runtime dereference safe. The bridge now short-circuits idle effects and rejects missing/non-finite sequence and position data before scheduling work on the JS runtime; its pure, worklet-tagged selector has regression coverage for incomplete frames. This was an authored renderer bug, not a particle-system failure, though a GameKit committed-event presentation feed would avoid encoding effects into a lossy snapshot bridge at all.

## 2026-09-02 — Save startup resolved (T20F-R3/T20G-R2)

- The shell's async factory loads and validates the chronicle BEFORE
  constructing the session. The first published snapshot hydrates the saved
  lantern (respawn body and camera), already-collected mooncaps, and the death
  counter; an impossible checkpoint id normalizes to the authored spawn, and
  the collected-id array is cloned at the state boundary so session construction
  never freezes caller-owned save data.
- The ready slot publishes the validated projection as `startupSave`
  metadata. The feedback hook's durable baseline initializes from it
  synchronously before listeners register, so a crystal, checkpoint, hurt, or
  completion event before the content-side chronicle read resolves persists on
  top of the hydrated record and can never regress stored best ticks, deaths,
  or the music preference. Regression-tested with a gated storage read and
  early gameplay events, including the no-projection recovery path.
- Remaining friction: content and the shell still each open their own store,
  so the chronicle is read twice per open. A shared per-request store handle
  would remove the duplicate read.

