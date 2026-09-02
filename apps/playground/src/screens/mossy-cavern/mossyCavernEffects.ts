/**
 * Mossy Cavern's presentation effects.
 *
 * The simulation emits typed events; this module holds the frozen effect
 * definitions plus the two pure pieces the React tree needs: a screen-local
 * context that carries the content-owned particle system to the renderer,
 * and the deterministic event→emission bridge. Since T20.3 there is no
 * module-global coordinator: the content component owns the system, follows
 * its session through `useGameLifecycleSource()` + `useParticlePresentation`,
 * and disposes it with its own cleanup.
 */
import type { GameSession, GameSubscription } from 'rn-gamekit';
import { seedGameEvent } from 'rn-gamekit/events';
import {
  createParticleSystem,
  defineParticleEffect,
  type ParticleSystem,
} from 'rn-gamekit/particles';

export const mossyCavernParticleEffects = {
  jumpDust: defineParticleEffect({
    capacity: 96,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 4, color: '#b8d99a' },
    burst: { count: 10 },
    lifetimeSeconds: { min: 0.2, max: 0.42 },
    speed: { min: 20, max: 88 },
    direction: { min: Math.PI, max: Math.PI * 2 },
    gravity: { x: 0, y: 190 },
    fadeOut: true,
    scaleOverLife: { min: 0.65, max: 1.25 },
  }),
  dashTrail: defineParticleEffect({
    capacity: 128,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'rectangle', width: 10, height: 4, color: '#69d6c2' },
    burst: { count: 7 },
    lifetimeSeconds: { min: 0.14, max: 0.3 },
    speed: { min: 12, max: 45 },
    direction: { min: 0, max: Math.PI * 2 },
    gravity: { x: 0, y: 30 },
    fadeOut: true,
    // T20.1: explicit envelope for the memo's intended `{ min: 0.9, max: 0.35 }`
    // shrink (previously an ascending growth fallback).
    scale: { start: 0.9, end: 0.35 },
    rotation: { min: -0.25, max: 0.25 },
  }),
  crystalBurst: defineParticleEffect({
    capacity: 128,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 5, color: '#8ce8ff' },
    burst: { count: 14 },
    lifetimeSeconds: { min: 0.28, max: 0.62 },
    speed: { min: 70, max: 170 },
    gravity: { x: 0, y: 130 },
    fadeOut: true,
    // T20.1: shard burst shrinks instead of the ascending fallback.
    scale: { start: 0.7, end: 0.15 },
  }),
  hitBurst: defineParticleEffect({
    capacity: 96,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'rectangle', width: 7, height: 7, color: '#f29b77' },
    burst: { count: 16 },
    lifetimeSeconds: { min: 0.2, max: 0.48 },
    speed: { min: 75, max: 180 },
    direction: { min: 0, max: Math.PI * 2 },
    gravity: { x: 0, y: 240 },
    fadeOut: true,
    // T20.1: impact burst shrinks instead of the ascending fallback.
    scale: { start: 1, end: 0.25 },
    rotation: { min: -1, max: 1 },
  }),
  checkpointBurst: defineParticleEffect({
    capacity: 160,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 4, color: '#d5f28a' },
    burst: { count: 20 },
    lifetimeSeconds: { min: 0.45, max: 0.9 },
    speed: { min: 60, max: 155 },
    gravity: { x: 0, y: 95 },
    fadeOut: true,
    scaleOverLife: { min: 0.45, max: 1.1 },
  }),
  finishBurst: defineParticleEffect({
    capacity: 256,
    space: 'world',
    overflow: 'recycle-oldest',
    particle: { kind: 'shape', shape: 'circle', radius: 5, color: '#f5d66b' },
    burst: { count: 44 },
    lifetimeSeconds: { min: 0.6, max: 1.25 },
    speed: { min: 80, max: 240 },
    gravity: { x: 0, y: 170 },
    fadeOut: true,
    // T20.1: finish confetti shrinks instead of the ascending fallback.
    scale: { start: 0.6, end: 0.1 },
  }),
} as const;

export type MossyCavernParticleEffect = keyof typeof mossyCavernParticleEffects;

export type MossyCavernParticleSystem = ParticleSystem<typeof mossyCavernParticleEffects>;

interface PositionPayload {
  readonly x: number;
  readonly y: number;
}

/**
 * Bind every committed gameplay event to its particle burst (T20.3): a pure
 * bridge over one session-scoped system owned by the shell's presentation
 * binding. Returns the subscriptions; the binding's dispose removes them.
 */
export function bindMossyCavernParticleEvents(
  system: MossyCavernParticleSystem,
  session: Pick<GameSession, 'addGameEventListener'>,
): GameSubscription[] {
  const bind = (eventName: string, effect: MossyCavernParticleEffect): GameSubscription =>
    session.addGameEventListener(eventName as never, (event) => {
      if (system.status !== 'running') return;
      const payload = (event as { readonly payload: PositionPayload }).payload;
      system.emit(effect, {
        position: { x: payload.x, y: payload.y },
        seed: seedGameEvent(event),
      });
    });
  return [
    bind('jump', 'jumpDust'),
    bind('dash', 'dashTrail'),
    bind('crystal', 'crystalBurst'),
    bind('enemy-defeated', 'crystalBurst'),
    bind('player-hit', 'hitBurst'),
    bind('fall', 'hitBurst'),
    bind('checkpoint', 'checkpointBurst'),
    bind('finish', 'finishBurst'),
    bind('game-over', 'hitBurst'),
  ];
}

/** Fixed-capacity pool for the content component; one per session generation. */
export function createMossyCavernParticleSystem(): MossyCavernParticleSystem {
  return createParticleSystem({ effects: mossyCavernParticleEffects });
}
