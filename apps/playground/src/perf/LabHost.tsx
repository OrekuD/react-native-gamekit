/**
 * F1 scenario host: drives one Performance Lab run against the shell's
 * persistent game surface.
 *
 * The shell owns the long-lived GameView/Skia canvas and pointer adapter (see
 * PlaygroundShell); this host creates one fresh Brick Breaker session per
 * run, transfers the session and its instrumentation as one attachment,
 * scripts deterministic input into that session, aggregates UI metrics in
 * constant space, and reports stage counters and latency through the
 * controller.
 *
 * Run lifecycle (guarded by `LabRunController`):
 * - Mount: register the host, start the run, publish the run session.
 * - Engine scenarios script deterministic input into the session's own
 *   input buffer (the same buffer the pointer surface feeds).
 * - Duration end: pause the session, flush the final UI summary to the RN
 *   runtime, hand the RN summary to the controller.
 * - Unmount: pause and detach the session, then let the shell dispose it only
 *   after the surface has committed its replacement.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { runOnUI, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { GameSession } from 'react-native-gamekit';
import type { GamePointerInstrumentation, GameViewInstrumentation } from 'react-native-gamekit/react';
import { createAnimationFrameDriver, createGameSessionWithDriver } from 'react-native-gamekit/testing';

import {
  brickBreakerPerformanceDefinition,
  type BrickBreakerSession,
} from '../games/brickBreakerGame';
import type { LabRunController, PerfScenarioId } from './labRun';
import { createSummarySink, generateDragSchedule } from './sessionSink';
import { PerfSummary } from './summary';
import {
  UI_BUCKET_COUNT,
  UI_TRANSFER_INTERVAL_MS,
  uiBucketIndex,
  type UiTransfer,
} from './uiMetrics';
import type { RunSurfaceEvent } from '../shell/surfaceSlot.ts';

/** Let the mounted pipeline settle before scripted engine input begins. */
const INPUT_AT_MS = 300;
const STALL_AT_MS = 1000;
const STALL_DURATION_MS = 200;

export interface LabHostProps {
  readonly runId: number;
  readonly scenario: PerfScenarioId;
  readonly durationMs: number;
  readonly controller: LabRunController;
  /** Transfer the run surface to/from the shell without disposing in-place. */
  readonly onRunSurfaceEvent: (event: RunSurfaceEvent) => void;
}

export default function LabHost({
  runId,
  scenario,
  durationMs,
  controller,
  onRunSurfaceEvent,
}: LabHostProps) {
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
  // the RN runtime at run end). `latestForwarded` carries a monotonically
  // increasing input sequence alongside the timestamp so the RN side can
  // consume each forwarded event exactly once on its first presentation.
  const rawCount = useSharedValue(0);
  const forwardedCount = useSharedValue(0);
  const forwardSeq = useSharedValue(0);
  const latestForwarded = useSharedValue<{ seq: number; atMs: number } | undefined>(undefined);
  const samplerCount = useSharedValue(0);

  // Worklet-safe instrumentation callbacks for the shell's persistent
  // pointer binding and GameView: the UI-runtime closures mutate shared
  // values only. The session is stable for the host's lifetime, so the
  // objects are stable too; the shell registers them on mount and clears
  // them on unmount.
  const pointerInstrumentation = useMemo<GamePointerInstrumentation>(
    () => ({
      onRawTouch: () => {
        'worklet';
        rawCount.value += 1;
      },
      onForwarded: (_kind: unknown, _pointerId: number, atMs: number) => {
        'worklet';
        forwardedCount.value += 1;
        forwardSeq.value += 1;
        latestForwarded.value = { seq: forwardSeq.value, atMs };
      },
      // RN runtime: the binding's verdict. The accepted-input counter is
      // read at dispatch time so the commit association is causal.
      onDispatchResult: (seq: number, atMs: number, accepted: boolean) => {
        controller.onForwardResult(seq, atMs, session.input.acceptedCount, accepted);
      },
      onSamplerChanged: (mounted: boolean) => {
        'worklet';
        samplerCount.value += mounted ? 1 : -1;
      },
    }),
    // Reanimated shared-value objects are stable hook results. Listing them
    // makes React's immutability rule treat worklet writes as hook-argument
    // mutation, so only the semantic RN-runtime owners belong here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, session],
  );
  const viewInstrumentation = useMemo<GameViewInstrumentation>(
    () => ({
      onPresentCommit: (revision: number, atMs: number) => {
        controller.onCommit(revision, atMs, session.input.acceptedCount);
      },
      onUiRevisionObserved: (revision: number, atMs: number) => {
        controller.onUiObserved(revision, atMs);
      },
    }),
    [controller, session],
  );

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
    onRunSurfaceEvent({
      kind: 'attach',
      attachment: {
        session: session as unknown as GameSession,
        pointer: pointerInstrumentation,
        view: viewInstrumentation,
      },
    });

    const timers: ReturnType<typeof setTimeout>[] = [];
    let disposed = false;

    // Engine metric (F1.7): enqueue → commit stays separate from the
    // native input → presented path. One sample per scripted event, measured
    // on the RN runtime through the session's own commit listener.
    let lastEnqueueAt: number | undefined;
    const subscription = session.addCommitListener((frame) => {
      if (lastEnqueueAt !== undefined) {
        summary.record('input-to-commit-ms', Date.now() - lastEnqueueAt);
        lastEnqueueAt = undefined;
      }
      // Direct paddle-tracking evidence for native-input runs.
      const play = frame.current as { paddle?: { x: number } } | undefined;
      if (play?.paddle !== undefined) {
        summary.record('paddle-x', play.paddle.x);
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
      if (session.status === 'running') {
        session.pause();
      }
      controller.detachHost();
      // The shell still renders this session until the detach state commits.
      // Transfer retirement back to the shell; disposing here is a
      // use-after-dispose race with GameView and GamePointerInput.
      onRunSurfaceEvent({
        kind: 'detach',
        session: session as unknown as GameSession,
      });
    };
  }, [
    controller,
    durationMs,
    forwardedCount,
    onRunSurfaceEvent,
    onUiTransfer,
    pointerInstrumentation,
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
    viewInstrumentation,
  ]);

  return null;
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
