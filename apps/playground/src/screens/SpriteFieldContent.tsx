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
import { useGameAssets } from 'react-native-gamekit/react';

import type { PlaygroundGameContentProps } from '../shell/PlaygroundGameContentProps';
import { spriteFieldAssets, type SpriteFieldSession, type PlaySnapshot } from '../games/spriteFieldGame';

export default function SpriteFieldContent({ game, onExit }: PlaygroundGameContentProps) {
  const session = game as SpriteFieldSession;
  const state = useGameAssets(spriteFieldAssets, { groups: ['boot', 'gameplay'] });
  const [hud, setHud] = useState<{ score: number; clip: string }>(() => {
    const play = session.getRenderFrame().current as PlaySnapshot;
    return { score: play.score, clip: play.animation.clip };
  });

  // Low-frequency overlay: the commit listener pushes only visible
  // score/clip changes into React state.
  useEffect(() => {
    return session.addCommitListener((frame) => {
      const play = frame.current as PlaySnapshot;
      setHud((previous) =>
        previous.score === play.score && previous.clip === play.animation.clip
          ? previous
          : { score: play.score, clip: play.animation.clip },
      );
    }).remove;
  }, [session]);

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.screen}>
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
              : `score ${hud.score} · ${hud.clip}`}
        </Text>
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
