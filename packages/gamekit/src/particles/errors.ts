export class ParticleError extends Error {
  override name = 'ParticleError';
  constructor(message: string) {
    super(message);
  }
}
