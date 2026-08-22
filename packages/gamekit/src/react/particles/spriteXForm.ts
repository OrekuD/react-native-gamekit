/**
 * Particle sprite transform (T15-RF4).
 *
 * Atlas RSXform carries rotation AND uniform scale in its 2×2 part:
 * \`scos = s·cosθ\`, \`ssin = s·sinθ\`. The pivot compensation uses the
 * AUTHORED draw size (the definition's \`size\`), and the source rect stays
 * the sheet frame — so the authored-to-source ratio scales the drawn sprite.
 *
 * v1 requires the authored size ratio to match the source frame ratio; a
 * mismatch is a structured error (RSXform cannot express nonuniform scale).
 */
import { ParticleError } from '../../particles/errors';

export interface ParticleSpriteXformInput {
  /** Sampled CENTER position (surface or world units). */
  readonly x: number;
  readonly y: number;
  /** Sampled rotation in radians. */
  readonly rotation: number;
  /** Sampled uniform scale. */
  readonly scale: number;
  /** Authored draw size (definition particle.size). */
  readonly drawWidth: number;
  readonly drawHeight: number;
}

export interface ParticleSpriteXform {
  readonly scos: number;
  readonly ssin: number;
  readonly tx: number;
  readonly ty: number;
}

export function particleSpriteXform(input: ParticleSpriteXformInput): ParticleSpriteXform {
  const cos = Math.cos(input.rotation);
  const sin = Math.sin(input.rotation);
  // Center anchor: half of the authored draw size.
  const px = (input.drawWidth / 2) * input.scale;
  const py = (input.drawHeight / 2) * input.scale;
  return {
    scos: input.scale * cos,
    ssin: input.scale * sin,
    tx: input.x - px * cos + py * sin,
    ty: input.y - px * sin - py * cos,
  };
}

/**
 * Validate that the authored size ratio matches the source frame ratio so
 * uniform-scale Atlas drawing preserves the intended aspect.
 */
export function assertUniformParticleSpriteRatio(
  drawWidth: number,
  drawHeight: number,
  frameWidth: number,
  frameHeight: number,
): void {
  const drawRatio = drawWidth / drawHeight;
  const frameRatio = frameWidth / frameHeight;
  if (!Number.isFinite(drawRatio) || !Number.isFinite(frameRatio) || Math.abs(drawRatio - frameRatio) > 1e-3) {
    throw new ParticleError(
      `[rn-gamekit/particles] sprite effect size ${drawWidth}x${drawHeight} does not match source frame ${frameWidth}x${frameHeight} aspect — nonuniform sprite scaling is not supported in v1`,
    );
  }
}
