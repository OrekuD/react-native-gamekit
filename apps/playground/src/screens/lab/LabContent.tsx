import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import type { RunSurfaceEvent } from '../../shell/surfaceSlot.ts';
import LabHost from './LabHost';
import { LabRunController, issueRunId, type PerfScenarioId, type ScenarioResult } from './labRun';
import { runOpenCloseCycles } from './scenarios';
import { PerfSummary, type SeriesSnapshot } from './summary';

const SCENARIO_DURATION_MS = 5_000;

/** Module-level controller and results so the lab survives remounts. */
const controller = new LabRunController({ onComplete: (result) => onCompleteRef.current?.(result) });
const moduleResults: ScenarioResult[] = [];

/** The screen registers its result handler per mount. */
const onCompleteRef: { current: ((result: ScenarioResult) => void) | undefined } = {
  current: undefined,
};

const ignoreRunSurfaceEvent = (_event: RunSurfaceEvent) => {};

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
  lines.push(`samplers-at-end ${result.samplersAtEnd}`);
  if (result.latencyCounters !== undefined) {
    const counters = result.latencyCounters;
    lines.push(
      `latency matched ${counters.matched} · unmatched ${counters.unmatched} · rejected ${counters.rejected} · superseded ${counters.superseded}`,
    );
  }
  return lines.join('\n');
}

/**
 * Performance Lab content (F1): scenarios run against the shell's persistent
 * mounted game pipeline.
 *
 * The shell's single GameView/Skia renderer/pointer surface renders the run
 * session; this content provides the run controls, the result cards, and
 * the scenario host that drives each run. The overlay can be hidden for
 * Instruments/Maestro captures.
 */
export default function LabContent({
  onExit,
  onOpenGame,
  onRunSurfaceEvent,
}: PlaygroundGameContentProps) {
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
    const result = await runOpenCloseCycles(6, onOpenGame, onExit);
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
      samplersAtEnd: 0,
    });
    setResults([...moduleResults]);
  };

  const reset = () => {
    setActiveRun(null);
    moduleResults.length = 0;
    setResults([]);
  };

  return (
    <SafeAreaView pointerEvents="box-none"
      edges={['top', 'right', 'bottom', 'left']}
      style={styles.screen}
    >
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

      <View style={styles.overlay}>
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
                running: {activeRun.scenario} #{activeRun.runId} — the game pipeline is live on this
                surface. Native drag: touch and drag inside the game area.
              </Text>
            ) : null}

            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
              {results.map((result, index) => (
                <View key={`${result.runId}-${result.scenario}-${index}`} style={styles.card}>
                  <Text style={styles.cardTitle}>
                    #{result.runId} {result.scenario} · {result.game} · {result.durationMs} ms
                  </Text>
                  <Text style={styles.mono}>{formatResult(result)}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        ) : (
          <Text style={styles.meta}>
            Overlay hidden for external captures. Tap Reset to restore controls.
          </Text>
        )}
      </View>

      {activeRun !== null ? (
        <LabHost
          key={activeRun.runId}
          runId={activeRun.runId}
          scenario={activeRun.scenario}
          durationMs={SCENARIO_DURATION_MS}
          controller={controller}
          onRunSurfaceEvent={onRunSurfaceEvent ?? ignoreRunSurfaceEvent}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    backgroundColor: 'rgba(8, 11, 18, 0.92)',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 8,
    marginTop: 4,
  },
  overlay: {
    backgroundColor: 'rgba(8, 11, 18, 0.94)',
    flex: 1,
    marginTop: 'auto',
    maxHeight: '58%',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonGhost: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  buttonLabel: {
    color: '#082f49',
    fontSize: 13,
    fontWeight: '700',
  },
  running: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: 10,
  },
  body: {
    flex: 1,
    marginTop: 10,
  },
  bodyContent: {
    gap: 10,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
  },
  cardTitle: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  mono: {
    color: '#cbd5e1',
    fontFamily: 'Courier',
    fontSize: 10,
    lineHeight: 14,
  },
});
