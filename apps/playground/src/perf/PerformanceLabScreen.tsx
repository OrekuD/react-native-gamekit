import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import type { PlaygroundGameScreenProps } from '../shell/PlaygroundGameScreenProps';
import { usePlaygroundStore } from '../state/playgroundStore';
import { brickBreakerDefinition } from '../games/brickBreakerGame';
import { bootstrapDefinition } from '../games/bootstrapGame';
import { CounterSeries, PerfSummary, type SeriesSnapshot } from './summary';
import {
  runOpenCloseCycles,
  runScenario,
  type RunningScenario,
  type ScenarioResult,
} from './scenarios';

const SCENARIO_DURATION_MS = 5_000;
const UI_TRANSFER_FRAMES = 60;

interface UiFrameSummary {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

function summarize(samples: readonly number[]): UiFrameSummary {
  const series = new CounterSeries();
  for (const sample of samples) {
    series.record(sample);
  }
  const snapshot = series.snapshot();
  return {
    count: snapshot.count,
    mean: snapshot.mean,
    p50: snapshot.p50,
    p95: snapshot.p95,
    p99: snapshot.p99,
  };
}

/** Module-level results so the lab survives its own open/close remounts. */
const moduleResults: ScenarioResult[] = [];
let lastUiSummary: UiFrameSummary | undefined;

function formatSeries(snapshot: SeriesSnapshot): string {
  return `${snapshot.count} · p50 ${snapshot.p50.toFixed(2)} · p95 ${snapshot.p95.toFixed(2)} · p99 ${snapshot.p99.toFixed(2)} ms`;
}

function formatCounters(summary: PerfSummary): string {
  const lines = [
    `display ${summary.getCounter('display-callbacks')}`,
    `zero-step ${summary.getCounter('zero-step-callbacks')}`,
    `fixed ${summary.getCounter('fixed-steps')}`,
    `catch-up ${summary.getCounter('catch-up-steps')}`,
    `dropped ${summary.getCounter('dropped-debt-steps')}`,
    `commits ${summary.getCounter('commits')}`,
  ];
  for (const [name, snapshot] of summary.seriesSnapshot()) {
    lines.push(`${name} ${formatSeries(snapshot)}`);
  }
  return lines.join('\n');
}

/**
 * Deterministic performance diagnostics harness.
 *
 * Scenarios run instrumented sessions with the internal diagnostics sink;
 * UI frame deltas are aggregated on the UI runtime and transferred to React
 * at most once per second. The overlay can be hidden for Instruments captures.
 */
export default function PerformanceLabScreen({ onExit }: PlaygroundGameScreenProps) {
  const openGame = usePlaygroundStore((state) => state.openGame);
  const closeGame = usePlaygroundStore((state) => state.closeGame);
  const [results, setResults] = useState<readonly ScenarioResult[]>(() => [...moduleResults]);
  const [uiSummary, setUiSummary] = useState<UiFrameSummary | undefined>(lastUiSummary);
  const [running, setRunning] = useState<string | null>(null);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const toggleOverlay = () => setOverlayHidden((hidden) => !hidden);
  const runningRef = useRef<RunningScenario | null>(null);

  const commitResult = useCallback((result: ScenarioResult) => {
    moduleResults.unshift(result);
    moduleResults.length = Math.min(moduleResults.length, 20);
    setResults([...moduleResults]);
    setRunning(null);
  }, []);

  const transferUi = useCallback((samples: readonly number[]) => {
    const summary = summarize(samples);
    lastUiSummary = summary;
    setUiSummary(summary);
  }, []);

  const uiDeltas = useSharedValue<number[]>([]);
  const framesSinceTransfer = useSharedValue(0);

  useFrameCallback((frameInfo) => {
    const delta = frameInfo.timeSincePreviousFrame ?? 0;
    if (frameInfo.timeSincePreviousFrame === undefined) {
      return;
    }
    uiDeltas.value = [...uiDeltas.value, delta];
    framesSinceTransfer.value += 1;
    if (framesSinceTransfer.value >= UI_TRANSFER_FRAMES) {
      framesSinceTransfer.value = 0;
      const samples = uiDeltas.value;
      uiDeltas.value = [];
      runOnJS(transferUi)(samples);
    }
  });

  useEffect(
    () => () => {
      runningRef.current?.stop();
    },
    [],
  );

  const startScenario = (scenario: 'idle' | 'drag' | 'stall', game: 'brick-breaker' | 'bootstrap') => {
    runningRef.current?.stop();
    setRunning(`${scenario}:${game}`);
    const definition = game === 'brick-breaker' ? brickBreakerDefinition : bootstrapDefinition;
    runningRef.current = runScenario(scenario, {
      durationMs: SCENARIO_DURATION_MS,
      game: definition,
      onComplete: commitResult,
    });
  };

  const runCycles = async () => {
    setRunning('open-close');
    const result = await runOpenCloseCycles(6, openGame, closeGame);
    setResults([
      {
        scenario: 'idle',
        game: `open-close ${result.cycles} cycles`,
        durationMs: result.durationMs,
        summary: (() => {
          const summary = new PerfSummary();
          summary.count('cycles', result.cycles);
          summary.record('cycle-ms', result.durationMs / result.cycles);
          return summary;
        })(),
      },
      ...results,
    ]);
    setRunning(null);
  };

  const reset = () => {
    runningRef.current?.stop();
    runningRef.current = null;
    moduleResults.length = 0;
    lastUiSummary = undefined;
    setResults([]);
    setUiSummary(undefined);
    setRunning(null);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onExit}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Playground</Text>
        </Pressable>
        <Text style={styles.title}>Performance Lab</Text>
        <Text style={styles.meta}>
          {overlayHidden ? 'overlay hidden' : `ui frames: ${uiSummary ? `${uiSummary.p95.toFixed(1)}ms p95 · ${uiSummary.p99.toFixed(1)}ms p99` : '…'}`}
        </Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {!overlayHidden ? (
          <>
            <View style={styles.buttons}>
              <Pressable style={styles.button} onPress={() => startScenario('idle', 'brick-breaker')}>
                <Text style={styles.buttonLabel}>Idle · Brick Breaker</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => startScenario('idle', 'bootstrap')}>
                <Text style={styles.buttonLabel}>Idle · Bootstrap</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => startScenario('drag', 'brick-breaker')}>
                <Text style={styles.buttonLabel}>Scripted drag</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => startScenario('stall', 'brick-breaker')}>
                <Text style={styles.buttonLabel}>JS stall probe</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={runCycles}>
                <Text style={styles.buttonLabel}>Open/close ×6</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.buttonGhost]} onPress={toggleOverlay}>
                <Text style={styles.buttonLabel}>{overlayHidden ? 'Show overlay' : 'Hide overlay'}</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.buttonGhost]} onPress={reset}>
                <Text style={styles.buttonLabel}>Reset</Text>
              </Pressable>
            </View>

            {running !== null ? (
              <Text style={styles.running}>running: {running} ({SCENARIO_DURATION_MS} ms)…</Text>
            ) : null}

            {uiSummary !== undefined ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>UI presentation (aggregated on UI, 1 s transfer)</Text>
                <Text style={styles.mono}>
                  frames {uiSummary.count} · mean {uiSummary.mean.toFixed(2)} · p50{' '}
                  {uiSummary.p50.toFixed(2)} · p95 {uiSummary.p95.toFixed(2)} · p99{' '}
                  {uiSummary.p99.toFixed(2)} ms
                </Text>
              </View>
            ) : null}

            {results.map((result, index) => (
              <View key={`${result.scenario}-${result.game}-${index}`} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {result.scenario} · {result.game} · {result.durationMs} ms
                </Text>
                <Text style={styles.mono}>{formatCounters(result.summary)}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.meta}>Overlay hidden for external captures. Tap Reset to restore.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#080b12',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backLabel: {
    color: '#a78bfa',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    color: '#f4f4f5',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  meta: {
    color: '#71717a',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 24,
    paddingBottom: 80,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonGhost: {
    backgroundColor: '#27272a',
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  running: {
    color: '#facc15',
    fontSize: 13,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    marginBottom: 12,
    padding: 14,
  },
  cardTitle: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  mono: {
    color: '#a1a1aa',
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 17,
  },
});
