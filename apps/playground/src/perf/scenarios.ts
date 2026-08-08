import {
  createAnimationFrameDriver,
  createGameSessionWithDriver,
  type FrameDriver,
} from 'react-native-gamekit/testing';
import type { GameDefinition } from 'react-native-gamekit';

import { createSummarySink, generateDragSchedule } from './sessionSink';
import { PerfSummary } from './summary';

export type PerfScenarioId = 'idle' | 'drag' | 'stall';

export interface ScenarioResult {
  readonly scenario: PerfScenarioId;
  readonly game: string;
  readonly durationMs: number;
  readonly summary: PerfSummary;
}

export interface RunScenarioOptions {
  readonly durationMs: number;
  readonly game: GameDefinition;
  readonly driver?: FrameDriver;
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaMs?: number;
  /** Stall-probe: block JS at this offset for this long (ms). */
  readonly stallAtMs?: number;
  readonly stallDurationMs?: number;
  readonly onComplete: (result: ScenarioResult) => void;
}

export interface RunningScenario {
  /** Stop timers, pause, and dispose the instrumented session. */
  readonly stop: () => void;
}

/**
 * Run a deterministic instrumented scenario on a disposable session.
 *
 * The session uses the platform frame driver by default; tests may inject a
 * manual driver. Counters flow through the internal diagnostics sink into a
 * `PerfSummary` delivered on completion.
 */
export function runScenario(
  scenario: PerfScenarioId,
  options: RunScenarioOptions,
): RunningScenario {
  const summary = new PerfSummary();
  const session = createGameSessionWithDriver(options.game, {
    frameDriver: options.driver ?? createAnimationFrameDriver(),
    fixedStepMs: options.fixedStepMs,
    maxCatchUpSteps: options.maxCatchUpSteps,
    maxFrameDeltaMs: options.maxFrameDeltaMs,
    diagnostics: createSummarySink(summary),
  });
  session.start();

  const startedAt = Date.now();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let disposed = false;

  // Input-to-commit latency: the interval from enqueueing a scripted pointer
  // event to the next published frame, measured on the JS runtime.
  let lastEnqueueAt: number | undefined;
  const schedule = generateDragSchedule(options.durationMs, 16);
  if (scenario === 'drag') {
    session.addRenderFrameListener(() => {
      if (lastEnqueueAt !== undefined) {
        summary.record('input-to-commit-ms', Date.now() - lastEnqueueAt);
        lastEnqueueAt = undefined;
      }
    });
    for (const event of schedule) {
      timers.push(
        setTimeout(() => {
          if (disposed) {
            return;
          }
          lastEnqueueAt = Date.now();
          if (event.kind === 'begin') {
            session.input.begin('primary', event.pointerId, { x: event.x, y: event.y });
          } else if (event.kind === 'move') {
            session.input.move('primary', event.pointerId, { x: event.x, y: event.y });
          } else {
            session.input.end('primary', event.pointerId);
          }
        }, event.atMs),
      );
    }
  }

  if (scenario === 'stall') {
    timers.push(
      setTimeout(() => {
        if (disposed) {
          return;
        }
        const until = Date.now() + (options.stallDurationMs ?? 200);
        while (Date.now() < until) {
          // Deliberate JS-thread block for the stall probe.
        }
      }, options.stallAtMs ?? 1000),
    );
  }

  timers.push(
    setTimeout(() => {
      if (disposed) {
        return;
      }
      session.pause();
      options.onComplete({
        scenario,
        game: String(options.game.initialScene),
        durationMs: Date.now() - startedAt,
        summary,
      });
    }, options.durationMs),
  );

  return {
    stop() {
      disposed = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      session.dispose();
    },
  };
}

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
