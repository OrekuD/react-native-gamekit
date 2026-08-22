import type { Point2D } from '../geometry/types';

export type ParticleSpace = 'world' | 'screen';
export type ParticleOverflow = 'drop-new' | 'recycle-oldest';
export type ParticleKind = 'sprite' | 'shape';
export type ShapeKind = 'circle' | 'rectangle';

export interface Range { readonly min: number; readonly max: number; }

export interface SpriteParticleConfig {
  readonly kind: 'sprite';
  readonly sheet: string;
  readonly frame: string;
  readonly size: { readonly width: number; readonly height: number };
}

export interface ShapeParticleConfig {
  readonly kind: 'shape';
  readonly shape: ShapeKind;
  readonly radius?: number;
  readonly width?: number;
  readonly height?: number;
  readonly color?: string;
}

export type ParticleConfig = SpriteParticleConfig | ShapeParticleConfig;

export interface ParticleEffectDefinition {
  readonly capacity: number;
  readonly space: ParticleSpace;
  readonly overflow: ParticleOverflow;
  readonly particle: ParticleConfig;
  readonly burst: { readonly count: number };
  readonly lifetimeSeconds: Range;
  readonly speed: Range;
  readonly direction?: Range;
  readonly gravity: Point2D;
  readonly fadeOut: boolean;
  readonly scaleOverLife?: Range;
  readonly rotation?: Range;
}

export interface ParticleEmitCommand {
  readonly position: Point2D;
  readonly seed: number;
}

export interface ParticleSystemOptions {
  readonly effects: Record<string, ParticleEffectDefinition>;
}

export interface ParticleDiagnostics {
  readonly active: number;
  readonly emitted: number;
  readonly dropped: number;
  readonly recycled: number;
}

export interface ParticleSlot {
  active: boolean;
  age: number;
  lifetime: number;
  origin: Point2D;
  position: Point2D;
  velocity: Point2D;
  rotation: number;
  rotationSpeed: number;
  scale: number;
  scaleStart: number;
  scaleEnd: number;
  opacity: number;
  color: string;
  spawnSequence: number;
  effect: string;
}

export interface ParticleSystem<TEffects extends Record<string, ParticleEffectDefinition> = Record<string, ParticleEffectDefinition>> {
  emit<K extends keyof TEffects & string>(effect: K, command: ParticleEmitCommand): void;
  update(deltaSeconds: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  getDiagnostics(effect?: keyof TEffects & string): ParticleDiagnostics;
  getActiveParticles(effect: keyof TEffects & string): readonly ParticleSlot[];
  readonly isPaused: boolean;
  readonly isDisposed: boolean;
  readonly generation: number;
}
