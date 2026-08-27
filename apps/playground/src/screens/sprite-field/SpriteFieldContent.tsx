/**
 * Sprite Field content (T7.8).
 *
 * The loading boundary owns the asset acquisition through `useGameAssets`;
 * the ready state feeds the low-frequency HUD overlay (score + clip) from
 * the shell-owned session's commit listener — gameplay values never enter
 * React per frame. The session belongs to the shell's persistent surface;
 * the renderer draws nothing before the assets are ready, so gameplay is
 * effectively gated on readiness while close/reopen follows the shell's
 * lease policy.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LabHeader } from '../../components/LabHeader';


import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import { type SpriteFieldSession, type PlaySnapshot } from './spriteFieldGame';

/** Diagnostic publication cadence (T12-F7): at most ~8 publications per
 * second regardless of camera speed. Whole-unit quantization alone is not a
 * frequency guarantee. */
const DIAGNOSTIC_INTERVAL_SECONDS = 0.125;

export default function SpriteFieldContent({
  game,
  onExit,
  assetState,
  onHudPublish,
  onDiagnosticsPublish,
}: PlaygroundGameContentProps & {
  /** Test instrumentation: called exactly when the HUD setter runs. */
  readonly onHudPublish?: () => void;
  /** Test instrumentation: called exactly when a diagnostic publishes. */
  readonly onDiagnosticsPublish?: () => void;
}) {
  // RF2: the shell owns the asset load; the content consumes the status. The
  // loading/error branch never reads a gameplay snapshot or casts the neutral
  // canvas session — the real Sprite Field session is used only when ready.
  const state = assetState ?? { status: 'loading' as const, progress: 0, retry: () => undefined };
  const ready = state.status === 'ready';
  const session = ready ? (game as SpriteFieldSession) : null;
  const [hud, setHud] = useState<{
    score: number;
    clip: string;
    animationMode: PlaySnapshot['animationMode'];
  } | null>(null);
  // T12.7 diagnostics: an opt-in readout of camera + culling state. The
  // values are quantized AND gated by an explicit publication cadence, and
  // no diagnostic projection or setter runs while the toggle is off
  // (T12-F7).
  const [diagnostics, setDiagnostics] = useState<boolean>(false);
  const [diag, setDiag] = useState<{
    total: number;
    visible: number;
    cx: number;
    cy: number;
    zoom: number;
  } | null>(null);
  const onHudPublishRef = useRef(onHudPublish);
  const onDiagnosticsPublishRef = useRef(onDiagnosticsPublish);
  useEffect(() => {
    onHudPublishRef.current = onHudPublish;
    onDiagnosticsPublishRef.current = onDiagnosticsPublish;
  });

  // Render-phase: initialize the HUD from the real session exactly when it
  // becomes available (the sanctioned adjust-during-render pattern).
  if (session !== null && hud === null) {
    const play = session.getRenderFrame().current as PlaySnapshot;
    setHud({
      score: play.score,
      clip: play.animation.clip,
      animationMode: play.animationMode,
    });
    if (diagnostics) {
      setDiag(quantizeDiagnostics(play));
    }
  }

  // Low-frequency overlay: subscribed only to the real session's commits.
  // BOTH setters are gated by last-published refs compared BEFORE invoking
  // React (T12-F7): unchanged commits never call a setter, and diagnostics
  // do no work at all while the toggle is off.
  const lastHudRef = useRef<{ score: number; clip: string; animationMode: PlaySnapshot['animationMode'] } | undefined>(undefined);
  const lastDiagRef = useRef<{ total: number; visible: number; cx: number; cy: number; zoom: number } | undefined>(undefined);
  const lastDiagAtRef = useRef<number>(-Infinity);
  useEffect(() => {
    if (session === null) {
      return;
    }
    const update = (frame: unknown): void => {
      const snapshot = (frame as { current: PlaySnapshot }).current;
      const hudNext = {
        score: snapshot.score,
        clip: snapshot.animation.clip,
        animationMode: snapshot.animationMode,
      };
      const lastHud = lastHudRef.current;
      if (
        lastHud === undefined ||
        lastHud.score !== hudNext.score ||
        lastHud.clip !== hudNext.clip ||
        lastHud.animationMode !== hudNext.animationMode
      ) {
        lastHudRef.current = hudNext;
        setHud(hudNext);
        onHudPublishRef.current?.();
      }
      if (!diagnostics) {
        return; // No diagnostic projection or setter while off.
      }
      if (snapshot.elapsed - lastDiagAtRef.current < DIAGNOSTIC_INTERVAL_SECONDS) {
        return; // Explicit cadence, independent of camera speed.
      }
      const diagNext = quantizeDiagnostics(snapshot);
      const lastDiag = lastDiagRef.current;
      if (lastDiag !== undefined && sameDiagnostics(lastDiag, diagNext)) {
        return;
      }
      lastDiagRef.current = diagNext;
      lastDiagAtRef.current = snapshot.elapsed;
      setDiag(diagNext);
      onDiagnosticsPublishRef.current?.();
    };
    update(session.getRenderFrame());
    return session.addCommitListener(update).remove;
  }, [diagnostics, session]);

  return (
    <View style={styles.screen}>
      <LabHeader title="Sprite Field" onExit={onExit} testID="sprite-field-back" />
      <View style={styles.headerMeta}>
        <Text style={styles.meta}>
          {state.status === 'loading'
            ? `loading ${Math.round(state.progress * 100)}%`
            : state.status === 'error'
              ? 'load failed'
              : hud === null
                ? 'ready'
                : `score ${hud.score} · ${hud.clip}`}
        </Text>
        {diagnostics && diag !== null ? (
          <Text style={styles.diagnosticsLine}>
            cam ({diag.cx}, {diag.cy}) ×{diag.zoom.toFixed(1)} · {diag.visible}/{diag.total} enemies
          </Text>
        ) : null}
      </View>

      <View pointerEvents="box-none" style={styles.animationControls}>
        <Pressable
          accessibilityLabel="Toggle camera diagnostics"
          accessibilityRole="button"
          disabled={session === null}
          onPress={() => {
            setDiagnostics((current) => !current);
          }}
          style={({ pressed }) => [
            styles.animationButton,
            pressed && styles.animationButtonPressed,
            diagnostics && styles.diagnosticsButtonOn,
          ]}
        >
          <Text style={styles.buttonLabel}>Diag</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Change player animation. Current mode: ${hud?.animationMode ?? 'auto'}`}
          accessibilityRole="button"
          disabled={session === null}
          onPress={() => {
            if (session === null) {
              return;
            }
            session.input.press('cycleAnimation');
            session.input.release('cycleAnimation');
          }}
          style={({ pressed }) => [
            styles.animationButton,
            pressed && styles.animationButtonPressed,
            session === null && styles.animationButtonDisabled,
          ]}
        >
          <Text style={styles.animationButtonLabel}>
            State: {hud?.animationMode ?? 'auto'}
          </Text>
          <Text style={styles.animationButtonHint}>Tap for next</Text>
        </Pressable>
      </View>

      {state.status === 'error' ? (
        <Pressable
          accessibilityLabel="Retry loading assets"
          accessibilityRole="button"
          onPress={state.retry}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      ) : null}

      {state.status === 'loading' ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <Text style={styles.loadingLabel}>Loading sprites…</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Quantize the diagnostics to whole units (T12.7): per-frame changes below
 * one world unit never republish. */
function quantizeDiagnostics(play: PlaySnapshot): {
  total: number;
  visible: number;
  cx: number;
  cy: number;
  zoom: number;
} {
  return {
    total: play.enemies.length,
    visible: play.visibleEnemies,
    cx: Math.round(play.camera.center.x),
    cy: Math.round(play.camera.center.y),
    zoom: Math.round(play.camera.zoom * 10) / 10,
  };
}

function sameDiagnostics(
  first: { cx: number; cy: number; zoom: number; total: number; visible: number },
  second: { cx: number; cy: number; zoom: number; total: number; visible: number },
): boolean {
  return (
    first.cx === second.cx &&
    first.cy === second.cy &&
    first.zoom === second.zoom &&
    first.total === second.total &&
    first.visible === second.visible
  );
}

const styles = StyleSheet.create({
  headerMeta: { paddingHorizontal: 16, paddingTop: 8 },
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  animationControls: {
    alignItems: 'center',
    bottom: 20,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  buttonLabel: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  diagnosticsButtonOn: {
    backgroundColor: 'rgba(34, 197, 94, 0.35)',
  },
  diagnosticsLine: {
    color: '#4ade80',
    fontVariant: ['tabular-nums'],
    fontSize: 12,
  },
  animationButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderColor: 'rgba(148, 163, 184, 0.32)',
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 144,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  animationButtonPressed: {
    backgroundColor: 'rgba(14, 165, 233, 0.34)',
  },
  animationButtonDisabled: {
    opacity: 0.45,
  },
  animationButtonLabel: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  animationButtonHint: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
  },
  retry: {
    alignSelf: 'center',
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryLabel: {
    color: '#082f49',
    fontSize: 14,
    fontWeight: '800',
  },
  loadingOverlay: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 220,
  },
  loadingLabel: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '600',
  },
});
