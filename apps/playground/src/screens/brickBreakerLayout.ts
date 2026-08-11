/**
 * Brick Breaker's interaction layout contract (T8.1).
 *
 * The screen is two sibling regions inside the safe-area screen: the top bar
 * (back control + centered title) and the gameplay stage. The start/restart
 * surface is absolutely filled INSIDE the stage only; the back control lives
 * in the top bar and maps to exit — never to gameplay input. The screen
 * component renders from this contract, so the headless test below and the
 * native hit-testing acceptance check validate the same structure.
 */
export const BRICK_BREAKER_LAYOUT = {
  topBar: {
    testID: 'brick-breaker-top-bar',
    back: { testID: 'brick-breaker-back', action: 'exit' as const },
    title: 'Brick Breaker',
  },
  stage: {
    testID: 'brick-breaker-stage',
    startSurface: { testID: 'brick-breaker-start-surface', action: 'start' as const },
  },
} as const;
