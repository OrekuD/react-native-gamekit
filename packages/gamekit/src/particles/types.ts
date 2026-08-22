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
 * The exclusive presentation-clock lease (T15-RF3).
 *
 * Exactly one owner may drive the clock. While a driver is held, public
 * `tick()` calls are rejected so ad-hoc callers can never double-advance
 * the system. The driver exposes an idle probe and a wake listener so the
 * scheduler can fully stop while nothing is active and resume on the next
 * accepted emission.
 */
export interface ParticleDriverHandle {
  /** Advance + resample. No-op while the owning system is paused/disposed. */
  step(deltaSeconds: number): void;
  /** True when every pool slot is inactive (scheduler may stop). */
  isIdle(): boolean;
  /** Observe emissions that may end an idle period; pass null to clear. */
  setWakeListener(listener: (() => void) | null): void;
  /** Release the exclusive lease; idempotent. */
  release(): void;
}

/**
 * The renderer-facing half of a particle system (T15-F1/F2/F6).
 *
 * A binding owns sampled, fixed-capacity buffers per effect. React views
 * are readers: they never advance the system. The clock itself is held by
 * exactly one driver acquired through `acquireDriver()`.
 */
export interface ParticlePresentationBinding {
  /** Generation of the owning system at bind time. */
  readonly systemGeneration: number;
  /** The frozen, validated definition for one effect. Throws when unknown. */
  definition(effect: string): ParticleEffectDefinition;
  /** All bound effect names (stable order). */
  readonly effects: readonly string[];
  /**
   * Manual advance for headless tests and custom drivers. Throws while a
   * driver owns the clock (T15-RF3); otherwise advances the active clock and
   * expires slots. A no-op while paused.
   */
  tick(deltaSeconds: number): void;
  /** Acquire the exclusive presentation clock. Throws while another owner holds it. */
  acquireDriver(): ParticleDriverHandle;
  /** Whether a driver currently holds the exclusive clock. */
  readonly driverOwned: boolean;
  /** Monotonic revision of the EMISSION REGISTRY (bumped on membership changes). */
  readonly registryRevision: number;
  /** Current accumulated ACTIVE time (freezes while paused). */
  readonly activeClock: number;
  /** Number of active slots summed over all effects (idle probe). */
  readonly activeCount: number;
  /**
   * Deeply frozen per-emission init records for one effect — the diagnostics/
   * readback surface. Positions derive analytically from activeClock.
   */
  emissions(effect: string): readonly ParticleEmissionRecord[];
  /** Build the bounded UI-runtime registry (frozen). Called on membership changes. */
  buildUiRegistry(): ParticleUiRegistry;
}

/**
 * Structural mirror of the React-layer frame snapshot, declared here so the
 * particle types stay renderer-agnostic.
 */
export interface ParticleFrameSnapshotLike {
  readonly revision: number;
  readonly effects: Readonly<
    Record<
      string,
      {
        readonly x: number[];
        readonly y: number[];
        readonly rotation: number[];
        readonly scale: number[];
        readonly opacity: number[];
        readonly visible: number[];
        readonly capacity: number;
      }
    >
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

/** Initial state for one emitted particle, in ACTIVE-time coordinates. */
export interface ParticleEmissionRecord {
  /** ACTIVE-clock time at which this particle was born. */
  readonly bornAt: number;
  readonly originX: number;
  readonly originY: number;
  readonly vx: number;
  readonly vy: number;
  readonly rotation: number;
  readonly rotationSpeed: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
  readonly lifetime: number;
  readonly spawnSequence: number;
}

/**
 * What the presentation layer transfers across the runtime boundary
 * (T15-SF1): bounded per-emission init records plus the scalar clock.
 * Transforms are computed analytically on the UI runtime.
 */
export interface ParticleUiRegistry {
  readonly registryRevision: number;
  readonly activeClock: number;
  readonly effects: Readonly<
    Record<string, { readonly capacity: number; readonly particles: readonly ParticleEmissionRecord[] }>
  >;
}
