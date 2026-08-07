import { Canvas, type SkSize } from '@shopify/react-native-skia';
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { GameSession, RenderFrame } from '../core/session/types';
import { bindGameSession } from './bindGameSession';

/** Stable imperative values supplied to a Skia renderer component. */
export interface GameRendererProps<TSnapshot> {
  /** Latest session frame, updated without React state. */
  readonly frame: SharedValue<RenderFrame<TSnapshot>>;
  /** Actual canvas size, including iPad resizing and split view. */
  readonly surfaceSize: SharedValue<SkSize>;
}

/** Props for the first Skia-backed GameKit view. */
export interface GameViewProps<TActionName extends string, TSnapshot> {
  /** Externally owned headless game session. */
  readonly game: GameSession<TActionName, TSnapshot>;
  /** Stable Skia renderer component for the session snapshot type. */
  readonly renderer: ComponentType<GameRendererProps<TSnapshot>>;
  /** Static React HUD and controls mounted above the canvas. */
  readonly children?: ReactNode;
  /** Optional style for the mounted surface. */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Mount a headless GameSession into a Skia canvas.
 *
 * Presentation frames update Reanimated shared values directly. React owns
 * only the surface and static overlay tree; it is never the frame store.
 */
export function GameView<TActionName extends string, TSnapshot>({
  game,
  renderer: Renderer,
  children,
  style,
}: GameViewProps<TActionName, TSnapshot>) {
  const frame = useSharedValue<RenderFrame<TSnapshot>>(() => game.getRenderFrame());
  const surfaceSize = useSharedValue<SkSize>({ width: 0, height: 0 });

  useEffect(
    () =>
      bindGameSession(game, (nextFrame) => {
        frame.value = nextFrame;
      }),
    [frame, game],
  );

  return (
    <View style={[styles.surface, style]}>
      <Canvas style={StyleSheet.absoluteFill} onSize={surfaceSize}>
        <Renderer frame={frame} surfaceSize={surfaceSize} />
      </Canvas>
      {children === undefined ? null : (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
});
