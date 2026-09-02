/**
 * Mossy Cavern 2's presentation effects.
 *
 * Since T20.3 there is no session-keyed coordinator: the shell's
 * presentation binding owns the fixed-capacity system for one session
 * generation, binds the pure event→emission bridge below, and releases both
 * through the session's retirement path. The renderer receives the system as
 * a prop; the content component keeps only audio/haptics on the same events.
 */
import type { GameEventEnvelope, GameSession, GameSubscription } from 'rn-gamekit';
import { seedGameEvent } from 'rn-gamekit/events';
import {
  createParticleSystem,
  defineParticleEffect,
  type ParticleSystem,
} from 'rn-gamekit/particles';

export const mossyCavern2ParticleEffects = {
  dust: defineParticleEffect({
    capacity: 48,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 3, color: '#9bd47c' },
    burst: { count: 7 },
    lifetimeSeconds: { min: 0.2, max: 0.42 },
    speed: { min: 24, max: 68 },
    direction: { min: Math.PI * 0.72, max: Math.PI * 1.28 },
    gravity: { x: 0, y: 180 },
    fadeOut: true,
    // T20.1: explicit envelope for the memo's natural shrink intent that
    // `scaleOverLife` validation rejected (`{ min: 1, max: 0.35 }`).
    scale: { start: 1, end: 0.35 },
    rotation: { min: -2, max: 2 },
  }),
  dash: defineParticleEffect({
    capacity: 36,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'rectangle', width: 12, height: 3, color: '#b7f58c' },
    burst: { count: 12 },
    lifetimeSeconds: { min: 0.12, max: 0.25 },
    speed: { min: 80, max: 160 },
    direction: { min: Math.PI * 0.82, max: Math.PI * 1.18 },
    gravity: { x: 0, y: 0 },
    fadeOut: true,
    scaleOverLife: { min: 0.15, max: 1 },
    rotation: { min: -0.5, max: 0.5 },
  }),
  relic: defineParticleEffect({
    capacity: 48,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 4, color: '#e6ff9c' },
    burst: { count: 18 },
    lifetimeSeconds: { min: 0.34, max: 0.64 },
    speed: { min: 38, max: 112 },
    direction: { min: 0, max: Math.PI * 2 },
    gravity: { x: 0, y: -18 },
    fadeOut: true,
    scaleOverLife: { min: 0.2, max: 1.1 },
    rotation: { min: -3, max: 3 },
  }),
  slime: defineParticleEffect({
    capacity: 42,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 5, color: '#d8af5f' },
    burst: { count: 14 },
    lifetimeSeconds: { min: 0.22, max: 0.48 },
    speed: { min: 38, max: 110 },
    direction: { min: 0, max: Math.PI * 2 },
    gravity: { x: 0, y: 220 },
    fadeOut: true,
    scaleOverLife: { min: 0.25, max: 1 },
    rotation: { min: -4, max: 4 },
  }),
  damage: defineParticleEffect({
    capacity: 30,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'rectangle', width: 8, height: 8, color: '#ff7d6e' },
    burst: { count: 11 },
    lifetimeSeconds: { min: 0.18, max: 0.38 },
    speed: { min: 56, max: 144 },
    direction: { min: 0, max: Math.PI * 2 },
    gravity: { x: 0, y: 260 },
    fadeOut: true,
    scaleOverLife: { min: 0.4, max: 1 },
    rotation: { min: -5, max: 5 },
  }),
  completion: defineParticleEffect({
    capacity: 80,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 4, color: '#fff5a7' },
    burst: { count: 38 },
    lifetimeSeconds: { min: 0.5, max: 1.15 },
    speed: { min: 54, max: 168 },
    direction: { min: 0, max: Math.PI * 2 },
    gravity: { x: 0, y: 42 },
    fadeOut: true,
    scaleOverLife: { min: 0.15, max: 1.3 },
    rotation: { min: -2, max: 2 },
  }),
} as const;

export type MossyCavern2ParticleEffect = keyof typeof mossyCavern2ParticleEffects;

export type MossyCavern2ParticleSystem = ParticleSystem<typeof mossyCavern2ParticleEffects>;

/** The loose envelope shape the event bridge reads (name/tick/ordinal + payload). */
type MossyCavern2EventEnvelope = GameEventEnvelope<string, unknown>;

/** Fixed-capacity pool for one session generation (owned by the shell binding). */
export function createMossyCavern2ParticleSystem(): MossyCavern2ParticleSystem {
  return createParticleSystem({ effects: mossyCavern2ParticleEffects });
}

/**
 * Bind every committed gameplay event to its particle burst (T20.3): a pure
 * bridge over one session-scoped system. Audio/haptics remain bound by the
 * content component on the same events — both are presentation-only, so
 * cross-bridge ordering is irrelevant. Returns the subscriptions; the
 * binding's dispose removes them.
 */
export function bindMossyCavern2ParticleEvents(
  system: MossyCavern2ParticleSystem,
  session: Pick<GameSession, 'addGameEventListener'>,
): GameSubscription[] {
  const bind = (
    eventName: string,
    emit: (event: MossyCavern2EventEnvelope) => void,
  ): GameSubscription =>
    session.addGameEventListener(eventName as never, (event) => {
      if (system.status !== 'running') return;
      emit(event);
    });
  const at = (event: MossyCavern2EventEnvelope): { x: number; y: number } => {
    const payload = (event as { readonly payload: { readonly position: { readonly x: number; readonly y: number } } }).payload.position;
    return { x: payload.x, y: payload.y };
  };
  return [
    bind('jump', (event) => {
      system.emit('dust', { position: at(event), seed: seedGameEvent(event) });
    }),
    bind('dash', (event) => {
      const seed = seedGameEvent(event);
      system.emit('dash', { position: at(event), seed });
      system.emit('dust', { position: at(event), seed: seed + 1 });
    }),
    bind('slime-cleared', (event) => {
      system.emit('slime', { position: at(event), seed: seedGameEvent(event) });
    }),
    bind('relic-collected', (event) => {
      system.emit('relic', { position: at(event), seed: seedGameEvent(event) });
    }),
    bind('damage', (event) => {
      system.emit('damage', { position: at(event), seed: seedGameEvent(event) });
    }),
    bind('complete', (event) => {
      const seed = seedGameEvent(event);
      const position = { x: 3_606, y: 890 };
      system.emit('completion', { position, seed });
      system.emit('relic', { position, seed: seed + 1 });
    }),
  ];
}
