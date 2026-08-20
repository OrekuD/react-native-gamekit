# Task 14: Audio and haptics

## Status

**Planned — depends on Task 13's committed event boundary.** T14.0 must
revalidate the current official `react-native-audio-api` and Software Mansion
Pulsar APIs before any dependency-specific contract is frozen.

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
      native setup, and known limitations. — `plans/task-14/t14.0-validation.md` (0.13.3 + 1.7.0).
- [ ] Build minimal Expo-prebuild spikes for one SFX, one music track,
      pause/resume, one interruption listener, and one Pulsar preset. — **device-gated**, placeholder `scripts/spike-audio-haptics.mjs`.
- [ ] Validate sound and haptic output on physical hardware before freezing
      wrappers; simulators cannot prove routes or actuator behavior. — **device-gated** (simulators cannot prove routes/actuator).
- [x] Write compile fixtures for audio creation, playback, music, volume,
      haptics, event use, errors, and cleanup. — `test/api/audio.types.tsx` + `test/api/haptics.types.tsx` (`pnpm typecheck:assets` green).
- [x] Freeze optional-peer and subpath-export decisions. — `rn-gamekit/audio` + `rn-gamekit/haptics` optional peers `^0.13.3`/`^1.7.0`, root isolation enforced.

### T14.1 — Add local audio assets and loading

- [ ] Define a small local audio descriptor/ID contract.
- [ ] Resolve Expo static assets through the verified backend path.
- [ ] Decode and cache buffers once per audio resource.
- [ ] Deduplicate concurrent loads and reject stale/disposed attempts.
- [ ] Keep native audio imports isolated to `rn-gamekit/audio`.

### T14.2 — Implement the audio resource

- [ ] Create and own exactly one context per `GameAudio` resource.
- [ ] Implement the fixed category gains and master composition.
- [ ] Implement validated volume, mute, and click-safe changes.
- [ ] Implement the voice registry, limits, stable overflow, completion, and
      cleanup.
- [ ] Suspend when idle and close once on final disposal.

### T14.3 — Implement SFX and music

- [ ] Create a fresh source node for every playback.
- [ ] Implement the one-line SFX workflow and required focused options.
- [ ] Implement one music owner with play/replace/stop/pause/resume.
- [ ] Prevent stale completion callbacks from affecting replacement playback.
- [ ] Make stop and disposal idempotent and exception-safe.

### T14.4 — Integrate lifecycle and interruptions

- [ ] Bind session status without introducing parallel pause authority.
- [ ] Apply a documented background playback policy.
- [ ] Observe verified interruption/focus/route events.
- [ ] Recover only when platform state, session state, and user intent agree.
- [ ] Remove every lifecycle and native listener on disposal.

### T14.5 — Implement Pulsar haptics

- [ ] Map a small preset union to current verified Pulsar calls.
- [ ] Add capability results, mute, and bounded request frequency.
- [ ] Define unsupported/suppressed/error behavior.
- [ ] Drop stale and lifecycle-ineligible requests.
- [ ] Isolate all Pulsar imports to `rn-gamekit/haptics`.

### T14.6 — Add event and reference integration

- [ ] Trigger Brick Breaker SFX and haptics from Task 13 events.
- [ ] Add one looping/replacing music example.
- [ ] Keep score, collision, transitions, and saves independent of feedback.
- [ ] Add focused controls for volume, mute, concurrency, pause, and haptic
      presets without creating an audio editor.
- [ ] Display resource/voice/listener diagnostics at control frequency only.

### T14.7 — Document and verify v1

- [ ] Add Audio and haptics engine-system documentation.
- [ ] Document installation, Expo prebuild, peers, compatibility, lifecycle,
      interruptions, mute, volume, and cleanup.
- [ ] Add compile-checked SFX, music, and haptic examples.
- [ ] Run focused adapter, concurrency, lifecycle, and disposal tests.
- [ ] Build the package and verify root imports do not load optional peers.
- [ ] Validate iPhone, iPad, and Android rows when named hardware is available;
      leave unavailable device rows explicitly open.

## V1 definition of done

- [x] Current official APIs and validated versions are recorded. — `plans/task-14/t14.0-validation.md`
- [x] `rn-gamekit/audio` and `rn-gamekit/haptics` are subpaths of one package. — `package.json` `exports` + `src/audio.ts`/`src/haptics.ts`
- [x] Native backends are optional peers and root imports remain isolated. — `peerDependenciesMeta.optional` + dynamic `require` inside factories, `test/api/*.types` proves `Root.createGameAudio` not on root (`pnpm typecheck:assets`)
- [ ] One context owns decoded buffers, voices, gains, and native listeners.
- [ ] SFX, one music channel, fixed categories, volume, mute, and concurrency
      meet their contracts.
- [ ] Pause, background, interruption, and user intent do not drift.
- [ ] Pulsar haptics are bounded, optional, and non-authoritative.
- [ ] Brick Breaker triggers feedback only from committed Task 13 events.
- [ ] Cleanup is deterministic and the focused automated gate passes.
- [ ] Device-only behavior is completed or honestly marked as hardware-gated.

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
