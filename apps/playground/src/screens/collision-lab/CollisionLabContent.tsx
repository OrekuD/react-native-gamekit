import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GameSession } from 'rn-gamekit';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import type { CollisionLabSnapshot } from './collisionLabGame';

/**
 * Collision Lab content: the header, the control row OUTSIDE the gameplay
 * hit surface, and the value HUD.
 *
 * The HUD (T11-F7) only publishes LOW-FREQUENCY semantic records: pair,
 * toggles, the static contact scalars, and the candidate count. The
 * continuously changing sweep time is presented by the renderer's sweep
 * path instead of React state.
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

      <View pointerEvents="box-none" style={[styles.controls, { bottom: insets.bottom + 108 }]}>
        {(
          [
            ['cycle-pair', 'Pair'],
            ['toggle-sweep', 'Sweep'],
            ['toggle-filter', 'Filter'],
            ['cycle-anim', 'Anim'],
            ['toggle-debug', 'Debug'],
          ] as const
        ).map(([action, label]) => (
          <Pressable
            key={action}
            accessibilityLabel={`${label} toggle`}
            accessibilityRole="button"
            onPress={() => {
              session.input.press(action);
              session.input.release(action);
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <LabHud game={session} />
    </View>
  );
}

interface LabHudRecord {
  readonly pair: CollisionLabSnapshot['pair'];
  readonly swept: boolean;
  readonly filterEnabled: boolean;
  readonly debugVisible: boolean;
  readonly animation: CollisionLabSnapshot['animation'];
  readonly hit: { readonly depth: number; readonly nx: number; readonly ny: number; readonly px: number; readonly py: number } | undefined;
  /** Sweep-hit state (present or absent) with the value captured at the
   *  transition — the continuously changing time never republishes. */
  readonly sweptActive: boolean;
  readonly sweptHitTime: number | undefined;
  readonly candidates: number;
}

function hudEqual(first: LabHudRecord, second: LabHudRecord): boolean {
  if (
    first.pair !== second.pair ||
    first.swept !== second.swept ||
    first.filterEnabled !== second.filterEnabled ||
    first.debugVisible !== second.debugVisible ||
    first.animation !== second.animation ||
    first.candidates !== second.candidates ||
    first.sweptActive !== second.sweptActive
  ) {
    return false;
  }
  if (first.hit === undefined || second.hit === undefined) {
    return first.hit === second.hit;
  }
  return (
    first.hit.depth === second.hit.depth &&
    first.hit.nx === second.hit.nx &&
    first.hit.ny === second.hit.ny &&
    first.hit.px === second.hit.px &&
    first.hit.py === second.hit.py
  );
}

function recordOf(snap: CollisionLabSnapshot): LabHudRecord {
  return {
    pair: snap.pair,
    swept: snap.swept,
    filterEnabled: snap.filterEnabled,
    debugVisible: snap.debugVisible,
    animation: snap.animation,
    hit:
      snap.staticHit === undefined
        ? undefined
        : {
            depth: snap.staticHit.depth,
            nx: snap.staticHit.normal.x,
            ny: snap.staticHit.normal.y,
            px: snap.staticHit.point.x,
            py: snap.staticHit.point.y,
          },
    sweptActive: snap.sweptHit !== undefined,
    sweptHitTime: snap.sweptHit?.time,
    candidates: snap.candidates.length,
  };
}

export function LabHud({
  game,
  onPublish,
}: {
  readonly game: GameSession;
  /** Test instrumentation: called exactly when setDisplay publishes. */
  readonly onPublish?: () => void;
}) {
  // Deduplicated low-frequency HUD (T11-FF3): the last published record
  // lives in a ref; the commit callback compares BEFORE calling setState,
  // so no setter, updater, or render happens for unchanged commits.
  const [display, setDisplay] = useState<LabHudRecord | undefined>(undefined);
  const lastPublishedRef = useRef<LabHudRecord | undefined>(undefined);
  const onPublishRef = useRef(onPublish);
  // Ref writes belong in effects, never during render (hooks rule).
  useEffect(() => {
    onPublishRef.current = onPublish;
  });
  useEffect(() => {
    lastPublishedRef.current = undefined;
    const update = (frame: unknown): void => {
      const snap = (frame as { current: CollisionLabSnapshot }).current;
      const next = recordOf(snap);
      const last = lastPublishedRef.current;
      if (last !== undefined && hudEqual(last, next)) {
        return; // No setState at all for an unchanged semantic record.
      }
      lastPublishedRef.current = next;
      setDisplay(next);
      onPublishRef.current?.();
    };
    update(game.getRenderFrame());
    const subscription = game.addCommitListener(update);
    return () => {
      subscription.remove();
    };
  }, [game]);

  if (display === undefined) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.hud}>
      <Text style={styles.hudLine}>
        pair {display.pair} · sweep {display.swept ? 'on' : 'off'} · filter {display.filterEnabled ? 'on' : 'off'} · anim {display.animation} · debug {display.debugVisible ? 'on' : 'off'}
      </Text>
      <Text style={styles.hudLine}>
        contact{' '}
        {display.hit === undefined
          ? 'none'
          : `normal (${display.hit.nx.toFixed(2)}, ${display.hit.ny.toFixed(2)}) depth ${display.hit.depth.toFixed(2)} point (${display.hit.px.toFixed(1)}, ${display.hit.py.toFixed(1)})`}
      </Text>
      <Text style={styles.hudLine}>
        sweep {display.sweptActive ? `hit at t=${display.sweptHitTime?.toFixed(3)}` : 'no hit'} · candidates {display.candidates}
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
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
  },
  button: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonLabel: {
    color: '#e2e8f0',
    fontSize: 13,
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
