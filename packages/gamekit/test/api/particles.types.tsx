import { defineParticleEffect, createParticleSystem } from 'rn-gamekit/particles';

// Definitions are plain values
const brickBurst = defineParticleEffect({
  capacity: 96,
  space: 'world',
  overflow: 'recycle-oldest',
  particle: { kind: 'sprite', sheet: 'effects', frame: 'spark', size: { width: 8, height: 8 } },
  burst: { count: 12 },
  lifetimeSeconds: { min: 0.25, max: 0.55 },
  speed: { min: 70, max: 150 },
  gravity: { x: 0, y: 180 },
  fadeOut: true,
});

const shapeBurst = defineParticleEffect({
  capacity: 32,
  space: 'screen',
  overflow: 'drop-new',
  particle: { kind: 'shape', shape: 'circle', radius: 4, color: '#ff0000' },
  burst: { count: 8 },
  lifetimeSeconds: { min: 0.3, max: 0.6 },
  speed: { min: 80, max: 120 },
  gravity: { x: 0, y: 100 },
  fadeOut: true,
});

void brickBurst;
void shapeBurst;

// System preserves literal keys
const particles = createParticleSystem({
  effects: { brickBurst: brickBurst, shapeBurst: shapeBurst } as const,
});
type Keys = typeof particles extends { emit: (e: infer K, ...args: unknown[]) => void } ? K : never;
const _k: 'brickBurst' | 'shapeBurst' = 'brickBurst' as Keys & string;
void _k;

// Emit with position and seed
particles.emit('brickBurst', { position: { x: 10, y: 20 }, seed: 123 });

// Diagnostics
const d = particles.getDiagnostics('brickBurst');
void d.active;
void d.emitted;

// Root must not export particle factories
import * as Root from 'rn-gamekit';
void Root.createGameSession;
const rootHasParticles: 'createParticleSystem' extends keyof typeof Root ? true : false = false;
void rootHasParticles;

particles.dispose();

// Unknown effect key must fail at compile time
// @ts-expect-error unknown effect
particles.emit('unknown', { position: { x: 0, y: 0 }, seed: 0 });
