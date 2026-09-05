# Task 20.4 — development-build smoke flow and device record

This record defines the development-build smoke flow for the reference games
and is the place to record each physical run. The automated portion of T20.4
(effect-table gates, selector tests, presentation-binding lifecycle) already
runs in Node; this flow covers only what Node cannot prove: real Skia
rendering, real haptics, real app lifecycle transitions, and real frame
pacing.

## Build and run

From the repository root:

```sh
pnpm expo:prebuild        # once, or after native config changes
pnpm ios                  # build + run the playground on iOS
pnpm android              # build + run the playground on Android
```

Both commands produce development builds. Expo export remains a packaging
gate only and never counts as a runtime claim.

## Smoke flow (one pass per game, per device)

Open the playground home, then for each game below perform the steps in
order and note any deviation. The tap targets are stable `testID`s.

Pause scope (T20F-R6): manual pause/resume taps are exercised on the three
Mossy Cavern games, which have pause controls. Brick Breaker has no manual
pause control; its pause/resume coverage comes from the app background and
foreground transitions, which pause and start the session through the same
lifecycle path.

### Brick Breaker

1. Open Brick Breaker from the home list.
2. Drag the paddle and keep a rally alive for at least three brick hits;
   each hit must burst particles that shrink as they age.
3. Background the app mid-rally, then foreground it: the session pauses in
   the background and resumes without a time jump. (Brick Breaker has no
   manual pause control, so background/foreground is its pause coverage.)
4. Exit with the back control (`brick-breaker-back`).

### Mossy Cavern

1. Open Mossy Cavern from the home list.
2. Tap jump (`mossy-cavern-jump`) and dash (`mossy-cavern-dash`): dust and
   trail bursts must appear and shrink.
3. Pause with `mossy-cavern-pause`: active bursts freeze immediately and no
   new bursts appear from further taps.
4. Resume with the same control: frozen bursts continue from the same age.
5. Background and foreground the app mid-burst: the freeze/resume behavior
   must match step 3 and step 4.
6. Exit mid-burst with `mossy-cavern-back`, then reopen the game: the new
   session must start with an empty pool (no stale bursts).

### Mossy Cavern 2

1. Open Mossy Cavern 2 from the home list.
2. Tap jump (`mossy-cavern-2-jump`) and dash (`mossy-cavern-2-dash`): dust
   and dash bursts must appear; relic and slime pickups burst when reached.
3. Pause with `mossy-cavern-2-pause`, then resume: bursts freeze and
   continue as in the Mossy Cavern steps.
4. Background and foreground mid-burst.
5. Exit with `mossy-cavern-2-back`, then reopen: no stale bursts.

### Mossy Cavern 3

1. Open Mossy Cavern 3 from the home list.
2. Tap jump (`mossy-cavern-3-jump`) and dash (`mossy-cavern-3-dash`): dust
   bursts must appear on takeoff, landing, and dash.
3. Pause with `mossy-cavern-3-pause`, then resume: bursts freeze and
   continue; haptics stay silent while paused.
4. Background and foreground mid-burst.
5. Exit with `mossy-cavern-3-back`, then reopen: no stale bursts.

## Expected observations

Manual pause/resume observations apply to the three Mossy Cavern games;
background/foreground observations apply to all games including Brick
Breaker.

- Particles appear for every triggered action and visibly shrink (explicit
  envelopes) instead of growing.
- Manual pause (Mossy Cavern games) freezes active particles immediately;
  emissions while paused are dropped; resume continues at the same age with
  no catch-up jump.
- Backgrounding pauses (all games); foregrounding resumes; no suspended-time
  debt.
- Haptics are silent while paused or backgrounded and resume afterwards.
- No ghost particles after expiry; a reused slot never shows the previous
  burst.
- Exiting and reopening always starts from an empty pool.

## Device matrix

One supported physical iOS device and one supported physical Android device
block native-runtime completion. iPad and 120 Hz rows block only tablet or
high-refresh performance claims; when unavailable, record them as residual
risk instead.

| Device | OS version | Refresh rate | Build type | Date | Result | Tester |
| --- | --- | --- | --- | --- | --- | --- |
| Supported iPhone | _pending_ | _pending_ | dev build | _pending_ | _pending_ | _pending_ |
| Supported iPad (portrait) | _pending_ | _pending_ | dev build | _pending_ | _pending_ | _pending_ |
| Supported iPad (landscape) | _pending_ | _pending_ | dev build | _pending_ | _pending_ | _pending_ |
| Mid-range Android phone | _pending_ | _pending_ | dev build | _pending_ | _pending_ | _pending_ |
| 120 Hz device (conditional) | _pending_ | 120 Hz | dev build | _pending_ | _pending_ | _pending_ |

## GS-REACT-03 — Buffer Probe (slot publication)

The Buffer Probe screen (`buffer-probe` in the catalog) is a deterministic
native-integration reproduction: one lab timer advances a synthetic commit,
pans the viewport 1px per frame, and emits a 6-particle puff every 30 ticks.
Three Atlas systems change ONLY their buffer-slot contents per frame — a
fixed-count (8) orbiting sprite batch, a scrolling 40x12 tile layer, and a
looping sprite emitter. No session, no camera, no React state per frame, no
alpha-driven visuals. Installed versions for any run: Skia 2.11.0,
Reanimated 4.5.3, Worklets 0.10.3 — record the exact versions and build type
with the result.

1. Open Buffer Probe from the home list.
2. Watch for 20 seconds without touching anything:
   a. The 8 orbiters circle smoothly around the center.
   b. Tiles scroll left with the pan (brick teeth every fourth column make
      motion obvious); the wraparound jump every ~10 seconds must also draw.
   c. Puffs rise from the emission point and fade continuously.
3. Any layer sitting frozen while the others move means that layer's buffer
   writes are not notifying the native renderer — record which layers move
   and which freeze, per device, in the matrix notes.
4. Exit with `buffer-probe-back`, reopen, and confirm the same behavior (no
   stale slots from the previous mount).

## Coverage note

The headless equivalents of this flow are already enforced: every reference
game constructs its real particle system and emits every authored effect in
its gate test, the presentation binding attaches and releases through the
shell controller tests, and the presentation hook's pause/resume behavior is
covered by mounted lifecycle tests. This flow exists to verify the parts
those tests cannot: real Skia draws, real haptics, real app lifecycle
transitions, and real frame pacing.

## Residual risk

Until the required rows above are recorded, native-runtime behavior of the
particle and haptic lifecycle work remains unverified. This blocks only the
native-runtime claim; it does not block unrelated headless changes.
