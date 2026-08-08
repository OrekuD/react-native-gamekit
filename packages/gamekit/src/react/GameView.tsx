import { Canvas } from '@shopify/react-native-skia';
import {
  createContext,
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  AppState,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { InputMap, SceneMap } from '../definition/types';
import type { GameRenderFrame, GameSession } from '../core/session/types';
import type { ResolvedViewport2D } from '../viewport2d';
import { bindAppLifecycle } from './bindAppLifecycle';
import { bindGameSession } from './bindGameSession';
import { ViewportBinding } from './viewportBinding';

/** Stable imperative values supplied to a Skia renderer component. */
export interface GameRendererProps<TScenes extends SceneMap> {
  /** Latest session frame, updated without React state. */
  readonly frame: SharedValue<GameRenderFrame<TScenes>>;
  /** Latest resolved viewport shared with the input adapter. */
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
}

/** Props for the Skia-backed GameKit view. */
export interface GameViewProps<TScenes extends SceneMap, TInput extends InputMap> {
  /** Externally owned headless game session. */
  readonly game: GameSession<TScenes, TInput>;
  /** Stable Skia renderer component for the session's scene snapshots. */
  readonly renderer: ComponentType<GameRendererProps<TScenes>>;
  /** Static React HUD and controls mounted above the canvas. */
  readonly children?: ReactNode;
  /** Optional style for the mounted surface. */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Context supplying the shared resolved viewport to pointer input children.
 *
 * `GamePointerInput` consumes this binding so drawing and hit testing always
 * use the same resolved viewport instance for a layout revision.
 */
export const GameViewportContext = createContext<ViewportBinding | null>(null);

/**
 * Mount a headless GameSession into a Skia canvas.
 *
 * Presentation frames update Reanimated shared values directly and the
 * resolved viewport updates only on layout changes. React owns the surface
 * and static overlay tree; it is never the frame store. The session is
 * started while mounted, paused on cleanup and app backgrounding, and is
 * never disposed by this component — the creator owns disposal.
 */
export function GameView<TScenes extends SceneMap, TInput extends InputMap>({
  game,
  renderer: Renderer,
  children,
  style,
}: GameViewProps<TScenes, TInput>) {
  const frame = useSharedValue<GameRenderFrame<TScenes>>(() => game.getRenderFrame());
  const viewportValue = useSharedValue<ResolvedViewport2D | undefined>(undefined);

  const bindingRef = useRef<ViewportBinding | null>(null);
  if (bindingRef.current === null || bindingRef.current.config !== game.viewport) {
    bindingRef.current = new ViewportBinding(game.viewport);
  }
  const binding = bindingRef.current;

  useEffect(() => {
    const cleanupBinding = bindGameSession(game, (nextFrame) => {
      frame.value = nextFrame;
    });
    const cleanupLifecycle = bindAppLifecycle(AppState, {
      getStatus: () => game.status,
      pause: () => {
        if (game.status !== 'disposed') {
          game.pause();
        }
      },
      resume: () => {
        if (game.status !== 'disposed') {
          game.start();
        }
      },
    });
    return () => {
      cleanupLifecycle();
      cleanupBinding();
      binding.dispose();
    };
  }, [binding, frame, game]);

  return (
    <GameViewportContext.Provider value={binding}>
      <View
        style={[styles.surface, style]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          binding.setSurfaceSize({ width, height });
          viewportValue.value = binding.resolved;
        }}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Renderer frame={frame} viewport={viewportValue} />
        </Canvas>
        {children === undefined ? null : (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {children}
          </View>
        )}
      </View>
    </GameViewportContext.Provider>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
});
