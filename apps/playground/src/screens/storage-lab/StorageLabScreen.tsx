import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LabHeader } from '../../components/LabHeader';
import { createGameSaveStore, createGameStorageAdapter, type GameStorageAdapter } from 'rn-gamekit/storage';

import {
  createStorageLabSession,
  projectStorageLabSave,
  storageLabSaveSchema,
  storageLabSettingsSchema,
  type StorageLabSave,
  type StorageLabSnapshot,
} from './storageLabGame';

type LoadState = 'loading' | 'ready' | 'error';
type LabSession = ReturnType<typeof createStorageLabSession>;

export type StorageLabScreenProps = {
  /** Playground shell back navigation — header uses the same design as Particle/Audio labs. */
  onExit?: () => void;
  /** Injectable adapter seam for mounted tests — playground uses AsyncStorage. */
  adapter?: GameStorageAdapter;
  /** Injectable session factory for deterministic driver tests — defaults to real session. */
  createSession?: (initial: StorageLabSave) => LabSession;
};

const DIAGNOSTIC_INTERVAL = 0.125;

/** Playground path uses the durable AsyncStorage adapter so settings/checkpoints survive reopening and restarts. */
function createPlaygroundAdapter(): GameStorageAdapter {
  return createGameStorageAdapter();
}

/**
 * The single owner of the ACTIVE request's resources. Button actions route
 * their writes through these request-owned stores so checkpoint, settings,
 * manual-save, and reset operations share per-slot queues and cannot
 * reorder against each other. Published only after creation; cleared only
 * by the cleanup that owns that exact request.
 */
interface RequestOwner {
  readonly requestId: number;
  readonly settingsStore: ReturnType<typeof createGameSaveStore>;
  readonly saveStore: ReturnType<typeof createGameSaveStore>;
  session: LabSession | null;
}

export default function StorageLabScreen({ onExit, adapter: injectedAdapter, createSession: injectedCreateSession }: StorageLabScreenProps) {
  // Identity of the request whose results are published. Replacement gating
  // happens AT RENDER TIME: when either incoming identity field differs from
  // the published one, the very first committed frame after the prop change
  // already renders the blocking loading state — there is no committed window
  // where the disposed request's controls stay interactive.
  //
  // T17-VF1: the two ACTUAL identity fields are stored and compared directly.
  // Correctness never depends on a memoized wrapper object surviving — React
  // may discard useMemo caches at any time.
  const [published, setPublished] = useState<{
    adapter: GameStorageAdapter | undefined;
    createSession: StorageLabScreenProps['createSession'];
  }>({
    adapter: injectedAdapter,
    createSession: injectedCreateSession,
  });
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<LabSession | null>(null);
  const [hud, setHud] = useState<{ x: number; checkpoint: number; ticks: number } | null>(null);
  const [status, setStatus] = useState('loading saves…');
  const [volume, setVolume] = useState(1);

  if (published.adapter !== injectedAdapter || published.createSession !== injectedCreateSession) {
    // Render-phase reset for the NEW props (documented React pattern): these
    // updates apply before this render commits, so the replacement never
    // paints the previous request's interactive UI. Same-props rerenders
    // (including Strict Mode double-invocations) fail both comparisons and
    // leave published ready state untouched.
    setPublished({ adapter: injectedAdapter, createSession: injectedCreateSession });
    setLoadState('loading');
    setSession(null);
    setHud(null);
    setError(null);
    setStatus('loading saves…');
  }

  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudLastRef = useRef<{ at: number; record: { x: number; checkpoint: number; ticks: number } | null }>({ at: -Infinity, record: null });
  const requestIdRef = useRef(0);
  const ownerRef = useRef<RequestOwner | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;

    // The blocking transition itself happens at render time (above); here we
    // only reset the HUD cadence bookkeeping for this generation.
    hudLastRef.current = { at: -Infinity, record: null };

    const adapter = injectedAdapter ?? createPlaygroundAdapter();
    const settingsStore = createGameSaveStore({ schema: storageLabSettingsSchema, adapter, namespace: 'storage-lab-settings' });
    const saveStore = createGameSaveStore({ schema: storageLabSaveSchema, adapter, namespace: 'storage-lab-save' });
    const owner: RequestOwner = { requestId, settingsStore, saveStore, session: null };
    ownerRef.current = owner;

    let ownedSub: { remove(): void } | null = null;

    /** Tear down THIS request's resources exactly once. */
    const teardown = (): void => {
      if (moveTimeoutRef.current !== null) {
        clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = null;
        // Release held input before disposing/replacing its session.
        try {
          owner.session?.input.release('right');
        } catch {}
      }
      ownedSub?.remove();
      ownedSub = null;
      // Only this request's cleanup may clear its own owner entry — never a
      // newer request's.
      if (ownerRef.current !== null && ownerRef.current.requestId === requestId) {
        ownerRef.current = null;
      }
      settingsStore.dispose();
      saveStore.dispose();
      if (owner.session !== null) {
        try {
          owner.session.dispose();
        } catch {}
        owner.session = null;
      }
    };

    (async () => {
      try {
        const [settingsRes, saveRes] = await Promise.all([settingsStore.load('player'), saveStore.load('profile-1')]);
        if (cancelled || requestIdRef.current !== requestId) {
          teardown();
          return;
        }
        setVolume(settingsRes.data.volume);
        const initialSave = saveRes.data;
        const createSessionFn = injectedCreateSession ?? createStorageLabSession;
        const nextSession = createSessionFn(initialSave);
        owner.session = nextSession;
        if (cancelled || requestIdRef.current !== requestId) {
          teardown();
          return;
        }
        const sub = nextSession.addGameEventListener('checkpoint', async (event) => {
          if (requestIdRef.current !== requestId) return;
          // The payload carries the projection captured at the committed boundary —
          // no getRenderFrame() call, which can lag the emitting commit at delivery time.
          // DeepReadonly payload → owned mutable copy (store re-validates and clones anyway).
          const projected: StorageLabSave = {
            ...event.payload.save,
            unlockedLevels: [...event.payload.save.unlockedLevels],
          };
          setStatus(`checkpoint ${event.payload.index} → saving…`);
          try {
            // Same request-owned saveStore the buttons use — shared per-slot queue.
            await saveStore.save('profile-1', projected);
            await saveStore.flush();
            if (requestIdRef.current !== requestId) return;
            setStatus(`checkpoint ${event.payload.index} saved`);
          } catch (e) {
            if (requestIdRef.current !== requestId) return;
            setStatus(`checkpoint save failed: ${(e as Error).message}`);
          }
        });
        ownedSub = sub;
        setSession(nextSession);
        setLoadState('ready');
        setStatus(`loaded ${saveRes.status} (checkpoint ${initialSave.checkpointIndex})`);
      } catch (e) {
        if (cancelled || requestIdRef.current !== requestId) return;
        setError((e as Error).message);
        setLoadState('error');
        setStatus(`load failed: ${(e as Error).message}`);
      }
    })();

    return () => {
      // Invalidate first so in-flight completions cannot publish into a
      // replacement, then tear down this exact request's resources.
      if (requestIdRef.current === requestId) {
        requestIdRef.current += 1;
      }
      cancelled = true;
      teardown();
    };
  }, [injectedAdapter, injectedCreateSession]);

  // HUD publication from committed-frame boundary at bounded cadence, not every RAF.
  useEffect(() => {
    if (!session || loadState !== 'ready') return;
    const updateHud = (): void => {
      const snap = session.getRenderFrame().current as unknown as StorageLabSnapshot | undefined;
      if (!snap) return;
      const at = snap.ticks * (1 / 60);
      const next = { x: Math.round(snap.x), checkpoint: snap.checkpointIndex, ticks: snap.ticks };
      const last = hudLastRef.current;
      if (!last.record || at - last.at >= DIAGNOSTIC_INTERVAL) {
        const changed = !last.record || last.record.x !== next.x || last.record.checkpoint !== next.checkpoint || last.record.ticks !== next.ticks;
        if (changed) {
          hudLastRef.current = { at, record: next };
          setHud(next);
        }
      }
    };
    updateHud();
    const sub = session.addCommitListener(updateHud);
    session.start();
    // HUD publication cleanup — session may already be disposed by the owning
    // loading-effect cleanup (React destroys effects in definition order), so guard.
    return () => {
      sub.remove();
      try {
        if (session.status !== 'disposed') session.pause();
      } catch {}
    };
  }, [session, loadState]);

  /** Snapshot the active owner at action acceptance; guards use the captured id. */
  function activeOwner(): RequestOwner | null {
    const owner = ownerRef.current;
    if (owner === null || owner.session === null || owner.session.status === 'disposed') return null;
    return owner;
  }

  const mutateSettings = async (nextVolume: number): Promise<void> => {
    const owner = activeOwner();
    if (owner === null) return;
    const requestId = owner.requestId;
    setVolume(nextVolume);
    setStatus('settings saving…');
    try {
      await owner.settingsStore.save('player', { volume: nextVolume, muted: nextVolume === 0, language: 'en' });
      await owner.settingsStore.flush();
      if (ownerRef.current?.requestId !== requestId) return;
      setStatus(`settings saved (volume ${nextVolume.toFixed(2)})`);
    } catch (e) {
      if (ownerRef.current?.requestId !== requestId) return;
      setStatus(`settings failed: ${(e as Error).message}`);
    }
  };

  const triggerManualSave = async (): Promise<void> => {
    const owner = activeOwner();
    if (owner === null) return;
    const requestId = owner.requestId;
    const snap = owner.session!.getRenderFrame().current as unknown as StorageLabSnapshot;
    const projected = projectStorageLabSave(snap);
    setStatus('manual save…');
    try {
      await owner.saveStore.save('profile-1', projected);
      await owner.saveStore.flush();
      if (ownerRef.current?.requestId !== requestId) return;
      setStatus(`manual save complete (checkpoint ${projected.checkpointIndex})`);
    } catch (e) {
      if (ownerRef.current?.requestId !== requestId) return;
      setStatus(`save failed: ${(e as Error).message}`);
    }
  };

  const resetSave = async (): Promise<void> => {
    const owner = activeOwner();
    if (owner === null) return;
    const requestId = owner.requestId;
    setStatus('save resetting…');
    try {
      await owner.saveStore.remove('profile-1');
      await owner.saveStore.flush();
      if (ownerRef.current?.requestId !== requestId) return;
      setStatus('save reset — reload to resume from default');
    } catch (e) {
      if (ownerRef.current?.requestId !== requestId) return;
      setStatus(`reset failed: ${(e as Error).message}`);
    }
  };

  const handleMoveRight = (): void => {
    if (!session || session.status === 'disposed') return;
    session.input.press('right');
    if (moveTimeoutRef.current !== null) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = setTimeout(() => {
      try {
        if (session.status !== 'disposed') session.input.release('right');
      } catch {}
      moveTimeoutRef.current = null;
    }, 200);
  };

  if (loadState === 'loading') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Storage Lab</Text>
        <Text style={styles.line}>{status}</Text>
      </View>
    );
  }
  if (loadState === 'error') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Storage Lab — load error</Text>
        <Text style={styles.line}>{error}</Text>
        <Text style={styles.hint}>Corrupt/future-version/migration failures surface here and never corrupt the stored record.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LabHeader title="Storage Lab" onExit={onExit} testID="storage-back" />
      <View style={styles.body}>
      <Text style={styles.line}>x {hud?.x ?? 0} · checkpoint {hud?.checkpoint ?? -1} · ticks {hud?.ticks ?? 0}</Text>
      <Text style={styles.line}>{status}</Text>
      <Text style={styles.hint}>Checkpoint events commit deterministically; saves happen async after the tick and never block simulation.</Text>

      <View style={styles.row}>
        <Pressable onPress={handleMoveRight} style={styles.button}>
          <Text style={styles.buttonText}>Move right</Text>
        </Pressable>
        <Pressable onPress={triggerManualSave} style={styles.button}>
          <Text style={styles.buttonText}>Save now</Text>
        </Pressable>
        <Pressable onPress={resetSave} style={[styles.button, styles.danger]}>
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable onPress={() => mutateSettings(Math.max(0, volume - 0.1))} style={styles.button}>
          <Text style={styles.buttonText}>Vol −</Text>
        </Pressable>
        <Text style={styles.line}>vol {volume.toFixed(2)}</Text>
        <Pressable onPress={() => mutateSettings(Math.min(1, volume + 0.1))} style={styles.button}>
          <Text style={styles.buttonText}>Vol +</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>Settings are saved on user change, not every tick. Saves are per-slot serialized; stale store writes are rejected.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  backButton: { backgroundColor: 'rgba(255,255,255,0.14)', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, minWidth: 36, alignItems: 'center' },
  backText: { color: 'white', fontSize: 14, fontWeight: '700' },
  headerSpacer: { flex: 1 },
  body: { flex: 1, padding: 16, gap: 8, justifyContent: 'center' },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  line: { color: '#cbd5e1', fontSize: 13 },
  hint: { color: '#64748b', fontSize: 11 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  button: { backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  danger: { backgroundColor: 'rgba(248,113,113,0.2)' },
  buttonText: { color: 'white', fontSize: 12, fontWeight: '600' },
});
