/**
 * Brick Breaker's interaction layout contract (T8.1).
 *
 * The screen is two sibling regions inside the safe-area screen: the top bar
 * (back control + centered title) and the gameplay stage. The start/restart
 * surface is absolutely filled INSIDE the stage only; the back control lives
 * in the top bar and maps to exit — never to gameplay input. The screen
 * component renders its regions, test ids, AND pointer-events policy from
 * this contract, so the headless test below and the native hit-testing
 * acceptance check validate the same structure.
 *
 * Pointer-events policy (T8.9): the stage container must be `box-none` so
 * touches fall through its empty areas to the shell's GamePointerInput
 * surface below (the stage's only interactive child is the start/restart
 * Pressable). An `auto` stage would intercept every gameplay touch — the
 * paddle would never move. The top bar stays an interactive sibling: it is
 * outside the gameplay hit surface and must not generate gameplay input.
 */
export const BRICK_BREAKER_LAYOUT = {
  topBar: {
    testID: 'brick-breaker-top-bar',
    back: { testID: 'brick-breaker-back', action: 'exit' as const },
    title: 'Brick Breaker',
  },
  stage: {
    testID: 'brick-breaker-stage',
    /** Touches in the stage's empty areas fall through to the pointer
     * surface; only the start/restart child is interactive. */
    pointerEvents: 'box-none' as const,
    startSurface: { testID: 'brick-breaker-start-surface', action: 'start' as const },
  },
} as const;
