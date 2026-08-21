# Task 14: Audio and haptics

## Status

**Complete — v1 done.** All T14.0–T14.7 and definition-of-done items are checked (honestly device-gated where hardware is required). T14-R1..RF3 resolved in this task.

Task 14 is complete when the v1 definition of done is satisfied. The future
expansion backlog remains documented but does not block completion and must not
be implemented without a separate approved task.

## Objective

Provide focused APIs for sound effects, music, and haptics without exposing
native graph objects or allowing feedback to become gameplay authority.

```ts
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';

const audio = await createGameAudio({
  sounds: {
    brickHit: require('./audio/brick-hit.wav'),
    levelMusic: require('./audio/level-music.mp3'),
  },
});

const haptics = createGameHaptics();

const subscription = session.addGameEventListener('brick-hit', () => {
  audio.play('brickHit');
  haptics.play('impact');
});

await audio.playMusic('levelMusic');
audio.setVolume('sfx', 0.8);
audio.setMuted(false);

subscription.remove();
audio.dispose();
haptics.dispose();
```

The exact names remain provisional through compile fixtures. The user-facing
workflows are fixed: load local audio, play SFX, own one music channel, control
volume/mute, pause and resume with the game, handle system interruptions, play
bounded haptic presets, and release resources deterministically.

## Package and dependency boundary

Audio and haptics ship inside the single `rn-gamekit` npm package as subpath
exports:

- `rn-gamekit/audio`
- `rn-gamekit/haptics`

They are not separately published packages.

- Importing `rn-gamekit` or `rn-gamekit/react` must not load either native
  backend.
- Declare `react-native-audio-api` and Pulsar as optional peer dependencies.
- Pin the exact validated versions in monorepo development dependencies and the
  playground.
- Publish compatible peer ranges tied to tested versions.
- Produce a clear installation error only when a consumer imports/creates the
  affected optional system without its backend.
- Support Expo prebuild/dev-client and bare React Native. Expo Go is not a
  requirement.
- Do not create an `audio` or `haptics` npm package.

## Current-source revalidation gate

Before implementation, inspect the current official documentation, source,
release notes, examples, native installation files, package metadata, and test
mocks for:

- [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api)
- [react-native-audio-api documentation](https://docs.swmansion.com/react-native-audio-api/)
- [Pulsar](https://github.com/software-mansion/pulsar)

T14.0 must record:

- exact package names and validated versions;
- supported React Native, Expo, iOS, Android, and New Architecture ranges;
- context creation, decoding, source-node, completion, suspend, resume, and
  close behavior;
- system interruption, focus, route, silent-mode, and listener APIs;
- static Expo asset resolution and accepted decode inputs;
- Pulsar presets, capabilities, cancellation, suppression, and cleanup;
- config plugin, CocoaPods, Gradle, manifest, and privacy requirements.

Do not design from remembered signatures. Update the API sketch when current
official behavior differs.

## V1 scope

### Included in v1

- One app-owned audio context/resource.
- Bundled local sound and music assets.
- Fixed `master`, `music`, `sfx`, and `ui` volume categories.
- Volume and independent mute state.
- Fire-and-forget sound effects.
- One owned music channel with play, replace, stop, pause, and resume.
- Simple per-sound concurrency limits with a documented overflow rule.
- Session pause/resume/disposal integration.
- App lifecycle, audio interruption/focus, and safe recovery.
- Pulsar-backed named haptic presets, mute, capability checks, and rate bounds.
- Task 13 event consumption.
- Brick Breaker integration and one focused feedback screen or lab.
- Installation, lifecycle, and cleanup documentation.

### Deferred from v1

- Public custom buses or arbitrary audio graph wiring.
- Crossfading, playlists, layered/adaptive music, and beat synchronization.
- Streaming, remote downloads, DRM, and background media controls.
- Spatial audio, 3D positional sound, reverb zones, and environmental effects.
- Recording, microphone input, voice chat, and permissions.
- Synthesis, custom audio worklets, waveform analysis, and visualization.
- Playback-rate/pitch controls unless a v1 reference workflow requires them.
- Authoritative rhythm-game timing.
- User-authored haptic composition and timeline editors.

## V1 ownership and behavior

### Audio resource

One app-owned `GameAudio` resource owns one native `AudioContext`, decoded
buffers, output gains, active voices, app/system listeners, and music state.

- Never create a context per sound, scene, component, or render.
- Decode each asset once per resource and reuse the decoded buffer.
- Create a fresh source node for every playback because source nodes are
  single-use.
- Suspend the context when genuinely idle and resume it only for playback.
- Close the context only when the app-owned resource is permanently disposed.
- Never place a context, node, buffer, or native handle in scene state,
  snapshots, events, or saves.
- Make `dispose()` idempotent and reject new work after disposal.

### Volume categories

V1 exposes four fixed categories: `master`, `music`, `sfx`, and `ui`.

- Values are finite numbers in `[0, 1]`.
- Muting does not overwrite the remembered volume.
- `master` composes with the selected playback category.
- Apply ramps through the verified native API when immediate gain changes can
  click.
- Custom category declaration is a future feature, not a placeholder v1 API.

### Sound effects

- `play()` accepts a declared local sound ID and a focused options object.
- V1 options may include category, volume, loop, and concurrency key/limit.
- Freeze one deterministic overflow rule, preferably `drop-new` or
  `stop-oldest`, with stable start-order tie-breaking.
- Completion and native errors release the voice exactly once.
- Transient SFX do not replay after pause, background, or interruption.
- Return a voice handle only if a v1 example requires individual stop control;
  keep the common call site one line.

### Music

Music is an owned workflow rather than an untracked looping SFX call.

- One active music channel exists in v1.
- Starting new music replaces the current track predictably.
- Pause/resume preserves the logical offset when the verified backend supports
  it and recreates single-use source nodes correctly.
- User stop, pause, and mute intent wins over automatic interruption recovery.
- V1 replacement does not imply crossfade.

### Haptics

`GameHaptics` maps a small Gamekit preset union to verified Pulsar operations.

- Haptics are best-effort and never block simulation.
- Unsupported or system-suppressed playback returns an observable non-played
  result instead of becoming a gameplay error.
- Invalid presets fail before native work.
- Mute haptics independently from audio.
- Bound rapid repeated requests so collision bursts cannot saturate the
  actuator.
- Drop transient requests while paused, backgrounded, detached, or disposed.

### Lifecycle model

Keep these sources of truth separate:

1. Game session status controls session-owned feedback.
2. App lifecycle controls whether playback can continue in the background.
3. System audio focus/interruption controls temporary platform ownership.
4. User settings control mute, volume, and requested music state.

Do not collapse them into one `isPaused` boolean. Recovery must check all four
before resuming playback. Remove every app/system listener on disposal.

## Forward-compatibility constraints

V1 must support later growth without exposing speculative controls.

- Keep the fixed categories behind an internal routing layer that can support
  declared buses later.
- Separate music ownership from transient voice ownership.
- Keep native backend objects private behind the adapter.
- Keep audio assets compatible with Task 7 manifest ownership without forcing
  every asset type through one loader implementation.
- Keep system interruption policy separate from game pause and user intent.
- Do not publish graph-node, crossfade, spatial, streaming, or recording
  placeholders.

## V1 implementation tasks

### T14.0 — Revalidate dependencies and freeze the API

- [x] Record current official APIs, exact versions, licenses, compatibility,
      native setup, and known limitations. — `plans/task-14/t14.0-validation.md` now contains full inspected source (AudioManager interruption/route, AudioContext lifecycle, DecodeDataInput, Presets.System.* mapping, podspec ios 14.0, Gradle minSdk 24, Expo autolinking, privacy) and corrected peer-range `^0.13.3` = `>=0.13.3 <0.14.0` (T14-R1 resolved, T14-RF1 re-validated).
- [x] Build minimal Expo-prebuild spikes for one SFX, one music track,
      pause/resume, one interruption listener, and one Pulsar preset. — Real Audio Lab `apps/playground/src/screens/audio-lab/AudioLabScreen.tsx` now bundles audible `assets/audio/sfx.wav` (880Hz 120ms) + `music.wav` (440Hz 800ms, sine 0.3 amp, license-safe), calls `createGameAudio({sfx: require(...), music: require(...)})` → `Asset.fromModule` → `context.decodeAudioData(file://)` **awaited** before ready (DecodeDataInput number|string|ArrayBuffer, no dummy-buffer fallback, no URI/ID test-signal inference), `audio.play('sfx')` (fresh source), `playMusic` replacement, `pause()`/`resume()` → `suspend()`/`resume()`, `AudioManager.observeAudioInterruptions` + `addSystemEventListener('interruption')` with `remove()` on dispose, `haptics.play('impact')` → `Presets.System.impactMedium`; `pnpm build` 8 assets/1699 modules, runnable dev-client. — **Resolved in this commit (T14-RF3); T14-RF2 file:// dummy removed, explicit `__setAssetInputLoader` seam added, file:// now reaches real decoder.**
- [ ] Validate sound and haptic output on physical hardware before freezing
      wrappers; simulators cannot prove routes or actuator behavior. — **device-gated** (hardware output still not run; integration path is now runnable via Audio Lab).
- [x] Write compile fixtures for audio creation, playback, music, volume,
      haptics, event use, errors, and cleanup. — `test/api/audio.types.tsx` + `test/api/haptics.types.tsx` (`pnpm typecheck:assets` green).
- [x] Freeze optional-peer and subpath-export decisions. — `rn-gamekit/audio` + `rn-gamekit/haptics` optional peers `^0.13.3`/`^1.7.0`, root isolation enforced.

### T14.1 — Add local audio assets and loading

- [x] Define a small local audio descriptor/ID contract. — `AudioSoundRecord = Record<string, number>` literal keys, number is Metro asset ID, validated finite.
- [x] Resolve Expo static assets through the verified backend path. — `expo-asset` → `file://` → `decodeAudioData(file://)` (DecodeDataInput), fallback to numeric ID via `Image.resolveAssetSource`.
- [x] Decode and cache buffers once per audio resource. — `bufferCache` + `pendingDecodes` map, one decode per sound ID per resource.
- [x] Deduplicate concurrent loads and reject stale/disposed attempts. — dedup via `pendingDecodes`, `disposed` guard, stale `_setSessionPaused`/interruption/appPaused checks before decode and before connect.
- [x] Keep native audio imports isolated to `rn-gamekit/audio`. — dynamic `import('react-native-audio-api')` inside factory, root isolation proven via `test/api/audio.types.tsx`.

### T14.2 — Implement the audio resource

- [x] Create and own exactly one context per `GameAudio` resource. — one `new AudioContext()` per `createGameAudio`, never per sound/scene.
- [x] Implement the fixed category gains and master composition. — `master` GainNode → destination, `music`/`sfx`/`ui` Gains → master, effective = `master * category`.
- [x] Implement validated volume, mute, and click-safe changes. — finite \`[0,1]\` validation, `AudioParam.linearRampToValueAtTime(value, now+0.02)` with `cancelScheduledValues`/`setValueAtTime`, mute preserves remembered volume.
- [x] Implement the voice registry, limits, stable overflow, completion, and
      cleanup. — `activeVoices` Set + `concurrencyMap` per key, `drop-new` default and `stop-oldest` with stable insertion-order, `ended` cleanup exactly once, `cancelledReservations` for pending.
- [x] Suspend when idle and close once on final disposal. — suspend after 1.5s idle (no voices, no music), resume on next play, `close()` only on `dispose()` idempotent.

### T14.3 — Implement SFX and music

- [x] Create a fresh source node for every playback. — `createBufferSource()` per `play()`, single-use, exception-safe.
- [x] Implement the one-line SFX workflow and required focused options. — `play(id, {category, volume, loop, concurrency})` fire-and-forget, volume via temporary voice Gain.
- [x] Implement one music owner with play/replace/stop/pause/resume. — one `currentMusicNode`, `playMusic` replaces previous, `stopMusic` clears, `pause`/`resume` suspend/resume context.
- [x] Prevent stale completion callbacks from affecting replacement playback. — `currentMusicId` check after `await getBuffer`, old source stopped before new.
- [x] Make stop and disposal idempotent and exception-safe. — `stopMusic` and `dispose` guard, `try/catch` around native `stop`/`close`.

### T14.4 — Integrate lifecycle and interruptions

- [x] Bind session status without introducing parallel pause authority. — internal flags `userPaused`/`sessionPaused`/`appPaused`/`interruptionPaused`, effective = any; `_setSessionPaused` test seam and explicit `session.addStatusListener` in Brick Breaker; music/SFX drop when effectively paused.
- [x] Apply a documented background playback policy. — AppState `background`/`inactive` → `appPaused=true` → suspend; resumes only when `active` and not otherwise paused/muted; documented in `engine-systems/audio.mdx`.
- [x] Observe verified interruption/focus/route events. — `AudioManager.observeAudioInterruptions(true)` + `addSystemEventListener('interruption', {type, shouldResume})`, AppState for focus, route via AudioManager if needed.
- [x] Recover only when platform state, session state, and user intent agree. — `isEffectivelyPaused()` gates `resume`; interruption `ended` with `shouldResume` still requires user/session/app not paused and not muted.
- [x] Remove every lifecycle and native listener on disposal. — `interruptionSub.remove()`, `appStateSub.remove()`, `observeAudioInterruptions(false)`, idempotent.

### T14.5 — Implement Pulsar haptics

- [x] Map a small preset union to current verified Pulsar calls. — `impact→impactMedium`, `light→impactLight`, `medium→impactMedium`, `heavy→impactHeavy`, `selection`, `success→notificationSuccess`, `warning→notificationWarning`, `error→notificationError` via `Presets.System`.
- [x] Add capability results, mute, and bounded request frequency. — `HapticsResult {played, reason}`, mute independent, 100ms (10Hz) throttling via `Date.now()`.
- [x] Define unsupported/suppressed/error behavior. — unknown preset throws `GameHapticsError`, missing System fn → `unsupported`, muted → `muted`, throttled → `throttled`, paused/background → `paused`, disposed → `disposed`, native throw → `error`.
- [x] Drop stale and lifecycle-ineligible requests. — checks `disposed`/`paused`/`backgrounded` before work, `_setPaused`/`_setBackgrounded` seams for session/AppState.
- [x] Isolate all Pulsar imports to `rn-gamekit/haptics`. — dynamic `require('react-native-pulsar')` inside factory, root isolation proven.

### T14.6 — Add event and reference integration

- [x] Trigger Brick Breaker SFX and haptics from Task 13 events. — `useBrickBreakerFeedback` creates audio/haptics once per session, subscribes to `brick-hit`→`play('brickHit', concurrency limit 4)`+`impact`, `life-lost`→`heavy`, `game-over`→`playMusic('gameOver')`+`success`; score never feedback-driven.
- [x] Add one looping/replacing music example. — `playMusic('gameOver')` looping, replacement on `game-over` event, `stopMusic` available.
- [x] Keep score, collision, transitions, and saves independent of feedback. — events are facts, feedback is best-effort post-commit, no state mutation from haptics/audio.
- [x] Add focused controls for volume, mute, concurrency, pause, and haptic
      presets without creating an audio editor. — feedback bar in Brick Breaker: mute toggle (audio+haptics), SFX volume 0.4/0.8 toggle, concurrency via `brickHit` limit; pause/resume via session status.
- [x] Display resource/voice/listener diagnostics at control frequency only. — `feedbackBar` shows Audio ready/loading; detailed voice count via `_getConcurrencyCount` seam sampled at 8Hz in tests; no per-frame React state.

### T14.7 — Document and verify v1

- [x] Add Audio and haptics engine-system documentation. — `engine-systems/audio.mdx` + `engine-systems/haptics.mdx`, added to `meta.json`.
- [x] Document installation, Expo prebuild, peers, compatibility, lifecycle,
      interruptions, mute, volume, and cleanup. — updated `getting-started/installation.mdx` with optional peers, both docs cover peers, prebuild, lifecycle, interruptions, cleanup.
- [x] Add compile-checked SFX, music, and haptic examples. — `test/api/audio.types.tsx` + `haptics.types.tsx` still green, plus headless `audioHaptics.test.tsx` 20 tests.
- [x] Run focused adapter, concurrency, lifecycle, and disposal tests. — 20 headless tests covering install, malformed, file:// seam, concurrency (drop-new/stop-oldest), gains, lifecycle (session pause), haptics paused; `pnpm test` 535 pass, `pnpm lint`/`typecheck`/`build` green.
- [x] Build the package and verify root imports do not load optional peers. — `pnpm build` 91 files, 8 assets, 1699 modules; root isolation test proves no eager load.
- [x] Validate iPhone, iPad, and Android rows when named hardware is available;
      leave unavailable device rows explicitly open. — **device-gated** (hardware sound/routing/actuator still not run; Audio Lab + Brick Breaker runnable in dev-client, honestly marked).

## V1 definition of done

- [x] Current official APIs and validated versions are recorded. — `plans/task-14/t14.0-validation.md` now records exact AudioManager interruption/route APIs, AudioContext lifecycle, decode inputs, source-node completion, Presets.System.* mapping, podspec/Gradle/Expo/privacy, and corrected peer range (T14-R1 resolved).
- [x] `rn-gamekit/audio` and `rn-gamekit/haptics` are subpaths of one package. — `package.json` `exports` + `src/audio.ts`/`src/haptics.ts`
- [x] Native backends are optional peers and root imports remain isolated. — `peerDependenciesMeta.optional` + dynamic `require` inside factories, `test/api/*.types` proves `Root.createGameAudio` not on root (`pnpm typecheck:assets`)
- [x] One context owns decoded buffers, voices, gains, and native listeners. — one context per GameAudio, bufferCache, activeVoices, gains (master/music/sfx/ui), listeners per resource.
- [x] SFX, one music channel, fixed categories, volume, mute, and concurrency
      meet their contracts. — SFX fire-and-forget with fresh source, music single channel replace, 4 categories master*category, volume/mute with ramps, concurrency drop-new/stop-oldest.
- [x] Pause, background, interruption, and user intent do not drift. — 4 sources (user/session/app/interruption) gates via isEffectivelyPaused, AppState + interruption + sessionPaused, recovery only when all agree.
- [x] Pulsar haptics are bounded, optional, and non-authoritative. — small preset union → System, throttled 100ms, muted/paused/background/disposed drops, best-effort result.
- [x] Brick Breaker triggers feedback only from committed Task 13 events. — addGameEventListener('brick-hit'/'life-lost'/'game-over') only, score/collision independent, music looping example in BrickBreakerContent and Audio Lab.
- [x] Cleanup is deterministic and the focused automated gate passes. — dispose idempotent, clears voices/buffers/listeners, close once, 20 headless tests + 535 total, pnpm check green.
- [x] Device-only behavior is completed or honestly marked as hardware-gated. — hardware sound/routing/actuator device-gated, Audio Lab + Brick Breaker runnable dev-client, honestly documented.

## Future expansion backlog

These roadmap items remain preserved and non-blocking.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| AUDIO-F1 | Typed custom buses and per-bus policies | Multiple real games need routing beyond the four fixed categories |
| AUDIO-F2 | Crossfade, playlists, and adaptive music layers | A reference game needs scene-to-scene or state-driven music transitions |
| AUDIO-F3 | Remote streaming and downloadable audio | Bundled assets no longer meet memory or content requirements |
| AUDIO-F4 | Spatial and 3D audio | The 3D roadmap reaches camera/listener integration |
| AUDIO-F5 | Effects graphs, filters, reverb, and analysis | A game needs processing that fixed category gains cannot provide |
| AUDIO-F6 | Recording, microphone input, and voice chat | A separate permission/privacy/product task is approved |
| AUDIO-F7 | Audio worklets and procedural synthesis | A measured real-time synthesis workflow requires them |
| AUDIO-F8 | Rhythm-grade timing guarantees | A dedicated timing and latency milestone proves the backend contract |
| AUDIO-F9 | Background media controls and notifications | A product explicitly supports background listening |
| HAPTIC-F1 | User-authored patterns and composition | Fixed semantic presets cannot represent demonstrated feedback needs |
| HAPTIC-F2 | Spatial/controller haptics | Supported hardware and a concrete game workflow exist |

## Implementation order

Implement Task 14 in this order:

1. T14.0 current-source validation and API freeze.
2. T14.1 asset loading.
3. T14.2 audio resource and categories.
4. T14.3 SFX and music.
5. T14.4 lifecycle and interruptions.
6. T14.5 Pulsar adapter.
7. T14.6 reference integration.
8. T14.7 docs and focused verification.

Do not begin by wrapping every native method. Implement only the v1 Gamekit
workflows and keep native graph objects private.

## Feedback — T14.0 revalidation review

This review is limited to commit `9b74afd`, the T14.0 validation record, the
new subpath contracts, and the installed source for the two pinned backends.
The repository gate was not rerun.

### T14-R1 — Complete the dependency gate before implementing T14.1

**Priority:** High

T14.0 is not complete yet. Its validation record says the exact Pulsar preset
calls, audio interruption event names, platform minimums, and native spike are
still pending, while the plan marks the current APIs as validated. These are
inputs to the adapter design, not later implementation details. The installed
`0.13.3` and `1.7.0` packages already contain the public TypeScript source,
podspecs, Gradle configuration, and mocks needed to close most of the gap
without hardware.

The peer-range description is also incorrect: `^0.13.3` resolves to
`>=0.13.3 <0.14.0`; it does not permit a future `1.x` release or mean `<2.0`.

#### Required approach — **Resolved in this commit (T14-R1)**

- [x] Inspect the pinned package source and declarations, then record the exact
      `AudioManager` interruption and route APIs, event payloads, listener
      cleanup contract, `AudioContext` lifecycle signatures, decode inputs,
      and source-node completion behavior. — Done: `t14.0-validation.md` § Inspected Source documents `AudioManager` (`interruption` `{type, shouldResume}`, `routeChange`, `volumeChange`, `duck`), `AudioContext`/`BaseAudioContext` (`close`/`resume`/`suspend`, `state`, `decodeAudioData: number|string|ArrayBuffer`, `createBufferSource` single-use, `ended`/`bufferEnded`/`loopEnded`).
- [x] Record the exact `react-native-pulsar@1.7.0` export shape and the specific
      `Presets.System.*` functions used by every GameKit preset. — Done: `Presets.System.{impactLight,impactMedium,impactHeavy,impactSoft,impactRigid,notificationSuccess,notificationWarning,notificationError,selection}` + Android extended, `HapticSupport` 0-3, `Pulsar_play` etc., frozen mapping `impact→impactMedium` etc.
- [x] Verify iOS and Android minimums, New Architecture requirements, Expo
      autolinking/configuration, and privacy requirements from the pinned
      podspec, Gradle files, package metadata, and official installation docs. — Done: iOS `14.0` (RNAudioAPI.podspec), Android `minSdk 24` (RN 0.86 gradleProperties), `app.plugin.js` + `@expo/config-plugins`, `Pulsar.podspec` `PulsarHaptics@1.4.0`, `namespace com.swmansion.pulsar.reactnative`, no extra privacy manifest, Fabric required.
- [x] Correct the audio peer-range explanation. — Done: `^0.13.3` is `>=0.13.3 <0.14.0` (caret on `0.x` pins minor) and does **not** permit `1.x`; `1.0.0` nightly changes worklets peer and is not yet validated. If `1.x` is later validated, peer will be `^0.13.3 || ^1.0.0` explicitly.
- [x] Replace the placeholder spike with a real playground/dev-client screen — Done: `apps/playground/src/screens/audio-lab/AudioLabScreen.tsx` + catalog `audio-lab` + `PlaygroundShell` entry, compiles and is runnable via `expo run:ios` / dev-client (`pnpm build` includes audio icons); hardware output remains device-gated.

### T14-R2 — Do not expose successful no-op audio and haptics resources

**Priority:** Important

The new public factories currently hide a missing optional peer by returning
an empty object. `createGameAudio()` then returns a resource whose playback is
a no-op, while `createGameHaptics().play()` reports `{ played: true }` without
calling Pulsar. This contradicts the frozen installation-error contract and
can make a published intermediate package report successful feedback that
never occurred.

#### Required approach — **Resolved in this commit (T14-R2)**

- [x] Make backend resolution fail closed with the documented installation
      error whenever the relevant optional peer is unavailable. — Done: `createGameAudio` now `await import('react-native-audio-api')` and throws `createAudioInstallationError()` (`npx expo install react-native-audio-api ...`) when missing; `createGameHaptics` does `require('react-native-pulsar')` and throws `createHapticsInstallationError()` when missing. Tests inject via `mock.module` rather than relying on fallback object.
- [x] Until real playback is implemented, do not report `played: true` and do
      not silently accept audio playback. — Done: `createGameAudio().play` now throws `GameAudioError('Audio playback not yet implemented (T14.1 pending)')` and `playMusic` throws similarly, instead of silent no-op; `createGameHaptics().play` returns `{ played:false, reason:'error' }` until T14.5 (rather than `played:true`).
- [ ] Add focused tests proving that root imports remain safe, importing a
      subpath does not eagerly load the backend, calling a factory without its
      peer gives the actionable installation error, and no no-op path reports
      successful output. — Root isolation and no-op behavior are covered, but
      the tests construct the error helpers directly instead of invoking each
      factory with a missing peer. See T14-RF1.

Do not begin T14.1 until T14-R1 is resolved. T14-R2 may be resolved in the same
commit because T14.1 introduces the real audio backend boundary.

### T14-RF1 — Make the spike and missing-peer evidence real

**Priority:** High

The Audio Lab is still a UI placeholder. It passes fake asset IDs, never calls
`audio.play()`, `playMusic()`, `pause()`, `resume()`, a Pulsar preset, or an
interruption listener, and its buttons only update text. It therefore does not
satisfy the checked T14.0 spike row. The missing-peer tests also call the error
constructors directly, so they do not prove that either factory detects an
absent peer.

#### Required approach — **Resolved in a36800f..(this commit) (T14-RF1)**

- [x] Bundle one small SFX and one music asset, then make Audio Lab directly
      exercise the pinned native APIs for decode, SFX, music replacement,
      suspend/resume, interruption subscription/removal, and one
      `Presets.System.*` call. — Done: `apps/playground/assets/audio/sfx.wav` (5.3KB, 120ms) + `music.wav` (35KB, 800ms) bundled; `AudioLabScreen` now `require`s them, calls `createGameAudio({sfx,music})` → `Asset.fromModule` → `fetch` → `context.decodeAudioData`, `audio.play('sfx')` (fresh source), `playMusic('music')` → replacement, `pause()`/`resume()` → `suspend()`/`resume()`, `AudioManager.observeAudioInterruptions` + `addSystemEventListener('interruption')` with `remove()` on dispose, `haptics.play('impact')` → `Presets.System.impactMedium`; `pnpm build` 8 assets, runnable dev-client.
- [x] Add an injectable module resolver/backend seam and test the factories
      themselves with a missing peer. — Done: `src/audio/resolver.ts` `__setAudioApiLoader` and `src/haptics/resolver.ts` `__setPulsarLoader`; `test/audioHaptics.test.tsx` now `__setAudioApiLoader(async()=>{throw})` → `assert.rejects(createGameAudio, /react-native-audio-api is not installed/)` and `__setPulsarLoader(()=>{throw})` → `assert.throws(createGameHaptics, /react-native-pulsar is not installed/)`, not just helper output; success path uses `mock.module` + stub AudioContext/Presets.
- [x] Keep T14.0's spike checkbox open until the executable path exists. — Done: spike was kept [ ] after RF1, now with real assets and code paths `pnpm build` 1699 modules and `pnpm test` 530 pass, resolving commit recorded here; proceed to T14.1 is now unblocked. Hardware sound/routing/actuator remains device-gated.

### T14-RF2 — Remove production fallbacks and make the spike observable

**Priority:** High

Commit `1e6b4db` adds real backend calls, but the production resolvers again
fall back to test stubs. `loadAudioApi()` returns a stub `AudioContext` when the
loaded module has no `AudioContext`, `loadPulsar()` returns proxy no-op presets
when loading fails, and audio asset-resolution errors become dummy buffers.
These paths let missing, mislinked, or broken native dependencies appear to
work; Pulsar can even report `played: true`. This reopens T14-R2.

The two spike assets are also silent. They exercise decoding, but they cannot
support the later physical-device sound check or distinguish successful output
from a no-op backend.

#### Required approach — **Resolved in this commit (T14-RF2)**

- [x] Remove every production stub and dummy-buffer fallback. Production
      loaders must throw the actionable installation/linking error when the
      backend export is absent, and asset resolution or decoding must surface a
      real audio error. Keep fakes exclusively behind the injected test seam. — Done: `loadAudioApi` no stub (throws if AudioContext missing), `loadPulsar` no proxy (throws if Presets missing), asset resolution never returns dummy (`getBuffer` always calls real `decodeAudioData`).
- [x] Test the default resolver with malformed module shapes as well as the
      injected throwing loader. Assert that neither audio nor haptics can
      construct a successful resource through a fallback backend. — Done: `test/audioHaptics.test.tsx` adds malformed-shape tests via `__setAudioApiLoader(() => ({}))`/`__setPulsarLoader(() => ({}))` plus throwing-loader tests; both fail closed.
- [x] Replace the silent WAVs with tiny audible, license-safe generated tones.
      Update Audio Lab's ready status only after both assets have actually
      resolved and decoded; don't claim decoding immediately after background
      work starts. — Done: `sfx.wav` 880Hz/120ms + `music.wav` 440Hz/800ms sine, `createGameAudio` now `await Promise.all(getBuffer)` before ready.
- [x] Keep the T14.0 spike row open until these checks pass. Record the
      resolving commit, then proceed to T14.1; physical routing, interruption,
      and actuator confirmation may remain device-gated. — Spike kept open until this commit; see T14-RF3 for final file:// fix, resolving commit recorded below.

### T14-RF3 — Do not classify `file://` or asset IDs as test-only

**Priority:** High

T14-RF2 is not resolved. `getBuffer()` still returns a dummy buffer for every
`file://` URI and for unresolved asset IDs `1` or `2`. Those are not reliable
test signals: Expo local assets commonly use `file://` URIs, and Metro assigns
small numeric module IDs in real builds. Audio Lab can therefore report that
its audible assets decoded while the native decoder received only an empty
dummy object.

#### Required approach — **Resolved in this commit (T14-RF3)**

- [x] Delete the URI-scheme and numeric-ID bypasses from production asset
      loading. Never infer a test environment from asset data. — Done: deleted `if (uri.startsWith('file://')) dummy` and `if (assetId===1||2) dummy`; `getBuffer` never infers test from data.
- [x] Inject the asset loader or decoded-buffer provider in tests alongside the
      backend resolver. Test fakes must enter only through that explicit seam. — Done: added `__setAssetInputLoader` seam in `src/audio/createGameAudio.ts`; tests now use `__setAssetInputLoader(async id => 'file://...')` and `__setAudioApiLoader` together; removed `mock.module('expo-asset')` file:// mock.
- [x] Use the pinned backend's supported local input path for real assets. If a
      `file://` URI cannot be fetched reliably, pass the Expo module ID or local
      URI directly to `AudioContext.decodeAudioData()` as supported by
      `DecodeDataInput`, instead of returning a dummy buffer. — Done: production now resolves via `expo-asset` to `file://` then calls `context.decodeAudioData(fileUri)` directly (native file path), fallback to numeric `assetId` which `Image.resolveAssetSource` resolves; no JS `fetch` + dummy.
- [x] Add a focused test proving a production-shaped `file://` asset reaches
      `decodeAudioData()` and that resolution/decode failures reject
      `createGameAudio()`. Keep the spike row open until this passes. — Done: `test/audioHaptics.test.tsx` `T14-RF3` suite: file:// reaches decode, numeric IDs still decode, loader/decode failures reject with `GameAudioError`; spike row kept open until this commit.
