import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GameSession } from 'rn-gamekit';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import type { CollisionLabSnapshot } from './collisionLabGame';

/**
 * Collision Lab content: the header, the control row OUTSIDE the gameplay
 * hit surface, and the value HUD. Buttons drive the session's declared
 * button actions; the scene computes every displayed value.
 */
export default function CollisionLabContent({ game, onExit }: PlaygroundGameContentProps) {
  const session = game as GameSession;
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={styles.safeArea}>
      <View pointerEvents="box-none" style={[styles.header, { paddingTop: insets.top + 44 }]}>
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onExit}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={[styles.controls, { bottom: insets.bottom + 96 }]}>
        <Pressable
          accessibilityLabel="Cycle the shape pair"
          accessibilityRole="button"
          onPress={() => {
            session.input.press('cycle-pair');
            session.input.release('cycle-pair');
          }}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Pair</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Toggle the swept projectile"
          accessibilityRole="button"
          onPress={() => {
            session.input.press('toggle-sweep');
            session.input.release('toggle-sweep');
          }}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Sweep</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Toggle collision filtering"
          accessibilityRole="button"
          onPress={() => {
            session.input.press('toggle-filter');
            session.input.release('toggle-filter');
          }}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Filter</Text>
        </Pressable>
      </View>

      <LabHud game={session} />
    </View>
  );
}

function LabHud({ game }: { readonly game: GameSession }) {
  // Low-frequency HUD: subscribe to commits (60 Hz) instead of rendering
  // every frame; unchanged snapshots keep the previous state object.
  const [current, setCurrent] = useState<CollisionLabSnapshot | undefined>(undefined);
  useEffect(() => {
    const update = (frame: unknown): void => {
      setCurrent((frame as { current: CollisionLabSnapshot }).current);
    };
    update(game.getRenderFrame());
    const subscription = game.addCommitListener(update);
    return () => {
      subscription.remove();
    };
  }, [game]);
  if (current === undefined) {
    return null;
  }
  const hit = current.staticHit;
  return (
    <View pointerEvents="none" style={styles.hud}>
      <Text style={styles.hudLine}>
        pair {current.pair} · sweep {current.swept ? 'on' : 'off'} · filter {current.filterEnabled ? 'on' : 'off'}
      </Text>
      <Text style={styles.hudLine}>
        contact {hit === undefined ? 'none' : `normal (${hit.normal.x.toFixed(2)}, ${hit.normal.y.toFixed(2)}) depth ${hit.depth.toFixed(2)}`}
      </Text>
      <Text style={styles.hudLine}>
        sweep time {current.sweptHit === undefined ? '-' : current.sweptHit.time.toFixed(3)} · candidates {current.candidates.length}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    left: 20,
    position: 'absolute',
    right: 20,
    top: 0,
  },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  button: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  hud: {
    bottom: 48,
    left: 16,
    position: 'absolute',
    right: 16,
  },
  hudLine: {
    color: '#94a3b8',
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    marginBottom: 2,
  },
});
