import type { Point2D } from '../geometry/types';

export type ParticleSpace = 'world' | 'screen';
export type ParticleOverflow = 'drop-new' | 'recycle-oldest';
export type ParticleKind = 'sprite' | 'shape';
export type ShapeKind = 'circle' | 'rectangle';

export interface Range {
  readonly min: number;
  readonly max: number;
}

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
  /** Center position of the burst origin (the anchor convention for every kind). */
  readonly position: Point2D;
  readonly seed: number;
}

export interface ParticleSystemOptions {
  readonly effects: Record<string, ParticleEffectDefinition>;
}

/**
 * Frozen diagnostic counters. Semantics are per particle:
 * - `emitted`: particles actually placed into a slot this burst (fresh OR
 *   recycled).
 * - `dropped`: particles never placed — overflow under `drop-new`, plus every
 *   particle of a burst rejected while paused.
 * - `recycled`: placed particles whose slot was previously occupied.
 */
export interface ParticleDiagnostics {
  readonly active: number;
  readonly emitted: number;
  readonly dropped: number;
  readonly recycled: number;
}

/** A frozen, sampled view of one active particle (safe for consumers). */
export interface ParticleSlotSnapshot {
  readonly active: boolean;
  readonly age: number;
  readonly lifetime: number;
  readonly origin: Point2D;
  readonly position: Point2D;
  readonly velocity: Point2D;
  readonly rotation: number;
  readonly scale: number;
  readonly opacity: number;
  readonly color: string;
  readonly spawnSequence: number;
  readonly effect: string;
}

export interface ParticleSystem<
  TEffects extends Record<string, ParticleEffectDefinition> = Record<string, ParticleEffectDefinition>,
> {
  /** Validate + place a burst. Throws for unknown effect or malformed command, even while paused. */
  emit<K extends keyof TEffects & string>(effect: K, command: ParticleEmitCommand): void;
  /** Advance the clock; a no-op while paused. */
  update(deltaSeconds: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  getDiagnostics(effect?: keyof TEffects & string): ParticleDiagnostics;
  /**
   * Frozen snapshots of active slots. Mutating the returned objects can never
   * affect controller state (T15-F6).
   */
  getActiveParticles(effect: keyof TEffects & string): readonly ParticleSlotSnapshot[];
  /** Session-lifecycle helpers: idempotent transitions that never throw on already-paused/running. */
  pauseIfRunning(): void;
  resumeIfPaused(): void;
  /** 'running' | 'paused' | 'disposed' — read once per decision point. */
  readonly status: 'running' | 'paused' | 'disposed';
  /**
   * Typed presentation binding for renderers (T15-F6): exposes frozen
   * definitions plus fixed-capacity sample buffers without revealing pool
   * internals. One binding per renderer generation; creating it does not
   * start any clock.
   */
  bindPresentation(): ParticlePresentationBinding;
}

/**
 * The renderer-facing half of a particle system (T15-F1/F2/F6).
 *
 * A binding owns sampled, fixed-capacity buffers per effect and exactly one
 * presentation clock. React views are readers: they never advance the
 * system, and any number of views may observe one binding. Buffers are
 * plain `Float32Array`s so the React layer can mirror them onto the UI
 * runtime with a single small write per revision.
 */
export interface ParticlePresentationBinding {
  /** Generation of the owning system at bind time. */
  readonly systemGeneration: number;
  /** The frozen, validated definition for one effect. Throws when unknown. */
  definition(effect: string): ParticleEffectDefinition;
  /** All bound effect names (stable order). */
  readonly effects: readonly string[];
  /**
   * Advance the clock and resample every buffer. One call advances every
   * effect exactly once regardless of how many views observe them.
   * A true no-op while paused or when no particle is active (revision does
   * not move).
   */
  tick(deltaSeconds: number): void;
  /** Start the single presentation clock. Throws if already started. */
  start(schedule: (tick: () => void) => () => void, stepSeconds?: number): void;
  /** Stop the clock; idempotent. */
  stop(): void;
  /** Whether the presentation clock currently runs. */
  readonly running: boolean;
  /** Monotonic revision bumped only when a resample changed visible state. */
  readonly revision: number;
  /**
   * Fixed-capacity sample buffers for one effect. Positions follow the
   * center-anchor convention; `scale` folds into rendered size by the view.
   */
  slots(effect: string): ParticleSlotBuffers;
}

/**
 * Structural mirror of the React-layer frame snapshot, declared here so the
 * particle types stay renderer-agnostic.
 */
export interface ParticleFrameSnapshotLike {
  readonly revision: number;
  readonly data: ReadonlyMap<
    string,
    {
      readonly x: Float32Array;
      readonly y: Float32Array;
      readonly rotation: Float32Array;
      readonly scale: Float32Array;
      readonly opacity: Float32Array;
      readonly visible: Uint8Array;
    }
  >;
}

/** Fixed-capacity presentation buffers for one effect (T15-F2). */
export interface ParticleSlotBuffers {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly rotation: Float32Array;
  readonly scale: Float32Array;
  readonly opacity: Float32Array;
  readonly visible: Uint8Array;
  readonly capacity: number;
}
