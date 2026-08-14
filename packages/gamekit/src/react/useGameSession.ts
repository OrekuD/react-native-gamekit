import { useEffect, useState } from 'react';
import { createGameSession } from '../core/session/createGameSession';
import type { GameSession } from '../core/session/types';
import type { GameDefinition, InputMap, SceneMap } from '../definition/types';

type SessionCreator<TScenes extends SceneMap, TInput extends InputMap> = (
  definition: GameDefinition<TScenes, TInput>,
) => GameSession<TScenes, TInput>;

interface OwnedSession<TScenes extends SceneMap, TInput extends InputMap> {
  /** The definition this session was created from, compared by identity. */
  readonly definition: GameDefinition<TScenes, TInput>;
  /** The live session owned by this hook instance. */
  readonly session: GameSession<TScenes, TInput>;
}

/**
 * Create and own a `GameSession` for a `GameDefinition`, with React
 * ownership.
 *
 * The hook creates an idle session during the commit phase, publishes it,
 * and disposes it exactly once when it is replaced or the owner unmounts.
 * React Strict Mode's development setup/cleanup rehearsal is safe: every
 * rehearsal session is disposed exactly once and a disposed session is never
 * published.
 *
 * Ownership rules:
 *
 * - The return value is `undefined` until React commits a live session for
 *   the current definition: the initial render, and the boundary while a
 *   definition replacement is being created. Render a deliberate fallback
 *   instead of hiding it.
 * - The same definition object returns the same session across re-renders.
 *   A different definition object unpublishes the old session, disposes it,
 *   and publishes a fresh one. Disposed sessions are never revived, so
 *   declaring definitions at module scope keeps identity stable.
 * - The hook owns terminal disposal. Do not call `session.dispose()` on a
 *   hook-owned session.
 * - The hook does not start the session. Pass it to `GameView`, which binds,
 *   starts, pauses on unmount/backgrounding, and never terminally disposes a
 *   borrowed session.
 * - For an asset-backed game, mount the component that calls this hook only
 *   after `useGameAssets()` reports `ready`; this hook does not load assets.
 *
 * Use `createGameSession()` with explicit `try/finally` disposal for headless
 * tests, non-React programs, and custom surface controllers that need to own
 * sessions imperatively.
 */
export function useGameSession<TScenes extends SceneMap, TInput extends InputMap>(
  definition: GameDefinition<TScenes, TInput>,
): GameSession<TScenes, TInput> | undefined {
  return useOwnedGameSession(definition, createGameSession);
}

/**
 * @internal
 *
 * The injectable-creator seam behind `useGameSession`, exported from this
 * module only (never from the `rn-gamekit/react` barrel). Tests supply a
 * deterministic creator (for example `createGameSessionWithDriver` with a
 * `ManualFrameDriver`, since node has no `requestAnimationFrame`) and must
 * pass a stable factory identity across renders.
 */
export function useOwnedGameSession<TScenes extends SceneMap, TInput extends InputMap>(
  definition: GameDefinition<TScenes, TInput>,
  create: SessionCreator<TScenes, TInput>,
): GameSession<TScenes, TInput> | undefined {
  const [owned, setOwned] = useState<OwnedSession<TScenes, TInput> | undefined>(undefined);

  // Render-phase selector: publish a session only while its definition is
  // the current prop and its status is not disposed. A replacement render
  // therefore unpublishes the old session before any effect runs, and
  // `undefined` is the only other value.
  const session =
    owned !== undefined &&
    owned.definition === definition &&
    owned.session.status !== 'disposed'
      ? owned.session
      : undefined;

  useEffect(() => {
    const next = create(definition);
    setOwned({ definition, session: next });
    return () => {
      next.dispose();
    };
  }, [definition, create]);

  return session;
}
