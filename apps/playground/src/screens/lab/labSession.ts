import { createAnimationFrameDriver, createGameSessionWithDriver } from 'rn-gamekit/testing';

import {
  brickBreakerPerformanceDefinition,
  type BrickBreakerSession,
} from '../brick-breaker/brickBreakerGame';
import { createSummarySink } from './sessionSink';
import { PerfSummary } from './summary';

/**
 * The shell-owned Performance Lab session.
 *
 * One session per lab visit, rendered by the shell's persistent surface; the
 * lab's runs restart it in place (the performance definition relaunches in
 * play), so the Skia canvas never remounts between runs. The summary is a
 * placeholder holder: each run's host swaps in its own summary object.
 */
export function createLabSession(): BrickBreakerSession {
  const summary = new PerfSummary();
  return createGameSessionWithDriver(brickBreakerPerformanceDefinition, {
    frameDriver: createAnimationFrameDriver(),
    diagnostics: createSummarySink(summary),
  });
}
