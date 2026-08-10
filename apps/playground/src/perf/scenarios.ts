/**
 * Scenario helpers for the Performance Lab.
 *
 * The F1 host (`LabHost.tsx`) owns the mounted game pipeline and run
 * lifecycle; this module keeps the remaining pure helpers: the open/close
 * cycle driver and nothing else (the drag schedule lives in `sessionSink`).
 */
export interface OpenCloseResult {
  readonly cycles: number;
  readonly durationMs: number;
}

/**
 * Measure repeated shell open/close cycles.
 *
 * Drives the real shell store so game screens mount and dispose their
 * sessions; the lab screen itself is replaced during each open, so results
 * are reported through a callback once the final close lands.
 */
export async function runOpenCloseCycles(
  cycles: number,
  openGame: (id: 'brick-breaker') => void,
  closeGame: () => void,
  waitMs = 300,
): Promise<OpenCloseResult> {
  const startedAt = Date.now();
  for (let index = 0; index < cycles; index += 1) {
    openGame('brick-breaker');
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    closeGame();
    await new Promise((resolve) => setTimeout(resolve, Math.floor(waitMs / 3)));
  }
  return { cycles, durationMs: Date.now() - startedAt };
}
