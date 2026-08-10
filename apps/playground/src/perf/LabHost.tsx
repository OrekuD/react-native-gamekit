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

import {
  brickBreakerPerformanceDefinition,
  type BrickBreakerSession,
} from '../games/brickBreakerGame';
import { BrickBreakerRenderer } from '../renderers/BrickBreakerRenderer';
import type { LabRunController, PerfScenarioId } from './labRun';
import { createSummarySink, generateDragSchedule } from './sessionSink';
import { PerfSummary } from './summary';
import {
  UI_BUCKET_COUNT,
  UI_TRANSFER_INTERVAL_MS,
  uiBucketIndex,
  type UiTransfer,
} from './uiMetrics';

/** Let the mounted pipeline settle before scripted engine input begins. */
const INPUT_AT_MS = 300;
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
    createGameSessionWithDriver(brickBreakerPerformanceDefinition, {
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

  // Constant-space UI metric aggregation backed by scalar shared values:
  // worklet-owned mutable state must live in shared values (closure-captured
  // objects are serialized into per-registration copies and cannot be relied
  // upon to share state between record and flush paths). Only transfer
  // snapshots cross runtimes. `runEnded` is set on the RN runtime at run
  // end; the next UI frame flushes the final transfer exactly once.
  const uiCount = useSharedValue(0);
  const uiSumMs = useSharedValue(0);
  const uiMinMs = useSharedValue(0);
  const uiMaxMs = useSharedValue(0);
  const uiElapsedMs = useSharedValue(0);
  const uiLastTransferMs = useSharedValue(0);
  const uiFlushed = useSharedValue(false);
  const uiBuckets = useSharedValue<Int32Array>(new Int32Array(256));
  const runEnded = useSharedValue(false);
  const onUiTransfer = useCallback(
    (transfer: UiTransfer) => controller.onUiTransfer(transfer),
    [controller],
  );

  useFrameCallback((frameInfo) => {
    'worklet';
    if (runEnded.value) {
      if (uiFlushed.value) {
        return;
      }
      uiFlushed.value = true;
      const buckets = new Array<number>(UI_BUCKET_COUNT);
      const source = uiBuckets.value;
      for (let index = 0; index < UI_BUCKET_COUNT; index += 1) {
        buckets[index] = source[index] ?? 0;
      }
      scheduleOnRN(onUiTransfer, {
        runId,
        final: true,
        count: uiCount.value,
        sumMs: uiSumMs.value,
        minMs: uiMinMs.value,
        maxMs: uiMaxMs.value,
        buckets,
      });
      return;
    }

    const delta = frameInfo.timeSincePreviousFrame;
    if (delta === undefined || delta === null) {
      return;
    }

    const nextCount = uiCount.value + 1;
    uiCount.value = nextCount;
    uiSumMs.value += delta;
    uiElapsedMs.value += delta;
    if (nextCount === 1) {
      uiMinMs.value = delta;
      uiMaxMs.value = delta;
    } else {
      uiMinMs.value = Math.min(uiMinMs.value, delta);
      uiMaxMs.value = Math.max(uiMaxMs.value, delta);
    }
    const bucketIndex = uiBucketIndex(delta);
    uiBuckets.modify((buckets) => {
      buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + 1;
      return buckets;
    }, false);

    if (uiElapsedMs.value - uiLastTransferMs.value < UI_TRANSFER_INTERVAL_MS) {
      return;
    }
    uiLastTransferMs.value = uiElapsedMs.value;
    const buckets = new Array<number>(UI_BUCKET_COUNT);
    const source = uiBuckets.value;
    for (let index = 0; index < UI_BUCKET_COUNT; index += 1) {
      buckets[index] = source[index] ?? 0;
    }
    scheduleOnRN(onUiTransfer, {
      runId,
      final: false,
      count: uiCount.value,
      sumMs: uiSumMs.value,
      minMs: uiMinMs.value,
      maxMs: uiMaxMs.value,
      buckets,
    });
  });

  useEffect(() => {
    controller.attachHost();
    controller.start({ scenario, durationMs }, runId);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let disposed = false;

    // Engine metric (F1.7): enqueue → commit stays separate from the
    // native input → presented path. One sample per scripted event, measured
    // on the RN runtime through the session's own commit listener.
    let lastEnqueueAt: number | undefined;
    const subscription = session.addCommitListener(() => {
      if (lastEnqueueAt !== undefined) {
        summary.record('input-to-commit-ms', Date.now() - lastEnqueueAt);
        lastEnqueueAt = undefined;
      }
    });
    const enqueue = (event: ScriptedPointerEvent) => {
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
    };

    const finishRun = () => {
      if (session.status !== 'disposed') {
        session.pause();
      }
      // Stop frame recording immediately, then explicitly flush on the UI
      // runtime. Waiting for another frame after pausing the session can
      // strand the controller if no callback is delivered. Both paths share
      // `uiFlushed`, so a racing frame callback cannot emit twice.
      runEnded.value = true;
      runOnUI(() => {
        'worklet';
        if (uiFlushed.value) {
          return;
        }
        uiFlushed.value = true;
        const buckets = new Array<number>(UI_BUCKET_COUNT);
        const source = uiBuckets.value;
        for (let index = 0; index < UI_BUCKET_COUNT; index += 1) {
          buckets[index] = source[index] ?? 0;
        }
        scheduleOnRN(onUiTransfer, {
          runId,
          final: true,
          count: uiCount.value,
          sumMs: uiSumMs.value,
          minMs: uiMinMs.value,
          maxMs: uiMaxMs.value,
          buckets,
        });
      })();
      controller.setInputStages(rawCount.value, forwardedCount.value);
      controller.finishHost(summary, durationMs, 'brick-breaker');
    };

    const schedule = buildScenarioSchedule(scenario, durationMs);
    for (const event of schedule) {
      timers.push(setTimeout(() => enqueue(event), event.atMs));
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
      subscription.remove();
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
    runEnded,
    runId,
    scenario,
    session,
    summary,
    uiBuckets,
    uiCount,
    uiFlushed,
    uiMaxMs,
    uiMinMs,
    uiSumMs,
  ]);

  return (
    <View style={styles.host}>
      <GameView
        game={session}
        renderer={BrickBreakerRenderer}
        instrumentation={viewInstrumentation}
        style={styles.game}
      >
        <GamePointerInput
          game={session}
          action="primary"
          instrumentation={pointerInstrumentation}
        />
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
  if (scenario !== 'engine-drag') {
    // The lab-only definition starts in play, so idle and stall need no input.
    return [];
  }
  // The drag schedule fits inside the remaining window so its terminal
  // `end` fires before the duration timer.
  return generateDragSchedule(durationMs - INPUT_AT_MS, 16, 320).map((event) => ({
    ...event,
    atMs: event.atMs + INPUT_AT_MS,
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
