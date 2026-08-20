export class GameHapticsError extends Error {
  override name = 'GameHapticsError';
  constructor(message: string) {
    super(message);
  }
}

export function createHapticsInstallationError(): GameHapticsError {
  return new GameHapticsError(
    'react-native-pulsar is not installed. Run `npx expo install react-native-pulsar react-native-worklets` and rebuild with `npx expo prebuild` (or `expo run:ios` / `expo run:android`). See https://github.com/software-mansion/pulsar',
  );
}
