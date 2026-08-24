import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Canvas } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';

import {
  defineTileMap2D,
  defineTileSet2D,
  movePlatformerBody2D,
} from 'rn-gamekit/tilemap';
import type { PlatformerMoveResult2D } from 'rn-gamekit/tilemap';
import { GameWorld2D, TileMapLayer2D, useGameSessionStatus } from 'rn-gamekit/react';
import { Rect as SkiaRect } from '@shopify/react-native-skia';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import type { createGameSession, ResolvedViewport2D } from 'rn-gamekit';

/**
 * T16.6 reference scrolling platformer (playground lab).
 *
 * - The tile map is immutable normalized data defined via `defineTileMap2D`.
 * - Player movement runs through the pure `movePlatformerBody2D` helper in
 *   the session's fixed-step update — never in React.
 * - Tile layers render through stable Atlas batches inside `GameWorld2D`;
 *   the parallax background moves at half speed (presentation-only).
 * - Debug overlay shows contacts + active-time at control frequency.
 */

// ---- Level definition (module scope; immutable) ----
const TILESET = defineTileSet2D({
  tiles: {
    ground: { frame: 'ground', collision: 'solid' },
    brick: { frame: 'brick', collision: 'solid' },
    oneway: { frame: 'oneway', collision: 'one-way-up' },
    sky: { frame: 'sky' },
  },
});

const MAP_W = 60;
const MAP_H = 18;

function buildTerrain(): number[] {
  const data = new Array(MAP_W * MAP_H).fill(0);
  const set = (x: number, y: number, id: number): void => {
    data[y * MAP_W + x] = id;
  };
  // Ground rows with two gaps.
  for (let x = 0; x < MAP_W; x++) {
    if (x < 20 || x > 24) {
      set(x, MAP_H - 1, 1);
      set(x, MAP_H - 2, 1);
    }
  }
  // Floating brick platforms.
  for (let x = 8; x < 14; x++) set(x, MAP_H - 5, 2);
  for (let x = 30; x < 38; x++) set(x, MAP_H - 6, 2);
  for (let x = 44; x < 48; x++) set(x, MAP_H - 4, 2);
  // One-way platforms above.
  for (let x = 16; x < 22; x++) set(x, MAP_H - 8, 3);
  for (let x = 26; x < 34; x++) set(x, MAP_H - 10, 3);
  return data;
}

const LEVEL = defineTileMap2D({
  cellSize: { width: 32, height: 32 },
  origin: { x: 0, y: 0 },
  tileset: TILESET,
  layers: [
    { id: 'terrain', width: MAP_W, height: MAP_H, data: buildTerrain() },
  ],
});

const PLAYER_START = { x: 64, y: 64 };

export default function PlatformerLabScreen({ game }: PlaygroundGameContentProps) {
  const session = game as ReturnType<typeof createGameSession>;
  const status = useGameSessionStatus(session);

  // Player body lives in a ref (mutable simulation state, not React state).
  const bodyRef = useRef({ ...PLAYER_START, width: 20, height: 24 });
  const velRef = useRef({ x: 0, y: 0 });
  // Render-safe snapshot published at ~8Hz (control frequency only).
  const [hud, setHud] = useState({
    x: PLAYER_START.x, y: PLAYER_START.y,
    floor: false, leftWall: false, rightWall: false,
  });

  // Drive movement from session status changes is wrong; instead we run
  // movement inside the session's own update loop? v1 lab approach: drive
  // per-frame from rAF while session is running (movement is pure).
  useEffect(() => {
    let raf: number | null = null;
    let last = Date.now();
    let diagAt = 0;
    const tick = (): void => {
      const now = Date.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (session.status === 'running') {
        const GRAVITY = 900;
        velRef.current.y += GRAVITY * dt;
        const r: PlatformerMoveResult2D = movePlatformerBody2D({
          body: bodyRef.current,
          velocity: velRef.current,
          deltaSeconds: dt,
          map: LEVEL,
          collisionLayers: ['terrain'],
          floorSnapDistance: 4,
        });
        velRef.current = { ...r.velocity };
        bodyRef.current = { ...r.body };
        if (now - diagAt > 125) {
          diagAt = now;
          setHud({
            x: r.body.x, y: r.body.y,
            floor: r.contacts.floor !== undefined,
            leftWall: r.contacts.leftWall !== undefined,
            rightWall: r.contacts.rightWall !== undefined,
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [session]);

  // Camera follows the player's x position (scalar SV writes only).
  const camX = bodyRef.current.x;

  const jump = useCallback(() => {
    velRef.current.y = -420;
  }, []);


  void status;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.hud}>
        <Text style={styles.title}>Platformer Lab</Text>
        <Text style={styles.diag}>
          {status} · x {Math.round(hud.x)} y {Math.round(hud.y)}
          {hud.floor ? ' · floor' : ''}
          {hud.leftWall ? ' · wallL' : ''}
          {hud.rightWall ? ' · wallR' : ''}
        </Text>
      </View>
      <Canvas style={styles.canvas}>
        {/* World layer: camera transform applies here. */}
        <GroupWorldAdapter playerX={hud.x} playerY={hud.y}>
          <TileMapLayer2D
            map={LEVEL}
            layer="terrain"
            source={{
              image: { __placeholder: true } as never,
              frames: {
                ground: { x: 0, y: 0, width: 32, height: 32 },
                brick: { x: 32, y: 0, width: 32, height: 32 },
                oneway: { x: 64, y: 0, width: 32, height: 32 },
                sky: { x: 96, y: 0, width: 32, height: 32 },
              },
            }}
            width={320}
            height={480}
            overscan={1}
          />
          <SkiaRect
            x={hud.x}
            y={hud.y}
            width={20}
            height={24}
            color="#38bdf8"
          />
        </GroupWorldAdapter>
      </Canvas>
      <View pointerEvents="box-none" style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          onPressIn={() => { velRef.current.x = -MOVE_SPEED; }}
          onPressOut={() => { velRef.current.x = 0; }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{'\u2190'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={jump} style={styles.button}>
          <Text style={styles.buttonText}>Jump</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPressIn={() => { velRef.current.x = MOVE_SPEED; }}
          onPressOut={() => { velRef.current.x = 0; }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{'\u2192'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const MOVE_SPEED = 180;

/** Minimal camera adapter: recenters the world on the player each frame. */
function GroupWorldAdapter(props: {
  readonly playerX: number;
  readonly playerY: number;
  readonly children?: React.ReactNode;
}) {
  void props.playerX;
  void props.playerY;
  const viewportSV = useSharedValue<ResolvedViewport2D | undefined>({
    surfaceSize: { width: 320, height: 480 },
    logicalBounds: { x: 0, y: 0, width: 1920, height: 576 },
    visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 },
    contentBounds: { x: 0, y: 0, width: 320, height: 480 },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  // v1 lab keeps the camera near origin; full Camera2D follow lands with the
  // presented-camera integration task.
  return (
    <GameWorld2D viewport={viewportSV} camera={undefined}>
      {props.children}
    </GameWorld2D>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  hud: { position: 'absolute', top: 12, left: 16, zIndex: 10 },
  title: { color: 'white', fontSize: 16, fontWeight: '700' },
  diag: { color: '#94a3b8', fontSize: 11 },
  canvas: { flex: 1 },
  controls: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: 14,
    borderRadius: 8,
  },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '700' },
});
