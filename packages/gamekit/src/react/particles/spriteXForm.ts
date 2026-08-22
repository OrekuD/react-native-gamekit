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
  /** Sampled uniform scale (scaleOverLife domain). */
  readonly scale: number;
  /** Authored draw size (definition particle.size). */
  readonly drawWidth: number;
  readonly drawHeight: number;
  /** Source frame size in sheet pixels. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export interface ParticleSpriteXform {
  readonly scos: number;
  readonly ssin: number;
  readonly tx: number;
  readonly ty: number;
}

export function particleSpriteXform(input: ParticleSpriteXformInput): ParticleSpriteXform {
  // T15-SF2: Atlas draws the SOURCE rect, so the authored-to-source ratio
  // must ride in scos/ssin or the drawn size ignores particle.size entirely.
  const effScale = input.scale * (input.drawWidth / input.frameWidth);
  const cos = Math.cos(input.rotation);
  const sin = Math.sin(input.rotation);
  // Center anchor pivot against the DRAWN (scaled source) extent.
  const px = (input.frameWidth / 2) * effScale;
  const py = (input.frameHeight / 2) * effScale;
  return {
    scos: effScale * cos,
    ssin: effScale * sin,
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
