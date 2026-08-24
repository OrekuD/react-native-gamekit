/**
 * Platformer Lab content: touch controls, a quantized HUD, and pause/back.
 *
 * Controls issue button presses into the session's input buffer — exactly
 * like the Camera/Collision labs. The HUD publishes position, contact and
 * checkpoint facts only when the quantized record changes (~8 Hz cadence);
 * a moving player never drives React per frame.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameSession } from 'rn-gamekit';

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
}

function recordOf(snap: PlatformerSnapshotLike): LabHudRecord {
  return {
    x: Math.round(snap.body.x),
    y: Math.round(snap.body.y),
    grounded: snap.contacts.floor,
    checkpoints: snap.checkpoints.filter((cp) => cp.reached).length,
    checkpointTotal: snap.checkpoints.length,
  };
}

function hudEqual(first: LabHudRecord, second: LabHudRecord): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.grounded === second.grounded &&
    first.checkpoints === second.checkpoints
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

  const heldActions = useRef<Set<string>>(new Set());
  const press = (action: string): void => {
    heldActions.current.add(action);
    (session.input as unknown as { press: (action: string) => void }).press(action);
  };
  const release = (action: string): void => {
    heldActions.current.delete(action);
    (session.input as unknown as { release: (action: string) => void }).release(action);
  };

  // Quantized HUD publication driven by commit notifications; React state
  // only changes at the control-frequency cadence.
  const lastRef = useRef<{ at: number; record: LabHudRecord | null }>({ at: -Infinity, record: null });
  useEffect(() => {
    // The SAME Set instance lives for the whole screen lifetime; capturing
    // it here keeps the cleanup valid without depending on the ref box.
    const held = heldActions.current;
    const update = (): void => {
      const envelope = session.getRenderFrame() as unknown as {
        current?: PlatformerSnapshotLike;
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
      // Unmount releases every held control: no input outlives this screen.
      for (const action of [...held]) {
        held.delete(action);
        (session.input as unknown as { release: (action: string) => void }).release(action);
      }
    };
  }, [session, onHudPublish]);

  return (
    <View style={styles.screen} testID="platformer-lab-content">
      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.title}>Platformer Lab</Text>
        <Text style={styles.diag} testID="platformer-hud">
          {hud === null
            ? '…'
            : `x ${hud.x} · ${hud.grounded ? 'ground' : 'air'} · cp ${hud.checkpoints}/${hud.checkpointTotal}`}
        </Text>
      </View>

      <View style={styles.controls} testID="platformer-controls">
        <Pressable
          testID="platformer-left"
          accessibilityRole="button"
          onPressIn={() => press('left')}
          onPressOut={() => release('left')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{'\u2190'}</Text>
        </Pressable>
        <Pressable
          testID="platformer-drop"
          accessibilityRole="button"
          onPressIn={() => press('drop')}
          onPressOut={() => release('drop')}
          style={[styles.button, styles.small]}
        >
          <Text style={styles.buttonText}>{'\u2193'}</Text>
        </Pressable>
        <Pressable
          testID="platformer-jump"
          accessibilityRole="button"
          onPressIn={() => press('jump')}
          // T16-RF3: a jump is a one-tick pulse — the release edge MUST
          // fire so later presses register as new press edges.
          onPressOut={() => release('jump')}
          onTouchEnd={() => release('jump')}
          onTouchCancel={() => release('jump')}
          style={[styles.button, styles.wide]}
        >
          <Text style={styles.buttonText}>Jump</Text>
        </Pressable>
        <Pressable
          testID="platformer-right"
          accessibilityRole="button"
          onPressIn={() => press('right')}
          onPressOut={() => release('right')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{'\u2192'}</Text>
        </Pressable>
        <Pressable
          testID="platformer-back"
          accessibilityRole="button"
          onPress={onExit}
          style={[styles.button, styles.exit]}
        >
          <Text style={styles.buttonText}>{'\u2715'}</Text>
        </Pressable>
      </View>
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
});
