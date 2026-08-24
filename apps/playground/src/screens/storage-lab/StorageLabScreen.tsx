import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createGameSaveStore, createMemoryStorageAdapter } from 'rn-gamekit/storage';

import {
  createStorageLabSession,
  projectStorageLabSave,
  storageLabSaveSchema,
  storageLabSettingsSchema,
  type StorageLabSnapshot,
} from './storageLabGame';

type LoadState = 'loading' | 'ready' | 'error';

export default function StorageLabScreen() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReturnType<typeof createStorageLabSession> | null>(null);
  const [hud, setHud] = useState<{ x: number; checkpoint: number; ticks: number } | null>(null);
  const [status, setStatus] = useState('loading saves…');
  const [volume, setVolume] = useState(1);

  // Stores are created once per screen lifetime; disposal is explicit.
  const storesRef = useRef<ReturnType<typeof createGameSaveStore> | null>(null);
  const settingsStoreRef = useRef<ReturnType<typeof createGameSaveStore> | null>(null);
  const adapterRef = useRef(createMemoryStorageAdapter());

  // Load before session creation (T17.4)
  useEffect(() => {
    let cancelled = false;
    const adapter = adapterRef.current;
    const settingsStore = createGameSaveStore({ schema: storageLabSettingsSchema, adapter, namespace: 'storage-lab-settings' });
    const saveStore = createGameSaveStore({ schema: storageLabSaveSchema, adapter, namespace: 'storage-lab-save' });
    settingsStoreRef.current = settingsStore as unknown as ReturnType<typeof createGameSaveStore>;
    storesRef.current = saveStore as unknown as ReturnType<typeof createGameSaveStore>;

    (async () => {
      try {
        const [settingsRes, saveRes] = await Promise.all([settingsStore.load('player'), saveStore.load('profile-1')]);
        if (cancelled) return;
        setVolume(settingsRes.data.volume);
        const initialSave = saveRes.data;
        // Create session only after validated load/default/migration
        const nextSession = createStorageLabSession(initialSave);
        if (cancelled) {
          nextSession.dispose();
          return;
        }
        // Bind checkpoint event to async save effect — outside simulation
        const sub = nextSession.addGameEventListener('checkpoint', async (event) => {
          const snap = nextSession.getRenderFrame().current as unknown as StorageLabSnapshot;
          const projected = projectStorageLabSave(snap);
          setStatus(`checkpoint ${event.payload.index} → saving…`);
          try {
            await saveStore.save('profile-1', projected);
            await saveStore.flush();
            if (!cancelled) setStatus(`checkpoint ${event.payload.index} saved`);
          } catch (e) {
            if (!cancelled) setStatus(`checkpoint save failed: ${(e as Error).message}`);
          }
        });
        // Store sub for cleanup
        (nextSession as unknown as { __storageSub?: { remove(): void } }).__storageSub = sub;
        setSession(nextSession);
        setLoadState('ready');
        setStatus(`loaded ${saveRes.status} (checkpoint ${initialSave.checkpointIndex})`);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoadState('error');
        setStatus(`load failed: ${(e as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      const active = storesRef.current;
      const settings = settingsStoreRef.current;
      // Prove old store cannot write after replacement: dispose rejects new work, pending flush still completes
      active?.dispose();
      settings?.dispose();
      setSession((prev) => {
        if (prev) {
          (prev as unknown as { __storageSub?: { remove(): void } }).__storageSub?.remove();
          prev.dispose();
        }
        return null;
      });
    };
  }, []);

  // Tick the session manually — fixed-step driver is internal; we drive via requestAnimationFrame for lab demo
  useEffect(() => {
    if (!session || loadState !== 'ready') return;
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const deltaMs = Math.min(32, now - last);
      last = now;
      // The session advances via its internal frame driver (RAF) when started; we just poll HUD
      const snap = session.getRenderFrame().current as unknown as StorageLabSnapshot | undefined;
      if (snap) setHud({ x: Math.round(snap.x), checkpoint: snap.checkpointIndex, ticks: snap.ticks });
      raf = requestAnimationFrame(loop);
    };
    session.start();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      session.pause();
    };
  }, [session, loadState]);

  const mutateSettings = async (nextVolume: number): Promise<void> => {
    const s = settingsStoreRef.current as unknown as ReturnType<typeof createGameSaveStore<import('./storageLabGame').StorageLabSettings>> | null;
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
    const store = storesRef.current as unknown as ReturnType<typeof createGameSaveStore<import('./storageLabGame').StorageLabSave>> | null;
    if (!store || !session) return;
    const snap = session.getRenderFrame().current as unknown as StorageLabSnapshot;
    const projected = projectStorageLabSave(snap);
    setStatus('manual save…');
    await store.save('profile-1', projected);
    await store.flush();
    setStatus(`manual save complete (checkpoint ${projected.checkpointIndex})`);
  };

  const resetSave = async (): Promise<void> => {
    const store = storesRef.current as unknown as ReturnType<typeof createGameSaveStore<import('./storageLabGame').StorageLabSave>> | null;
    if (!store) return;
    await store.remove('profile-1');
    await store.flush();
    setStatus('save reset — reload to resume from default');
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
        <Pressable
          onPress={() => {
            session?.input.press('right');
            setTimeout(() => session?.input.release('right'), 200);
          }}
          style={styles.button}
        >
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
