/**
 * Compile-time fixture: deterministic sprite animation helpers.
 *
 * Type-checked by `pnpm typecheck`. The animation state is plain serializable
 * data advanced from fixed-step game time; clip names are inferred per
 * descriptor. Changing, pausing, restarting, or completing a clip returns a
 * new state object — it never mutates scene state or emits a side effect.
 */
import {
  advanceSpriteAnimation,
  startSpriteAnimation,
  type SpriteAnimationState,
} from '../../src/index';

import { gameAssets } from '../api/assetsManifest.types';

const player = gameAssets.gameplay.player;

// Clip names are typed against the descriptor's animation table.
const initial = startSpriteAnimation(player, 'idle');
const running = advanceSpriteAnimation(player, initial, 1 / 60);
const next = advanceSpriteAnimation(player, running, 16.7 / 1000);

// The state is serializable and carries the selected clip + elapsed time.
initial satisfies SpriteAnimationState;
running satisfies SpriteAnimationState;
const clip: 'idle' | 'run' | 'jump' = next.clip;
const elapsedMs: number = next.elapsedMs;
void clip;
void elapsedMs;

// One-shot behaviour uses the discriminated 'once' mode: the clip holds its
// final frame and reports completion; restarting is an explicit state change.
const jump = startSpriteAnimation(player, 'jump');
const jumpDone = advanceSpriteAnimation(player, jump, 1);
const completed: boolean = jumpDone.completed;
void completed;
