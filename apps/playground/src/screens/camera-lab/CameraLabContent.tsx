/**
 * Camera Lab content (T12.8): the control row and the quantized HUD.
 *
 * The HUD publishes camera center, zoom, and culling counts only when the
 * quantized record changes, so a moving camera never drives React per
 * frame. Controls issue button presses into the session, exactly like the
 * Collision Lab.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GameSession } from 'rn-gamekit';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import type { CameraLabSnapshot } from './cameraLabGame';

interface LabHudRecord {
  readonly follow: boolean;
  readonly rotating: boolean;
  readonly shaking: boolean;
  readonly culling: boolean;
  readonly debug: boolean;
  readonly zoom: number;
  readonly cx: number;
  readonly cy: number;
  readonly rotation: number;
  readonly visible: number;
  readonly total: number;
}

function recordOf(snap: CameraLabSnapshot): LabHudRecord {
  return {
    follow: snap.follow,
    rotating: snap.rotating,
    shaking: snap.shaking,
    culling: snap.culling,
    debug: snap.debug,
    zoom: Math.round(snap.camera.zoom * 100) / 100,
    cx: Math.round(snap.camera.center.x),
    cy: Math.round(snap.camera.center.y),
    rotation: Math.round(snap.camera.rotationRadians * 100) / 100,
    visible: snap.visibleMarkerIds.length,
    total: snap.markers.length,
  };
}

function hudEqual(first: LabHudRecord, second: LabHudRecord): boolean {
  return (
    first.follow === second.follow &&
    first.rotating === second.rotating &&
    first.shaking === second.shaking &&
    first.culling === second.culling &&
    first.debug === second.debug &&
    first.zoom === second.zoom &&
    first.cx === second.cx &&
    first.cy === second.cy &&
    first.rotation === second.rotation &&
    first.visible === second.visible &&
    first.total === second.total
  );
}

export default function CameraLabContent({ game, onExit }: PlaygroundGameContentProps) {
  const session = game as GameSession;
  const insets = useSafeAreaInsets();
  const [display, setDisplay] = useState<LabHudRecord | undefined>(undefined);
  const lastPublishedRef = useRef<LabHudRecord | undefined>(undefined);

  useEffect(() => {
    lastPublishedRef.current = undefined;
    const update = (frame: unknown): void => {
      const snap = (frame as { current: CameraLabSnapshot }).current;
      const next = recordOf(snap);
      const last = lastPublishedRef.current;
      if (last !== undefined && hudEqual(last, next)) {
        return;
      }
      lastPublishedRef.current = next;
      setDisplay(next);
    };
    update(session.getRenderFrame());
    const subscription = session.addCommitListener(update);
    return () => {
      subscription.remove();
    };
  }, [session]);

  const actions = [
    ['toggle-follow', 'Follow'],
    ['cycle-zoom', 'Zoom'],
    ['toggle-rotation', 'Rotate'],
    ['toggle-shake', 'Shake'],
    ['trigger-cut', 'Cut'],
    ['toggle-debug', 'Bounds'],
    ['toggle-culling', 'Cull'],
  ] as const;

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
          <Text style={styles.backLabel}>‹ Playground</Text>
        </Pressable>
        <Text style={styles.title}>Camera Lab</Text>
      </View>

      <View pointerEvents="box-none" style={[styles.controls, { bottom: insets.bottom + 92 }]}>
        {actions.map(([action, label]) => (
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

      {display === undefined ? null : (
        <View pointerEvents="none" style={[styles.hud, { bottom: insets.bottom + 40 }]}>
          <Text style={styles.hudLine}>
            cam ({display.cx}, {display.cy}) · ×{display.zoom.toFixed(2)} · rot {display.rotation.toFixed(2)}
          </Text>
          <Text style={styles.hudLine}>
            {display.visible}/{display.total} markers · follow {display.follow ? 'on' : 'off'} · rotate {display.rotating ? 'on' : 'off'} · shake {display.shaking ? 'on' : 'off'} · cull {display.culling ? 'on' : 'off'} · bounds {display.debug ? 'on' : 'off'}
          </Text>
        </View>
      )}
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
  title: {
    color: '#e2e8f0',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 10,
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
