# Sprite clip sampling and playback state

## Purpose and verdict

Select frames from explicit game time and represent playback as plain data. **Keep the small deterministic state helpers. Consolidate frame-selection logic; do not add a timeline engine, animation events on UI, or per-sprite clocks.**

Sources: [sampler](../../packages/gamekit/src/sprites/sampleSpriteClip.ts), [playback state](../../packages/gamekit/src/sprites/spriteAnimationState.ts), [Sprite](../../packages/gamekit/src/react/sprites/Sprite.tsx), [GameSprite](../../packages/gamekit/src/react/sprites/GameSprite.tsx), [clip validation](../../packages/gamekit/src/assets/validation.ts).

## What is already good

Animation advances from an explicit delta, pauses without advancing, clamps one-shot completion, and keeps looping elapsed time bounded. Gameplay-significant completion can stay in the simulation. Sampling does not depend on device refresh rate. These are sufficient building blocks for the current games.

## GS-ANIMATION-01 — P2: three samplers have diverging behavior

**Evidence: source-confirmed.** The headless sampler normalizes a negative loop index back into the frame range. `Sprite` and `spriteFrameNameForClip` in `GameSprite` duplicate the arithmetic but fall back to the first frame for a negative modulo. Unknown clips are treated differently: playback helpers throw, direct Sprite can hide, and GameSprite returns the clip string as if it were a frame name. Direct `sampleSpriteClipFrame` for a one-shot negative elapsed time returns a negative index while its frame-name wrapper falls back to frame zero.

**Resolve:** choose one explicit time and unknown-selection contract. Use the existing pure worklet-safe sampler from both renderer paths. Validate author-defined clips at declaration/binding time; keep absent/unpublished selection distinct from an invalid clip. Prefer rejecting unsupported negative/non-finite raw elapsed values or defining clamping uniformly. Do not retain fallback-to-first-frame behavior just because it masks invalid data.

**Acceptance:** the same clip/time produces identical indices and names through headless, Sprite, and GameSprite paths for zero, exact boundaries, loop wrap, one-shot completion, negative time according to policy, and unknown clips. Test actual component callback execution as well as helper arithmetic.

## GS-ANIMATION-02 — P2: “worklet” annotation is not a complete worklet call graph

**Evidence: source-confirmed risk.** `clipOf` is workletized but creates `new GameAssetError`, whose class constructor is ordinary JS. Valid inputs avoid this branch, so happy-path tests can pass while error handling fails on UI. `startSpriteAnimation` also accepts any string generic independent of the descriptor's clip keys; the documentation promises more inference than that signature supplies.

**Resolve:** decide which public playback operations truly need UI execution. For operations intended only for fixed-step simulation, remove misleading UI promises rather than exporting another error transport. For genuine worklet helpers, keep their complete reachable call graph supported, including invalid-input branches. Constrain clip names to descriptor animation keys where inference permits, preserving a runtime check for untyped callers.

**Acceptance:** negative compile fixtures reject misspelled clips; public worklet helpers execute both success and failure paths on the installed UI runtime with an actionable error. Do not rely solely on a source search for `'worklet'`.

## Performance and deletions

Delete duplicated frame arithmetic before optimizing. Playback records returning the same identity when paused/completed are useful. No additional allocation pool is justified for these tiny immutable state transitions. Keep animation completion in scene update; presentation sampling must not emit gameplay events. Preserve [spriteAnimation.test.ts](../../packages/gamekit/test/spriteAnimation.test.ts), [spriteFrameRect.test.ts](../../packages/gamekit/test/spriteFrameRect.test.ts), and animation API fixtures.
