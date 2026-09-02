/**
 * Mossy Cavern renderer.
 *
 * The tree is stable for the lifetime of a session. GameKit's retained sprite,
 * tile, batch, camera, and particle primitives read shared values on the UI
 * runtime; React never stores a per-frame position or animation frame.
 */
import { Circle, Group, Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import {
  GameLayer2D,
  GameSprite,
  GameWorld2D,
  ParticleView,
  Sprite,
  SpriteBatch,
  TileMapLayer2D,
  useGameLifecycleSource,
  useParticlePresentation,
  type GameLifecycleSource,
  type GameRendererProps,
} from 'rn-gamekit/react';

import {
  MOSSY_CAVERN_CONFIG,
  MOSSY_CAVERN_VIEW,
  MOSSY_CAVERN_WORLD,
  mossyCavernAssets,
  mossyCavernDefinition,
  mossyCavernLevel,
  type MossyCavernSnapshot,
  type MossyEnemySnapshot,
  type MossyPlantSnapshot,
} from './mossyCavernGame';
import { type MossyCavernParticleSystem } from './mossyCavernEffects';

type RendererProps = GameRendererProps<
  typeof mossyCavernDefinition['scenes'],
  typeof mossyCavernAssets
>;
type FrameSharedValue = RendererProps['frame'];

const C = MOSSY_CAVERN_CONFIG.cellSize;

const TILE_FRAMES = {
  ground: { x: 0, y: 0, width: C, height: C },
  decor: { x: C, y: 0, width: C, height: C },
  wall: { x: C * 2, y: 0, width: C, height: C },
  platform: { x: C * 3, y: 0, width: C, height: C },
} as const;

const OFFSCREEN_SNAPSHOT: MossyCavernSnapshot = {
  body: { x: -1000, y: -1000, width: 38, height: 58 },
  onGround: false,
  facingRight: true,
  pose: 'idle',
  playerFrame: 'idle-00',
  enemies: [],
  plants: [],
  collectibles: [],
  checkpoints: [],
  checkpointIndex: -1,
  health: 0,
  crystals: 0,
  score: 0,
  falls: 0,
  elapsed: 0,
  bestTimeSeconds: 0,
  finished: false,
  gameOver: false,
  spawnCut: false,
  ticks: 0,
  camera: { center: { x: 0, y: 0 }, zoom: 1, rotationRadians: 0 },
};

function snapshotOf(frame: FrameSharedValue): MossyCavernSnapshot {
  'worklet';
  const envelope = frame.value;
  return envelope.scene === 'cavern'
    ? envelope.current as unknown as MossyCavernSnapshot
    : OFFSCREEN_SNAPSHOT;
}

function loadedImage(value: unknown): { readonly image: unknown } | undefined {
  return value as { readonly image: unknown } | undefined;
}

function PlayerSprite({
  frame,
  alpha,
  source,
  pose,
  fallbackFrame,
}: {
  readonly frame: FrameSharedValue;
  readonly alpha: RendererProps['alpha'];
  readonly source: unknown;
  readonly pose: MossyCavernSnapshot['pose'];
  readonly fallbackFrame: string;
}) {
  return (
    <GameSprite<typeof mossyCavernDefinition['scenes'], 'cavern'>
      scene="cavern"
      commit={frame}
      alpha={alpha}
      source={source as never}
      anchor={{ x: 0.5, y: 1 }}
      select={({ previous, current, alpha: t }) => {
        'worklet';
        const active = current.pose === pose;
        const previousBody = previous.body;
        const currentBody = current.body;
        return {
          x: (previousBody.x + (currentBody.x - previousBody.x) * t) + currentBody.width / 2,
          y: (previousBody.y + (currentBody.y - previousBody.y) * t) + currentBody.height,
          frame: active ? current.playerFrame : fallbackFrame,
          flipX: !current.facingRight,
          scale: 0.82,
          opacity: active ? 1 : 0,
        };
      }}
    />
  );
}

function EnemyBatch({
  frame,
  alpha,
  source,
  kind,
  fallbackFrame,
  camera,
  viewport,
}: {
  readonly frame: FrameSharedValue;
  readonly alpha: RendererProps['alpha'];
  readonly source: unknown;
  readonly kind: MossyEnemySnapshot['kind'];
  readonly fallbackFrame: string;
  readonly camera: NonNullable<RendererProps['camera']> | undefined;
  readonly viewport: RendererProps['viewport'];
}) {
  return (
    <SpriteBatch<
      typeof mossyCavernDefinition['scenes'],
      'cavern',
      MossyEnemySnapshot
    >
      scene="cavern"
      commit={frame}
      alpha={alpha}
      source={source as never}
      capacity={8}
      select={({ current }) => (current as unknown as MossyCavernSnapshot).enemies}
      write={(write, enemy, index) => {
        'worklet';
        const visible = enemy.kind === kind && !enemy.defeated;
        write.set(
          index,
          visible ? enemy.frame : fallbackFrame,
          enemy.x + enemy.width / 2,
          enemy.y + enemy.height,
          0,
          enemy.scale,
          visible,
        );
      }}
      anchor={{ x: 0.5, y: 1 }}
      cull={
        camera === undefined
          ? undefined
          : {
              camera,
              viewport,
              padding: 64,
              bounds: (enemy) => {
                'worklet';
                return {
                  x: enemy.x,
                  y: enemy.y,
                  width: enemy.width,
                  height: enemy.height,
                };
              },
            }
      }
    />
  );
}

function PlantBatch({
  frame,
  alpha,
  source,
  kind,
  fallbackFrame,
  camera,
  viewport,
}: {
  readonly frame: FrameSharedValue;
  readonly alpha: RendererProps['alpha'];
  readonly source: unknown;
  readonly kind: MossyPlantSnapshot['kind'];
  readonly fallbackFrame: string;
  readonly camera: NonNullable<RendererProps['camera']> | undefined;
  readonly viewport: RendererProps['viewport'];
}) {
  return (
    <SpriteBatch<
      typeof mossyCavernDefinition['scenes'],
      'cavern',
      MossyPlantSnapshot
    >
      scene="cavern"
      commit={frame}
      alpha={alpha}
      source={source as never}
      capacity={8}
      select={({ current }) => (current as unknown as MossyCavernSnapshot).plants}
      write={(write, plant, index) => {
        'worklet';
        const visible = plant.kind === kind;
        write.set(
          index,
          visible ? plant.frame : fallbackFrame,
          plant.x,
          plant.y,
          0,
          plant.scale,
          visible,
        );
      }}
      anchor={{ x: 0.5, y: 1 }}
      cull={
        camera === undefined
          ? undefined
          : {
              camera,
              viewport,
              padding: 64,
              bounds: (plant) => {
                'worklet';
                return {
                  x: plant.x - 32,
                  y: plant.y - 64,
                  width: 64,
                  height: 64,
                };
              },
            }
      }
    />
  );
}

function CrystalMarker({ index, frame }: { readonly index: number; readonly frame: FrameSharedValue }) {
  const x = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).collectibles[index]?.x ?? -1000;
  });
  const y = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).collectibles[index]?.y ?? -1000;
  });
  const opacity = useDerivedValue(() => {
    'worklet';
    const collectible = snapshotOf(frame).collectibles[index];
    return collectible?.collected ? 0 : 1;
  });
  const coreY = useDerivedValue(() => {
    'worklet';
    return y.value - 5;
  });
  return (
    <Group opacity={opacity}>
      <Circle cx={x} cy={y} r={13} color="#65dff4" opacity={0.16} />
      <Circle cx={x} cy={coreY} r={5} color="#b4f6ff" />
    </Group>
  );
}

function CheckpointMarker({ index, frame }: { readonly index: number; readonly frame: FrameSharedValue }) {
  const opacity = useDerivedValue(() => {
    'worklet';
    const checkpoint = snapshotOf(frame).checkpoints[index];
    return checkpoint?.reached ? 1 : 0.35;
  });
  const x = MOSSY_CAVERN_CONFIG.checkpoints[index]! * C;
  return (
    <Group opacity={opacity}>
      <Rect x={x - 3} y={GROUND_TOP - 82} width={6} height={82} color="#b8e46e" />
      <Rect x={x + 3} y={GROUND_TOP - 78} width={32} height={20} color="#d6f58c" opacity={0.78} />
      <Circle cx={x} cy={GROUND_TOP - 90} r={8} color="#f5d66b" opacity={0.72} />
    </Group>
  );
}

const GROUND_TOP = (MOSSY_CAVERN_CONFIG.mapRows - 2) * C;

function MossyCrystals({ frame }: { readonly frame: FrameSharedValue }) {
  return (
    <>
      {Array.from({ length: 10 }, (_, index) => (
        <CrystalMarker key={`crystal-${String(index)}`} index={index} frame={frame} />
      ))}
    </>
  );
}

function MossyCheckpoints({ frame }: { readonly frame: FrameSharedValue }) {
  return (
    <>
      {MOSSY_CAVERN_CONFIG.checkpoints.map((_, index) => (
        <CheckpointMarker key={`checkpoint-${String(index)}`} index={index} frame={frame} />
      ))}
    </>
  );
}

function BackgroundHills({ source }: { readonly source: unknown }) {
  return (
    <GameLayer2D parallax={{ x: 0.22, y: 0.3 }}>
      {Array.from({ length: 12 }, (_, index) => (
        <Sprite
          key={`hill-${String(index)}`}
          source={source as never}
          x={index * 520 + 256}
          y={MOSSY_CAVERN_WORLD.height - 18}
          anchor={{ x: 0.5, y: 1 }}
          scale={1.35}
          opacity={0.3}
        />
      ))}
    </GameLayer2D>
  );
}

export type MossyCavernRendererProps = RendererProps & {
  /** Session-scoped pool supplied by the shell's presentation binding (T20.3). */
  readonly particleSystem?: MossyCavernParticleSystem;
};

export function MossyCavernRenderer({ particleSystem, ...props }: MossyCavernRendererProps) {
  // T20.3: the shell's presentation binding supplies the system; GameView
  // supplies the lifecycle source. Loading slots render without either.
  const lifecycle = useGameLifecycleSource();
  if (particleSystem === undefined || lifecycle === undefined) return null;
  return <MossyCavernWorld {...props} particleSystem={particleSystem} lifecycle={lifecycle} />;
}

function MossyCavernWorld({
  frame,
  alpha,
  viewport,
  camera,
  assets,
  particleSystem,
  lifecycle,
}: Omit<MossyCavernRendererProps, 'particleSystem'> & {
  readonly particleSystem: MossyCavernParticleSystem;
  readonly lifecycle: GameLifecycleSource;
}) {
  const particlePresentation = useParticlePresentation(particleSystem, { lifecycle });

  const tiles = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.tiles);
  const hill = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.hill);
  const playerIdle = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.playerIdle);
  const playerWalk = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.playerWalk);
  const playerJump = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.playerJump);
  const playerDash = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.playerDash);
  const greenSlime = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.slimeGreen);
  const orangeSlime = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.slimeOrange);
  const vine = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.plantVine);
  const poison = assets === undefined ? undefined : assets.get(mossyCavernAssets.world.plantPoison);
  const ready = tiles !== undefined && hill !== undefined && playerIdle !== undefined && playerWalk !== undefined && playerJump !== undefined && playerDash !== undefined && greenSlime !== undefined && orangeSlime !== undefined && vine !== undefined && poison !== undefined;

  return (
    <GameWorld2D viewport={viewport} camera={camera}>
      <Rect x={0} y={0} width={MOSSY_CAVERN_WORLD.width} height={MOSSY_CAVERN_WORLD.height} color="#06130f" />
      <Rect x={0} y={0} width={MOSSY_CAVERN_WORLD.width} height={MOSSY_CAVERN_WORLD.height} color="#123b31" opacity={0.14} />
      {ready ? (
        <>
          <BackgroundHills source={loadedImage(hill)?.image} />
          <TileMapLayer2D
            map={mossyCavernLevel}
            layer="decor"
            source={{ image: tiles.image as never, frames: TILE_FRAMES }}
            width={MOSSY_CAVERN_VIEW.width}
            height={MOSSY_CAVERN_VIEW.height}
            overscan={1}
            parallax={{ x: 0.55, y: 0.55 }}
            minZoom={0.8}
          />
          <TileMapLayer2D
            map={mossyCavernLevel}
            layer="terrain"
            source={{ image: tiles.image as never, frames: TILE_FRAMES }}
            width={MOSSY_CAVERN_VIEW.width}
            height={MOSSY_CAVERN_VIEW.height}
            overscan={1}
            minZoom={0.8}
          />
          <MossyCheckpoints frame={frame} />
          <MossyCrystals frame={frame} />
          <PlantBatch frame={frame} alpha={alpha} source={vine} kind="vine" fallbackFrame="vine-00" camera={camera} viewport={viewport} />
          <PlantBatch frame={frame} alpha={alpha} source={poison} kind="poison" fallbackFrame="poison-00" camera={camera} viewport={viewport} />
          <EnemyBatch frame={frame} alpha={alpha} source={greenSlime} kind="green" fallbackFrame="green-00" camera={camera} viewport={viewport} />
          <EnemyBatch frame={frame} alpha={alpha} source={orangeSlime} kind="orange" fallbackFrame="orange-00" camera={camera} viewport={viewport} />
          <PlayerSprite frame={frame} alpha={alpha} source={playerIdle} pose="idle" fallbackFrame="idle-00" />
          <PlayerSprite frame={frame} alpha={alpha} source={playerWalk} pose="walk" fallbackFrame="walk-00" />
          <PlayerSprite frame={frame} alpha={alpha} source={playerJump} pose="jump" fallbackFrame="jump-00" />
          <PlayerSprite frame={frame} alpha={alpha} source={playerDash} pose="dash" fallbackFrame="dash-00" />
          <ParticleView system={particleSystem} effect="jumpDust" width={MOSSY_CAVERN_VIEW.width} height={MOSSY_CAVERN_VIEW.height} presentation={particlePresentation} />
          <ParticleView system={particleSystem} effect="dashTrail" width={MOSSY_CAVERN_VIEW.width} height={MOSSY_CAVERN_VIEW.height} presentation={particlePresentation} />
          <ParticleView system={particleSystem} effect="crystalBurst" width={MOSSY_CAVERN_VIEW.width} height={MOSSY_CAVERN_VIEW.height} presentation={particlePresentation} />
          <ParticleView system={particleSystem} effect="hitBurst" width={MOSSY_CAVERN_VIEW.width} height={MOSSY_CAVERN_VIEW.height} presentation={particlePresentation} />
          <ParticleView system={particleSystem} effect="checkpointBurst" width={MOSSY_CAVERN_VIEW.width} height={MOSSY_CAVERN_VIEW.height} presentation={particlePresentation} />
          <ParticleView system={particleSystem} effect="finishBurst" width={MOSSY_CAVERN_VIEW.width} height={MOSSY_CAVERN_VIEW.height} presentation={particlePresentation} />
        </>
      ) : null}
    </GameWorld2D>
  );
}

