/**
 * Game event payload validation errors (T13).
 *
 * Every rejection identifies the event name and the exact payload path
 * that caused the failure. The payload never captures React or native
 * handles, sparse holes, cycles, or non-finite numbers.
 */
export class GameEventError extends Error {
  override readonly name = 'GameEventError';

  constructor(message: string) {
    super(message);
  }
}
