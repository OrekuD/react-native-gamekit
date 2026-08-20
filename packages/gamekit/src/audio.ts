/**
 * Subpath entry for `rn-gamekit/audio`.
 * Importing `rn-gamekit` or `rn-gamekit/react` must not load this module.
 */
export { createGameAudio } from './audio/createGameAudio';
export { GameAudioError } from './audio/errors';
export type {
  AudioCategory,
  AudioSoundRecord,
  CreateGameAudioOptions,
  GameAudio,
  GameAudioPlayOptions,
} from './audio/types';
