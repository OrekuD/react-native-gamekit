import type { GameSession } from 'react-native-gamekit';
import type { GameAssetsState } from 'react-native-gamekit/react';
import type { PlaygroundGameId } from '../catalog/games';
import type { RunSurfaceEvent } from './runSurfaceState';

/**
 * Props the shell supplies to every game content component.
 *
 * Game content renders inside the shell-owned GameView surface; it never
 * mounts GameView or GamePointerInput itself. `onRunSurfaceEvent` transfers a
 * lab run session and its instrumentation to the shell as one owned
 * attachment.
 */
export interface PlaygroundGameContentProps {
  /** The shell-owned session for this game. */
  readonly game: GameSession;
  /** Close the game and return to the catalog. */
  readonly onExit: () => void;
  /** Open another catalog game through the shell's session owner. */
  readonly onOpenGame: (gameId: PlaygroundGameId) => void;
  /** Attach or detach a shell-owned temporary lab surface. */
  readonly onRunSurfaceEvent?: (event: RunSurfaceEvent) => void;
  /** The shell-owned asset loading state for asset-backed games (R2). */
  readonly assetState?: GameAssetsState<
    import('react-native-gamekit').AssetGroupMap
  >;
}
