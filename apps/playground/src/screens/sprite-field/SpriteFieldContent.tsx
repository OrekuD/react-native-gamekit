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
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import { type SpriteFieldSession, type PlaySnapshot } from './spriteFieldGame';

export default function SpriteFieldContent({
  game,
  onExit,
  assetState,
}: PlaygroundGameContentProps) {
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

  // Render-phase: initialize the HUD from the real session exactly when it
  // becomes available (the sanctioned adjust-during-render pattern).
  if (session !== null && hud === null) {
    const play = session.getRenderFrame().current as PlaySnapshot;
    setHud({
      score: play.score,
      clip: play.animation.clip,
      animationMode: play.animationMode,
    });
  }

  // Low-frequency overlay: subscribed only to the real session's commits.
  useEffect(() => {
    if (session === null) {
      return;
    }
    return session.addCommitListener((frame) => {
      const snapshot = frame.current as PlaySnapshot;
      setHud((previous) =>
        previous !== null &&
        previous.score === snapshot.score &&
        previous.clip === snapshot.animation.clip &&
        previous.animationMode === snapshot.animationMode
          ? previous
          : {
              score: snapshot.score,
              clip: snapshot.animation.clip,
              animationMode: snapshot.animationMode,
            },
      );
    }).remove;
  }, [session]);

  return (
    <SafeAreaView pointerEvents="box-none" edges={['top', 'right', 'bottom', 'left']} style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onExit}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Playground</Text>
        </Pressable>
        <Text style={styles.title}>Sprite Field</Text>
        <Text style={styles.meta}>
          {state.status === 'loading'
            ? `loading ${Math.round(state.progress * 100)}%`
            : state.status === 'error'
              ? 'load failed'
              : hud === null
                ? 'ready'
                : `score ${hud.score} · ${hud.clip}`}
        </Text>
      </View>

      <View pointerEvents="box-none" style={styles.animationControls}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
