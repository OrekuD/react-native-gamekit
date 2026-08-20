export class GameAudioError extends Error {
  override name = 'GameAudioError';
  constructor(message: string) {
    super(message);
  }
}

export function createAudioInstallationError(): GameAudioError {
  return new GameAudioError(
    'react-native-audio-api is not installed. Run `npx expo install react-native-audio-api react-native-worklets` and rebuild with `npx expo prebuild` (or `expo run:ios` / `expo run:android`). See https://docs.swmansion.com/react-native-audio-api/docs/fundamentals/getting-started',
  );
}
