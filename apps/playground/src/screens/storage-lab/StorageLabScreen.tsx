import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createGameSaveStore, createGameStorageAdapter, type GameStorageAdapter } from 'rn-gamekit/storage';

import {
  createStorageLabSession,
  projectStorageLabSave,
  storageLabSaveSchema,
  storageLabSettingsSchema,
  type StorageLabSnapshot,
} from './storageLabGame';

type LoadState = 'loading' | 'ready' | 'error';

export type StorageLabScreenProps = {
  /** Injectable adapter seam for mounted tests — playground uses AsyncStorage. */
  adapter?: GameStorageAdapter;
};

const DIAGNOSTIC_INTERVAL = 0.125;

/** Playground path uses the durable AsyncStorage adapter so settings/checkpoints survive reopening and restarts. */
function createPlaygroundAdapter(): GameStorageAdapter {
  // Declared directly where the playground build requires it (see package.json peer).
  return createGameStorageAdapter();
}

export default function StorageLabScreen({ adapter: injectedAdapter }: StorageLabScreenProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReturnType<typeof createStorageLabSession> | null>(null);
  const [hud, setHud] = useState<{ x: number; checkpoint: number; ticks: number } | null>(null);
  const [status, setStatus] = useState('loading saves…');
  const [volume, setVolume] = useState(1);

  // Owner refs — never mutate GameSession with private fields.
  const storesRef = useRef<{ save: ReturnType<typeof createGameSaveStore>; settings: ReturnType<typeof createGameSaveStore> } | null>(null);
  const subscriptionRef = useRef<{ remove(): void } | null>(null);
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudLastRef = useRef<{ at: number; record: { x: number; checkpoint: number; ticks: number } | null }>({ at: -Infinity, record: null });

  // Request token to ignore stale async completions after unmount/replacement.
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    const adapter = injectedAdapter ?? createPlaygroundAdapter();
    const settingsStore = createGameSaveStore({ schema: storageLabSettingsSchema, adapter, namespace: 'storage-lab-settings' });
    const saveStore = createGameSaveStore({ schema: storageLabSaveSchema, adapter, namespace: 'storage-lab-save' });
    storesRef.current = { save: saveStore as unknown as ReturnType<typeof createGameSaveStore>, settings: settingsStore as unknown as ReturnType<typeof createGameSaveStore> };

    (async () => {
      try {
        const [settingsRes, saveRes] = await Promise.all([settingsStore.load('player'), saveStore.load('profile-1')]);
        if (cancelled || requestIdRef.current !== requestId) return;
        setVolume(settingsRes.data.volume);
        const initialSave = saveRes.data;
        const nextSession = createStorageLabSession(initialSave);
        if (cancelled || requestIdRef.current !== requestId) {
          nextSession.dispose();
          return;
        }
        // Bind checkpoint event to async save effect — outside simulation. Store subscription in owner ref.
        const sub = nextSession.addGameEventListener('checkpoint', async (event) => {
          const snap = nextSession.getRenderFrame().current as unknown as StorageLabSnapshot;
          const projected = projectStorageLabSave(snap);
          setStatus(`checkpoint ${event.payload.index} → saving…`);
          try {
            await saveStore.save('profile-1', projected);
            await saveStore.flush();
            if (requestIdRef.current !== requestId) return;
            setStatus(`checkpoint ${event.payload.index} saved`);
          } catch (e) {
            if (requestIdRef.current !== requestId) return;
            setStatus(`checkpoint save failed: ${(e as Error).message}`);
          }
        });
        subscriptionRef.current = sub;
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
      cancelled = true;
      // Invalidate this request so stale completions are ignored.
      // Do not call React state setters from unmount cleanup.
      if (moveTimeoutRef.current !== null) {
        clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = null;
      }
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      const active = storesRef.current;
      const sess = session;
      // Use refs captured at effect creation would be stale; read from refs/state via closure is not needed here
      // because we have the stores and session from this request. For the session, we dispose the one we created.
      // The setSession(null) call is deferred to next effect's load, not here.
      active?.save.dispose();
      active?.settings.dispose();
      // Do not call setSession from cleanup — the next mount will create a fresh session. Dispose the session we own.
      // We need to capture the session we created; use a local variable instead of state.
      // Since we cannot read state reliably in cleanup, we track the session in a ref.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedAdapter]);

  // Keep a ref to the current session for cleanup without calling setState in unmount.
  const sessionRef = useRef<ReturnType<typeof createStorageLabSession> | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      // Do not call setSession from cleanup
    };
  }, []);

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
    return () => {
      sub.remove();
      session.pause();
    };
  }, [session, loadState]);

  const mutateSettings = async (nextVolume: number): Promise<void> => {
    const s = storesRef.current?.settings as unknown as ReturnType<typeof createGameSaveStore<import('./storageLabGame').StorageLabSettings>> | null;
    if (!s) return;
    setVolume(nextVolume);
    setStatus(`settings saving…`);
    try {
      await s.save('player', { volume: nextVolume, muted: nextVolume === 0, language: 'en' });
      await s.flush();
      setStatus(`settings saved (volume ${nextVolume.toFixed(2)})`);
    } catch (e) {
      setStatus(`settings failed: ${(e as Error).message}`);
    }
  };

  const triggerManualSave = async (): Promise<void> => {
    const store = storesRef.current?.save as unknown as ReturnType<typeof createGameSaveStore<import('./storageLabGame').StorageLabSave>> | null;
    if (!store || !session) return;
    const snap = session.getRenderFrame().current as unknown as StorageLabSnapshot;
    const projected = projectStorageLabSave(snap);
    setStatus('manual save…');
    await store.save('profile-1', projected);
    await store.flush();
    setStatus(`manual save complete (checkpoint ${projected.checkpointIndex})`);
  };

  const resetSave = async (): Promise<void> => {
    const store = storesRef.current?.save as unknown as ReturnType<typeof createGameSaveStore<import('./storageLabGame').StorageLabSave>> | null;
    if (!store) return;
    await store.remove('profile-1');
    await store.flush();
    setStatus('save reset — reload to resume from default');
  };

  const handleMoveRight = (): void => {
    if (!session) return;
    session.input.press('right');
    if (moveTimeoutRef.current !== null) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = setTimeout(() => {
      session.input.release('right');
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
      <Text style={styles.title}>Storage Lab</Text>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12', padding: 16, gap: 8, justifyContent: 'center' },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  line: { color: '#cbd5e1', fontSize: 13 },
  hint: { color: '#64748b', fontSize: 11 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  button: { backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  danger: { backgroundColor: 'rgba(248,113,113,0.2)' },
  buttonText: { color: 'white', fontSize: 12, fontWeight: '600' },
});
