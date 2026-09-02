/** Internal immutable state shapes used by the Mossy Cavern scene. */
import type { Camera2D } from 'rn-gamekit/camera2d';
import type { Aabb2D } from 'rn-gamekit/geometry';
import type { SpriteAnimationState } from 'rn-gamekit/sprites';

import type {
  MossyCollectibleSnapshot,
  MossyEnemySnapshot,
  MossyPlantSnapshot,
  PlayerPose,
} from './mossyCavernData.ts';

export interface MossyEnemyState extends MossyEnemySnapshot {
  readonly minX: number;
  readonly maxX: number;
  readonly speed: number;
  readonly animation: SpriteAnimationState<'bounce'>;
}

export interface MossyPlantState extends MossyPlantSnapshot {
  readonly animation: SpriteAnimationState<'sway'>;
}

export interface MossyCollectibleState extends MossyCollectibleSnapshot {
  readonly width: number;
  readonly height: number;
}

export interface CameraShakeState {
  readonly seed: number;
  readonly elapsed: number;
  readonly duration: number;
  readonly amplitude: number;
}

export interface MossyCavernState {
  readonly body: Aabb2D;
  readonly vx: number;
  readonly vy: number;
  readonly onGround: boolean;
  readonly facingRight: boolean;
  readonly pose: PlayerPose;
  readonly playerFrame: string;
  readonly playerAnimation: SpriteAnimationState<'play'>;
  readonly enemies: readonly MossyEnemyState[];
  readonly plants: readonly MossyPlantState[];
  readonly collectibles: readonly MossyCollectibleState[];
  readonly checkpointsReached: readonly boolean[];
  readonly checkpointIndex: number;
  readonly respawnBody: Aabb2D;
  readonly health: number;
  readonly crystals: number;
  readonly score: number;
  readonly falls: number;
  readonly elapsed: number;
  readonly bestTimeSeconds: number;
  readonly finished: boolean;
  readonly gameOver: boolean;
  readonly spawnCut: boolean;
  readonly ticks: number;
  readonly coyoteRemaining: number;
  readonly jumpBufferRemaining: number;
  readonly dashRemaining: number;
  readonly dashCooldown: number;
  readonly invulnerableRemaining: number;
  readonly baseCamera: Camera2D;
  readonly camera: Camera2D;
  readonly shake: CameraShakeState;
}
