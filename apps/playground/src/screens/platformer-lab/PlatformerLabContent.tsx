/**
 * Platformer Lab content: touch controls, a quantized HUD, and pause/back.
 *
 * Controls issue button presses into the session's input buffer — exactly
 * like the Camera/Collision labs. The HUD publishes position, contact and
 * checkpoint facts only when the quantized record changes (~8 Hz cadence);
 * a moving player never drives React per frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameSession } from 'rn-gamekit';
import { GameButton, GameButtonPad } from 'rn-gamekit/react';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';

interface PlatformerSnapshotLike {
  readonly body: { readonly x: number; readonly y: number };
  readonly contacts: { readonly floor: boolean };
  readonly checkpoints: readonly { readonly reached: boolean }[];
  readonly elapsed: number;
  readonly ticks: number;
}

/** Diagnostic publication cadence: ~8 Hz. */
const DIAGNOSTIC_INTERVAL_SECONDS = 0.125;

interface LabHudRecord {
  readonly x: number;
  readonly y: number;
  readonly grounded: boolean;
  readonly checkpoints: number;
  readonly checkpointTotal: number;
  readonly falls: number;
}

interface PlatformerSnapshotWithFinish extends PlatformerSnapshotLike {
  readonly finished?: boolean;
}

function recordOf(snap: PlatformerSnapshotWithFinish): LabHudRecord & { finished: boolean } {
  return {
    x: Math.round(snap.body.x),
    y: Math.round(snap.body.y),
    grounded: snap.contacts.floor,
    checkpoints: snap.checkpoints.filter((cp) => cp.reached).length,
    checkpointTotal: snap.checkpoints.length,
    falls: 'falls' in snap ? Number((snap as { falls?: number }).falls ?? 0) : 0,
    finished: snap.finished === true,
  };
}

function hudEqual(
  first: LabHudRecord & { finished: boolean },
  second: LabHudRecord & { finished: boolean },
): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.grounded === second.grounded &&
    first.checkpoints === second.checkpoints &&
    first.finished === second.finished
  );
}

export interface PlatformerLabContentProps extends PlaygroundGameContentProps {
  /** Test seam: invoked exactly when a HUD record publishes. */
  readonly onHudPublish?: () => void;
}

export default function PlatformerLabContent({
  game,
  onExit,
  onHudPublish,
}: PlatformerLabContentProps) {
  const session = game as GameSession;
  const [hud, setHud] = useState<LabHudRecord | null>(null);

  // Quantized HUD publication driven by commit notifications; React state
  // only changes at the control-frequency cadence.
  const lastRef = useRef<{ at: number; record: (LabHudRecord & { finished: boolean }) | null }>({
    at: -Infinity,
    record: null,
  });
  useEffect(() => {
    const update = (): void => {
      const envelope = session.getRenderFrame() as unknown as {
        current?: PlatformerSnapshotWithFinish;
      };
      const snap = envelope.current;
      if (snap === undefined) return;
      // Publish only when the CADENCE comes due AND the quantized record
      // actually changed — a moving player updates ~8 Hz; an idle one never.
      const now = snap.elapsed;
      const next = recordOf(snap);
      const last = lastRef.current;
      if (!last.record) {
        lastRef.current = { at: now, record: next };
        setHud(next);
        onHudPublish?.();
        return;
      }
      const due = now - last.at >= DIAGNOSTIC_INTERVAL_SECONDS;
      if (!due || hudEqual(last.record, next)) return;
      lastRef.current = { at: now, record: next };
      setHud(next);
      onHudPublish?.();
    };
    update();
    const subscription = session.addCommitListener(update);
    return () => {
      subscription.remove();
    };
  }, [session, onHudPublish]);

  // Endgame overlay state: driven by the typed Task 13 'finish' and 'fall'
  // events, so each overlay shows the exact committed stats.
  const [endgame, setEndgame] = useState<{
    kind: 'clear' | 'fell';
    seconds: number;
    falls: number;
  } | null>(null);
  useEffect(() => {
    const finishSub = session.addGameEventListener('finish' as never, (event) => {
      const payload = (
        event as unknown as { payload: { elapsedSeconds: number; falls: number } }
      ).payload;
      setEndgame({ kind: 'clear', seconds: payload.elapsedSeconds, falls: payload.falls });
    });
    const fallSub = session.addGameEventListener('fall' as never, (event) => {
      const payload = (
        event as unknown as { payload: { elapsedSeconds: number; falls: number } }
      ).payload;
      setEndgame({ kind: 'fell', seconds: payload.elapsedSeconds, falls: payload.falls });
    });
    return () => {
      finishSub.remove();
      fallSub.remove();
    };
  }, [session]);

  const handleRestart = useCallback((): void => {
    session.restartScene();
    setEndgame(null);
  }, [session]);

  return (
    <View style={styles.screen} testID="platformer-lab-content">
      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.title}>Platformer Lab</Text>
        <Text style={styles.diag} testID="platformer-hud">
          {hud === null
            ? '…'
            : `x ${hud.x} · ${hud.grounded ? 'ground' : 'air'} · cp ${hud.checkpoints}/${hud.checkpointTotal} · falls ${hud.falls}`}
        </Text>
      </View>

      {/* Endgame overlays: block the controls and offer replay/exit. */}
      {endgame !== null ? (
        <View style={styles.clearOverlay} testID="platformer-clear" pointerEvents="auto">
          <Text style={styles.clearTitle}>
            {endgame.kind === 'clear' ? 'Course Clear!' : 'You Fell!'}
          </Text>
          <Text style={styles.clearStats}>
            {endgame.seconds.toFixed(1)}s · {endgame.falls}
            {endgame.falls === 1 ? ' fall' : ' falls'}
          </Text>
          <Pressable
            testID="platformer-replay"
            accessibilityRole="button"
            onPress={handleRestart}
            style={styles.clearButton}
          >
            <Text style={styles.buttonText}>
              {endgame.kind === 'clear' ? 'Replay' : 'Try Again'}
            </Text>
          </Pressable>
          <Pressable
            testID="platformer-exit-clear"
            accessibilityRole="button"
            onPress={onExit}
            style={[styles.clearButton, styles.exit]}
          >
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      ) : null}

      <GameButtonPad
        game={session}
        hitSlop={12}
        style={styles.controls}
        testID="platformer-controls"
      >
        {(['left', 'drop', 'jump', 'right'] as const).map((action) => (
          <GameButton
            key={action}
            action={action}
            testID={`platformer-${action}`}
            accessibilityRole="button"
            style={[
              styles.button,
              action === 'drop' ? styles.small : undefined,
              action === 'jump' ? styles.wide : undefined,
            ]}
          >
            <Text style={styles.buttonText}>
              {action === 'left'
                ? '\u2190'
                : action === 'right'
                  ? '\u2192'
                  : action === 'drop'
                    ? '\u2193'
                    : 'Jump'}
            </Text>
          </GameButton>
        ))}
      </GameButtonPad>
        <Pressable
          testID="platformer-back"
          accessibilityRole="button"
          onPress={onExit}
          style={[styles.button, styles.exit]}
        >
          <Text style={styles.buttonText}>{'\u2715'}</Text>
        </Pressable>
      {/* The paused overlay is owned by the shell; controls stay inert while
          paused because the session rejects sampled input. */}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hud: { position: 'absolute', top: 12, left: 16, zIndex: 10 },
  title: { color: 'white', fontSize: 16, fontWeight: '700' },
  diag: { color: '#94a3b8', fontSize: 11, fontVariant: ['tabular-nums'] },
  controls: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  button: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  small: { flex: 0, minWidth: 48 },
  wide: { flex: 1.4 },
  exit: { flex: 0, minWidth: 48, backgroundColor: 'rgba(248,113,113,0.25)' },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '700', fontSize: 15 },
  clearOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(8, 11, 18, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 20,
  },
  clearTitle: { color: '#fbbf24', fontSize: 28, fontWeight: '800' },
  clearStats: { color: '#94a3b8', fontSize: 15, fontVariant: ['tabular-nums'] },
  clearButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingVertical: 12,
    paddingHorizontal: 36,
    borderRadius: 10,
    minWidth: 160,
  },
});
