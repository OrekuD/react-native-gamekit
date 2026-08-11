import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { PlaygroundGameScreenProps } from '../shell/PlaygroundGameScreenProps';
import { usePlaygroundStore } from '../state/playgroundStore';
import LabHost from './LabHost';
import { LabRunController, issueRunId, type PerfScenarioId, type ScenarioResult } from './labRun';
import { runOpenCloseCycles } from './scenarios';
import { PerfSummary, type SeriesSnapshot } from './summary';

const SCENARIO_DURATION_MS = 5_000;
/** The mounted game pipeline occupies the top 55% of the screen. */
const GAME_AREA_RATIO = 0.55;

/** Module-level controller and results so the lab survives remounts. */
const controller = new LabRunController({ onComplete: (result) => onCompleteRef.current?.(result) });
const moduleResults: ScenarioResult[] = [];

/** The screen registers its result handler per mount. */
const onCompleteRef: { current: ((result: ScenarioResult) => void) | undefined } = {
  current: undefined,
};

function formatSeries(snapshot: SeriesSnapshot): string {
  return `${snapshot.count} · p50 ${snapshot.p50.toFixed(2)} · p95 ${snapshot.p95.toFixed(2)} · p99 ${snapshot.p99.toFixed(2)} ms`;
}

function formatResult(result: ScenarioResult): string {
  const summary = result.summary;
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
  if (result.ui !== undefined && result.ui.count > 0) {
    lines.push(
      `ui frames ${result.ui.count} · mean ${result.ui.mean.toFixed(2)} · p50 ${result.ui.p50.toFixed(2)} · p95 ${result.ui.p95.toFixed(2)} · p99 ${result.ui.p99.toFixed(2)} ms`,
    );
  }
  if (result.inputStages !== undefined) {
    const stages = result.inputStages;
    lines.push(
      `input raw ${stages.raw} · forwarded ${stages.forwarded} · sampled ${stages.sampled} · committed ${stages.committed} · presented ${stages.presented}`,
    );
  }
  if (result.inputToCommitMs !== undefined) {
    lines.push(`input→commit ${formatSeries(result.inputToCommitMs)}`);
  }
  if (result.inputToUiObservedMs !== undefined) {
    lines.push(`input→ui-observed ${formatSeries(result.inputToUiObservedMs)}`);
  }
  if (result.latencyCounters !== undefined) {
    const counters = result.latencyCounters;
    lines.push(
      `latency matched ${counters.matched} · unmatched ${counters.unmatched} · rejected ${counters.rejected} · superseded ${counters.superseded}`,
    );
  }
  return lines.join('\n');
}

/**
 * Performance Lab — F1: scenarios run against the **mounted** game pipeline.
 *
 * The host surface (top of the screen) mounts the same GameView, Skia
 * renderer, and pointer surface the catalog game uses; engine scenarios
 * script deterministic input into the session input buffer, the native-drag
 * scenario measures real RNGH touches, and UI frame deltas aggregate in
 * constant space on the UI runtime with at most one transfer per second.
 * The overlay can be hidden for Instruments/Maestro captures.
 */
export default function PerformanceLabScreen({ onExit }: PlaygroundGameScreenProps) {
  const { height } = useWindowDimensions();
  const openGame = usePlaygroundStore((state) => state.openGame);
  const closeGame = usePlaygroundStore((state) => state.closeGame);
  const [results, setResults] = useState<readonly ScenarioResult[]>(() => [...moduleResults]);
  const [activeRun, setActiveRun] = useState<{ runId: number; scenario: PerfScenarioId } | null>(null);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const toggleOverlay = () => setOverlayHidden((hidden) => !hidden);

  useEffect(() => {
    onCompleteRef.current = (result: ScenarioResult) => {
      moduleResults.unshift(result);
      moduleResults.length = Math.min(moduleResults.length, 20);
      setResults([...moduleResults]);
      setActiveRun(null);
    };
    return () => {
      onCompleteRef.current = undefined;
    };
  }, []);

  const startRun = (scenario: PerfScenarioId) => {
    setActiveRun({ runId: issueRunId(), scenario });
  };

  const runCycles = async () => {
    const result = await runOpenCloseCycles(6, openGame, closeGame);
    moduleResults.unshift({
      runId: issueRunId(),
      scenario: 'idle-active',
      game: `open-close ${result.cycles} cycles`,
      durationMs: result.durationMs,
      summary: (() => {
        const summary = new PerfSummary();
        summary.count('cycles', result.cycles);
        summary.record('cycle-ms', result.durationMs / result.cycles);
        return summary;
      })(),
      ui: undefined,
      inputStages: undefined,
      inputToCommitMs: undefined,
      inputToUiObservedMs: undefined,
      latencyCounters: undefined,
    });
    setResults([...moduleResults]);
  };

  const reset = () => {
    setActiveRun(null);
    moduleResults.length = 0;
    setResults([]);
  };

  const gameAreaHeight = Math.round(height * GAME_AREA_RATIO);

  return (
    <View style={styles.screen}>
      <View style={[styles.gameArea, { height: gameAreaHeight }]}>
        {activeRun === null ? (
          <View style={styles.gamePlaceholder}>
            <Text style={styles.gamePlaceholderText}>
              Game pipeline idle — start a scenario to mount GameView + renderer + pointer surface
            </Text>
          </View>
        ) : (
          <LabHost
            key={activeRun.runId}
            runId={activeRun.runId}
            scenario={activeRun.scenario}
            durationMs={SCENARIO_DURATION_MS}
            controller={controller}
          />
        )}
      </View>

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
          {activeRun !== null
            ? `run ${activeRun.runId} · ${activeRun.scenario} (${SCENARIO_DURATION_MS} ms)…`
            : overlayHidden
              ? 'overlay hidden'
              : 'scenarios run against the mounted game pipeline'}
        </Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {!overlayHidden ? (
          <>
            <View style={styles.buttons}>
              <Pressable style={styles.button} onPress={() => startRun('idle-active')}>
                <Text style={styles.buttonLabel}>Idle · active play</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => startRun('engine-drag')}>
                <Text style={styles.buttonLabel}>Engine drag</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => startRun('stall')}>
                <Text style={styles.buttonLabel}>JS stall probe</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => startRun('native-drag')}>
                <Text style={styles.buttonLabel}>Native drag</Text>
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

            {activeRun !== null ? (
              <Text style={styles.running}>
                running: {activeRun.scenario} #{activeRun.runId} — the game pipeline above is live.
                {'\n'}Native drag: touch and drag inside the game area.
              </Text>
            ) : null}

            {results.map((result, index) => (
              <View key={`${result.runId}-${result.scenario}-${index}`} style={styles.card}>
                <Text style={styles.cardTitle}>
                  #{result.runId} {result.scenario} · {result.game} · {result.durationMs} ms
                </Text>
                <Text style={styles.mono}>{formatResult(result)}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.meta}>
            Overlay hidden for external captures. Tap Reset to restore controls.
          </Text>
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
  gameArea: {
    backgroundColor: '#0f1420',
    overflow: 'hidden',
  },
  gamePlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  gamePlaceholderText: {
    color: '#52525b',
    fontSize: 12,
    textAlign: 'center',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
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
