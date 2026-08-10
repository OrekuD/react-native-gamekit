/**
 * F1 scenario host: the mounted game pipeline.
 *
 * Runs one Performance Lab scenario against the **real** pipeline used by
 * the catalog game — GameView, the Skia Brick Breaker renderer, and
 * GamePointerInput with the RNGH manual gesture — visually isolated from
 * the lab controls so lab UI work is never counted as game work.
 *
 * Run lifecycle (guarded by `LabRunController`):
 * - Mount: register the host, start the run, begin UI metric aggregation.
 * - Engine scenarios script deterministic input into the session's own
 *   input buffer (the same buffer the pointer surface feeds), so the
 *   simulation is repeatable while presentation runs through the mounted
 *   pipeline.
 * - Duration end: pause the session, flush the final UI summary to the RN
 *   runtime, hand the RN summary to the controller; the merged result is
 *   emitted once the final UI transfer lands.
 * - Unmount: dispose the session and abort the run.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { runOnUI, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GamePointerInput, GameView } from 'react-native-gamekit/react';
import { createAnimationFrameDriver, createGameSessionWithDriver } from 'react-native-gamekit/testing';

import { brickBreakerDefinition, type BrickBreakerSession } from '../games/brickBreakerGame';
import { BrickBreakerRenderer } from '../renderers/BrickBreakerRenderer';
import type { LabRunController, PerfScenarioId } from './labRun';
import { createSummarySink, generateDragSchedule } from './sessionSink';
import { PerfSummary } from './summary';
import {
  beginUiRun,
  createUiAccumulator,
  flushUi,
  recordUiFrame,
  type UiAccumulator,
  type UiTransfer,
} from './uiMetrics';

/** Engine scenarios start play with a scripted tap at this offset. */
const TAP_AT_MS = 300;
const STALL_AT_MS = 1000;
const STALL_DURATION_MS = 200;

export interface LabHostProps {
  readonly runId: number;
  readonly scenario: PerfScenarioId;
  readonly durationMs: number;
  readonly controller: LabRunController;
}

export default function LabHost({ runId, scenario, durationMs, controller }: LabHostProps) {
  // One fresh summary and session per host mount: the diagnostics sink
  // writes into the summary from inside session creation.
  const [summary] = useState(() => new PerfSummary());
  const [session] = useState<BrickBreakerSession>(() =>
    createGameSessionWithDriver(brickBreakerDefinition, {
      frameDriver: createAnimationFrameDriver(),
      diagnostics: createSummarySink(summary),
    }),
  );

  // Native-input stage counters (written by UI-runtime worklets, read on
  // the RN runtime at run end).
  const rawCount = useSharedValue(0);
  const forwardedCount = useSharedValue(0);
  const latestForwardedAt = useSharedValue<number | undefined>(undefined);

  // Worklet-safe instrumentation callbacks: the UI-runtime closures mutate
  // shared values only; the RNGH gesture config is diffed per render, so
  // fresh objects here are fine (same pattern as the library adapter).
  const pointerInstrumentation = {
    onRawTouch: () => {
      'worklet';
      rawCount.value += 1;
    },
    onForwarded: (_kind: unknown, _pointerId: number, atMs: number) => {
      'worklet';
      forwardedCount.value += 1;
      latestForwardedAt.value = atMs;
    },
  };

  const viewInstrumentation = {
    onPresentCommit: (revision: number, atMs: number) => {
      controller.onPresentCommit(revision, atMs, latestForwardedAt.value);
    },
  };

  // Constant-space UI metric aggregation: one shared-value accumulator with
  // a fixed histogram; transfers at most once per second of elapsed time.
  const uiAccumulator = useSharedValue<UiAccumulator>(createUiAccumulator());
  const onUiTransfer = useCallback(
    (transfer: UiTransfer) => controller.onUiTransfer(transfer),
    [controller],
  );

  useFrameCallback((frameInfo) => {
    'worklet';
    const delta = frameInfo.timeSincePreviousFrame;
    if (delta === undefined || delta === null) {
      return;
    }
    const transfer = recordUiFrame(uiAccumulator.value, runId, delta);
    if (transfer !== undefined) {
      scheduleOnRN(onUiTransfer, transfer);
    }
  });

  useEffect(() => {
    controller.attachHost();
    controller.start({ scenario, durationMs }, runId);
    beginUiRun(uiAccumulator.value, runId);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let disposed = false;

    const finishRun = () => {
      if (session.status !== 'disposed') {
        session.pause();
      }
      // Final UI summary travels UI→RN; the controller completes the run
      // only when it lands (no race between the two sides).
      runOnUI(() => {
        'worklet';
        const transfer = flushUi(uiAccumulator.value, runId);
        if (transfer !== undefined) {
          scheduleOnRN(onUiTransfer, transfer);
        }
      })();
      controller.setInputStages(rawCount.value, forwardedCount.value);
      controller.finishHost(summary, durationMs, 'brick-breaker');
    };

    const schedule = buildScenarioSchedule(scenario, durationMs);
    for (const event of schedule) {
      timers.push(
        setTimeout(() => {
          if (disposed) {
            return;
          }
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

    if (scenario === 'stall') {
      timers.push(
        setTimeout(() => {
          if (disposed) {
            return;
          }
          const until = Date.now() + STALL_DURATION_MS;
          while (Date.now() < until) {
            // Deliberate JS-thread block for the stall probe.
          }
        }, STALL_AT_MS),
      );
    }

    timers.push(setTimeout(finishRun, durationMs));

    return () => {
      disposed = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      controller.detachHost();
      if (session.status !== 'disposed') {
        session.dispose();
      }
    };
  }, [
    controller,
    durationMs,
    forwardedCount,
    onUiTransfer,
    rawCount,
    runId,
    scenario,
    session,
    summary,
    uiAccumulator,
  ]);

  return (
    <View style={styles.host}>
      <GameView
        game={session}
        renderer={BrickBreakerRenderer}
        instrumentation={viewInstrumentation}
        style={styles.game}
      >
        <GamePointerInput game={session} action="primary" instrumentation={pointerInstrumentation} />
      </GameView>
    </View>
  );
}

interface ScriptedPointerEvent {
  readonly atMs: number;
  readonly kind: 'begin' | 'move' | 'end';
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

/** Deterministic engine-input schedules for the non-native scenarios. */
function buildScenarioSchedule(
  scenario: PerfScenarioId,
  durationMs: number,
): readonly ScriptedPointerEvent[] {
  if (scenario === 'native-drag') {
    return [];
  }
  const tap: readonly ScriptedPointerEvent[] = [
    { atMs: TAP_AT_MS, kind: 'begin', pointerId: 1, x: 160, y: 90 },
    { atMs: TAP_AT_MS + 16, kind: 'end', pointerId: 1, x: 160, y: 90 },
  ];
  if (scenario !== 'engine-drag') {
    // idle-active and stall: a tap starts play, then the ball flies alone.
    return tap;
  }
  // The drag schedule fits inside the remaining window so its terminal
  // `end` fires before the duration timer.
  return generateDragSchedule(durationMs - TAP_AT_MS, 16, 320).map((event) => ({
    ...event,
    atMs: event.atMs + TAP_AT_MS,
  }));
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  game: {
    flex: 1,
    backgroundColor: '#0f1420',
  },
});
