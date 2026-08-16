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
import { useCameraLabInstrumentation, type CameraLabCounters } from './cameraLabInstrumentation';
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
  readonly rawTouches: number;
  readonly forwarded: number;
  readonly committed: number;
  readonly accepted: number;
  readonly rejectedLayoutEpoch: number;
  readonly rejectedBinding: number;
  readonly presentedCommits: number;
  readonly uiObserved: number;
  readonly roundTripError: number;
}

function recordOf(snap: CameraLabSnapshot, counters: CameraLabCounters, committed: number): LabHudRecord {
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
    rawTouches: counters.rawTouches,
    forwarded: counters.forwarded,
    committed,
    accepted: counters.accepted,
    rejectedLayoutEpoch: counters.rejectedLayoutEpoch,
    rejectedBinding: counters.rejectedBinding,
    presentedCommits: counters.presentedCommits,
    uiObserved: counters.uiObserved,
    roundTripError: counters.roundTripError,
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
    first.total === second.total &&
    first.rawTouches === second.rawTouches &&
    first.forwarded === second.forwarded &&
    first.committed === second.committed &&
    first.accepted === second.accepted &&
    first.rejectedLayoutEpoch === second.rejectedLayoutEpoch &&
    first.rejectedBinding === second.rejectedBinding &&
    first.presentedCommits === second.presentedCommits &&
    first.uiObserved === second.uiObserved &&
    first.roundTripError === second.roundTripError
  );
}

/** Diagnostic publication cadence (T12-F7): ~8 Hz regardless of camera
 * speed; whole-unit buckets alone are not a frequency guarantee. */
const DIAGNOSTIC_INTERVAL_SECONDS = 0.125;

export default function CameraLabContent({
  game,
  onExit,
  onPublish,
  onRunSurfaceEvent,
}: PlaygroundGameContentProps & {
  /** Test instrumentation: called exactly when a HUD record publishes. */
  readonly onPublish?: () => void;
}) {
  const session = game as GameSession;
  const insets = useSafeAreaInsets();
  // T12-F8: the lab owns one instrumentation pair attached to the shell's
  // GameView/GamePointerInput for the lifetime of this content. The forced
  // rerender control never replaces it, remounts the canvas, or rebuilds
  // the gesture. Counters are read inside the commit listener (never
  // during render) and published through the HUD record at the cadence.
  const [rerenderBump, setRerenderBump] = useState(0);
  const onRunSurfaceEventRef = useRef(onRunSurfaceEvent);
  useEffect(() => {
    onRunSurfaceEventRef.current = onRunSurfaceEvent;
  });
  // T12-RF2: the instrumentation is hook-owned (shared-value counters,
  // stable workletized callbacks). Attach exactly once per mount; the
  // forced rerender never replaces it.
  const instrumentation = useCameraLabInstrumentation();
  const instrumentationRef = useRef(instrumentation);
  useEffect(() => {
    instrumentationRef.current = instrumentation;
  });
  useEffect(() => {
    const current = instrumentationRef.current;
    current.setActive(true);
    onRunSurfaceEventRef.current?.({
      kind: 'instrumentation-attached',
      session,
      instrumentation: {
        pointer: current.pointer,
        view: current.view,
      },
    });
    return () => {
      current.setActive(false);
      if (game.status !== 'disposed') {
        onRunSurfaceEventRef.current?.({ kind: 'instrumentation-detached', session });
      }
    };
  }, [game, session]);
  const [display, setDisplay] = useState<LabHudRecord | undefined>(undefined);
  const lastPublishedRef = useRef<LabHudRecord | undefined>(undefined);
  const lastPublishedAtRef = useRef<number>(-Infinity);
  const onPublishRef = useRef(onPublish);
  useEffect(() => {
    onPublishRef.current = onPublish;
  });

  useEffect(() => {
    lastPublishedRef.current = undefined;
    const update = (frame: unknown): void => {
      const snap = (frame as { current: CameraLabSnapshot }).current;
      // T12-F7: pre-setter dedupe AND an explicit cadence — quantized
      // buckets can change every fixed step while the camera moves.
      if (snap.elapsed - lastPublishedAtRef.current < DIAGNOSTIC_INTERVAL_SECONDS) {
        return;
      }
      const counters = instrumentationRef.current?.readCounters() ?? {
        rawTouches: 0,
        forwarded: 0,
        accepted: 0,
        rejectedLayoutEpoch: 0,
        rejectedBinding: 0,
        presentedCommits: 0,
        uiObserved: 0,
        roundTripError: 0,
      };
      const next = recordOf(snap, counters, (session.input as { sampledCount?: number }).sampledCount ?? 0);
      const last = lastPublishedRef.current;
      if (last !== undefined && hudEqual(last, next)) {
        return;
      }
      lastPublishedRef.current = next;
      lastPublishedAtRef.current = snap.elapsed;
      setDisplay(next);
      onPublishRef.current?.();
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

  // T12-F8: a forced React rerender while a drag stays active. It must not
  // remount the Canvas, replace the gesture, or reset the camera binding —
  // this content lives outside GameView, and the attached instrumentation
  // is ref-owned, so the bump only re-renders the overlay.
  const forceRerender = (): void => {
    setRerenderBump((current) => current + 1);
  };

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
        <Pressable
          accessibilityLabel="Force a React rerender"
          accessibilityRole="button"
          onPress={forceRerender}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Rerender</Text>
        </Pressable>
      </View>

      {display === undefined ? null : (
        <View pointerEvents="none" style={[styles.hud, { bottom: insets.bottom + 40 }]}>
          <Text style={styles.hudLine}>
            cam ({display.cx}, {display.cy}) · ×{display.zoom.toFixed(2)} · rot {display.rotation.toFixed(2)}
          </Text>
          <Text style={styles.hudLine}>
            {display.visible}/{display.total} markers · follow {display.follow ? 'on' : 'off'} · rotate {display.rotating ? 'on' : 'off'} · shake {display.shaking ? 'on' : 'off'} · cull {display.culling ? 'on' : 'off'} · bounds {display.debug ? 'on' : 'off'}
          </Text>
          <Text style={styles.hudLine}>
            raw {display.rawTouches} · fwd {display.forwarded} · accepted {display.accepted} · committed {display.committed} · stale-layout {display.rejectedLayoutEpoch} · stale-binding {display.rejectedBinding} · commits {display.presentedCommits} · ui {display.uiObserved} · rt {display.roundTripError.toExponential(1)} · bump {rerenderBump}
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
