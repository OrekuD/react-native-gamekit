import { useCallback, useEffect, useMemo } from 'react';
import {
  Circle,
  Group,
  LinearGradient,
  Path,
  Rect,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useAnimatedReaction, useDerivedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  GameLayer2D,
  GameSprite,
  GameWorld2D,
  ParticleView,
  Sprite,
  useGameLifecycleSource,
  useParticlePresentation,
  type GameRendererProps,
} from 'rn-gamekit/react';

import { mossyCavern3Assets } from './mossyCavern3Assets.ts';
import type {
  MossyCavern3Definition,
  MossyCavern3Snapshot,
} from './mossyCavern3Game.ts';
import {
  MOSSY_CAVERN_3_LEVEL,
  MOSSY_CAVERN_3_VISUAL_PLATFORMS,
  MOSSY_CAVERN_3_WORLD_HEIGHT,
  MOSSY_CAVERN_3_WORLD_WIDTH,
} from './mossyCavern3Level.ts';
import {
  createMossyCavern3ParticleSystem,
  selectMossyCavern3ParticleEmission,
  shouldEmitMossyCavern3Particle,
} from './mossyCavern3Particles.ts';

type RendererProps = GameRendererProps<
  MossyCavern3Definition['scenes'],
  typeof mossyCavern3Assets
>;

const thornPath = (() => {
  const path = Skia.Path.Make();
  path.moveTo(0, 30);
  path.lineTo(16, 0);
  path.lineTo(32, 30);
  path.close();
  return path;
})();

function Crystal({
  id,
  x,
  y,
  frame,
}: {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly frame: RendererProps['frame'];
}) {
  const opacity = useDerivedValue(() => {
    'worklet';
    const envelope = frame.value;
    if (envelope.scene !== 'play') return 0;
    return envelope.current.collectedCrystalIds.includes(id) ? 0 : 1;
  });
  return (
    <Group opacity={opacity}>
      <Circle cx={x} cy={y} r={28} color="rgba(101, 245, 213, 0.14)" />
      <RoundedRect x={x - 11} y={y - 23} width={22} height={46} r={7} color="#68f0d0" />
      <RoundedRect x={x - 5} y={y - 18} width={7} height={25} r={3} color="#dcfff7" />
    </Group>
  );
}

function Checkpoint({
  id,
  x,
  frame,
}: {
  readonly id: string;
  readonly x: number;
  readonly frame: RendererProps['frame'];
}) {
  const glow = useDerivedValue(() => {
    'worklet';
    const envelope = frame.value;
    if (envelope.scene !== 'play') return 0.25;
    return envelope.current.activeCheckpointId === id ? 0.95 : 0.28;
  });
  return (
    <Group>
      <Circle cx={x + 48} cy={625} r={46} color="#63e6be" opacity={glow} />
      <RoundedRect x={x + 40} y={592} width={16} height={112} r={8} color="#53685c" />
      <Circle cx={x + 48} cy={609} r={17} color="#bfffe8" />
      <Circle cx={x + 48} cy={609} r={7} color="#ffffff" />
    </Group>
  );
}

function PlayerSprites({
  frame,
  alpha,
  assets,
}: Pick<RendererProps, 'frame' | 'alpha'> & {
  readonly assets: NonNullable<RendererProps['assets']>;
}) {
  const common = {
    alpha,
    anchor: { x: 0.5, y: 0.5 },
    commit: frame,
    scene: 'play' as const,
  };
  const select = (
    pose: 'idle-a' | 'idle-b' | 'walk-a' | 'walk-b' | 'jump' | 'dash',
  ) =>
    ({ previous, current, alpha: t }: {
      readonly previous: MossyCavern3Snapshot;
      readonly current: MossyCavern3Snapshot;
      readonly alpha: number;
    }) => {
      'worklet';
      const moving = Math.abs(current.player.velocityX) > 28;
      const idleFrame = current.elapsedTicks % 48 < 24;
      const walkFrame = current.elapsedTicks % 16 < 8;
      const hardCut = previous.cameraCutId !== current.cameraCutId;
      const visible =
        pose === 'dash'
          ? current.player.dashing
          : pose === 'jump'
            ? !current.player.grounded && !current.player.dashing
            : pose === 'idle-a'
              ? current.player.grounded && !moving && idleFrame
              : pose === 'idle-b'
                ? current.player.grounded && !moving && !idleFrame
                : pose === 'walk-a'
                  ? current.player.grounded && moving && walkFrame
                  : current.player.grounded && moving && !walkFrame;
      return {
        flipX: current.player.facing < 0,
        opacity: current.phase === 'respawning' ? 0.25 : 1,
        scale: pose === 'dash' ? 0.34 : 0.27,
        visible,
        x: hardCut
          ? current.player.x + current.player.width / 2
          : previous.player.x + previous.player.width / 2 +
            (current.player.x - previous.player.x) * t,
        y: hardCut
          ? current.player.y + current.player.height / 2
          : previous.player.y + previous.player.height / 2 +
            (current.player.y - previous.player.y) * t,
      };
    };
  return (
    <>
      <GameSprite<MossyCavern3Definition['scenes'], 'play'> {...common} source={assets.get(mossyCavern3Assets.world.wizardIdleA)} select={select('idle-a')} />
      <GameSprite<MossyCavern3Definition['scenes'], 'play'> {...common} source={assets.get(mossyCavern3Assets.world.wizardIdleB)} select={select('idle-b')} />
      <GameSprite<MossyCavern3Definition['scenes'], 'play'> {...common} source={assets.get(mossyCavern3Assets.world.wizardWalkA)} select={select('walk-a')} />
      <GameSprite<MossyCavern3Definition['scenes'], 'play'> {...common} source={assets.get(mossyCavern3Assets.world.wizardWalkB)} select={select('walk-b')} />
      <GameSprite<MossyCavern3Definition['scenes'], 'play'> {...common} source={assets.get(mossyCavern3Assets.world.wizardJump)} select={select('jump')} />
      <GameSprite<MossyCavern3Definition['scenes'], 'play'> {...common} source={assets.get(mossyCavern3Assets.world.wizardDash)} select={select('dash')} />
    </>
  );
}

export function MossyCavern3Renderer({
  frame,
  alpha,
  viewport,
  camera,
  assets,
}: RendererProps) {
  const system = useMemo(() => createMossyCavern3ParticleSystem(), []);
  // T20.3: the renderer-local system follows its owning session through the
  // GameView-provided lifecycle source — no content-side workaround.
  const lifecycle = useGameLifecycleSource();
  const presentation = useParticlePresentation(system, {
    ...(lifecycle !== undefined ? { lifecycle } : {}),
  });
  useEffect(() => () => system.dispose(), [system]);
  const emitSnapshotEffect = useCallback(
    (kind: MossyCavern3Snapshot['effectKind'], x: number, y: number, sequence: number) => {
      if (system.status !== 'running') return;
      const effect =
        kind === 'hurt'
          ? 'hurt'
          : kind === 'win'
            ? 'victory'
            : kind === 'crystal' || kind === 'checkpoint'
              ? 'magic'
              : kind === 'jump' || kind === 'land' || kind === 'dash'
                ? 'dust'
                : undefined;
      if (effect !== undefined) {
        system.emit(effect, { position: { x, y }, seed: sequence * 7919 + 17 });
      }
    },
    [system],
  );
  useAnimatedReaction(
    () => {
      const envelope = frame.value;
      if (envelope.scene !== 'play') return undefined;
      return selectMossyCavern3ParticleEmission(envelope.current);
    },
    (current, previous) => {
      'worklet';
      if (current !== undefined && shouldEmitMossyCavern3Particle(current, previous)) {
        scheduleOnRN(emitSnapshotEffect, current.kind, current.x, current.y, current.sequence);
      }
    },
    [emitSnapshotEffect, frame],
  );

  if (assets === undefined) return null;
  const platformArt = assets.get(mossyCavern3Assets.world.platforms);

  return (
    <>
      <GameWorld2D viewport={viewport}>
        <Rect x={0} y={0} width={1280} height={720}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, 720)}
            colors={['#071a20', '#0b2a29', '#13261e']}
          />
        </Rect>
        <Circle cx={1040} cy={118} r={92} color="rgba(149, 255, 218, 0.07)" />
        <Circle cx={1040} cy={118} r={48} color="rgba(196, 255, 233, 0.08)" />
      </GameWorld2D>

      <GameWorld2D viewport={viewport} camera={camera}>
        <GameLayer2D parallax={{ x: 0.12, y: 0.2 }}>
          {Array.from({ length: 12 }, (_, index) => (
            <Circle
              key={`far-${index}`}
              cx={240 + index * 520}
              cy={170 + (index % 3) * 74}
              r={170 + (index % 2) * 55}
              color="rgba(37, 95, 77, 0.13)"
            />
          ))}
        </GameLayer2D>
        <GameLayer2D parallax={{ x: 0.36, y: 0.45 }}>
          {Array.from({ length: 18 }, (_, index) => (
            <RoundedRect
              key={`root-${index}`}
              x={index * 340 - 40}
              y={90 + (index % 4) * 58}
              width={86}
              height={420}
              r={43}
              color="rgba(28, 82, 58, 0.18)"
            />
          ))}
        </GameLayer2D>

        <Sprite source={platformArt} frame="ledge" x={330} y={365} scale={0.42} opacity={0.82} />
        <Sprite source={platformArt} frame="ridge" x={2180} y={360} scale={0.42} opacity={0.72} />
        <Sprite source={platformArt} frame="ledge" x={3450} y={365} scale={0.48} opacity={0.76} />
        <Sprite source={platformArt} frame="island" x={5070} y={230} scale={0.48} opacity={0.78} />

        {MOSSY_CAVERN_3_VISUAL_PLATFORMS.map((platform, index) => (
          <Group key={`platform-${index}`}>
            <RoundedRect
              x={platform.x}
              y={platform.y}
              width={platform.width}
              height={platform.height}
              r={platform.oneWay ? 10 : 18}
              color={platform.oneWay ? '#48644c' : '#253c32'}
            />
            <Rect
              x={platform.x}
              y={platform.y}
              width={platform.width}
              height={platform.oneWay ? 9 : 16}
              color={platform.oneWay ? '#9ccb76' : '#78ab68'}
            />
            {!platform.oneWay ? (
              <Rect
                x={platform.x + 10}
                y={platform.y + 23}
                width={Math.max(0, platform.width - 20)}
                height={3}
                color="rgba(143, 186, 121, 0.18)"
              />
            ) : null}
          </Group>
        ))}

        {MOSSY_CAVERN_3_LEVEL.crystals.map((crystal) => (
          <Crystal
            key={crystal.id}
            id={crystal.id}
            frame={frame}
            x={crystal.bounds.x + crystal.bounds.width / 2}
            y={crystal.bounds.y + crystal.bounds.height / 2}
          />
        ))}
        {MOSSY_CAVERN_3_LEVEL.checkpoints.map((checkpoint) => (
          <Checkpoint key={checkpoint.id} id={checkpoint.id} x={checkpoint.bounds.x} frame={frame} />
        ))}

        {Array.from({ length: 4 }, (_, index) => (
          <Path
            key={`thorn-a-${index}`}
            path={thornPath}
            color="#c65d70"
            transform={[{ translateX: 1088 + index * 32 }, { translateY: 674 }]}
          />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <Path
            key={`thorn-b-${index}`}
            path={thornPath}
            color="#a94f67"
            transform={[{ translateX: 2752 + index * 32 }, { translateY: 674 }]}
          />
        ))}
        <Sprite
          source={assets.get(mossyCavern3Assets.world.slimeGreenA)}
          x={1152}
          y={655}
          scale={0.25}
          anchor={{ x: 0.5, y: 0.5 }}
          opacity={0.78}
        />
        <Sprite
          source={assets.get(mossyCavern3Assets.world.slimeOrange)}
          x={2848}
          y={650}
          scale={0.21}
          anchor={{ x: 0.5, y: 0.5 }}
          opacity={0.8}
        />
        <Sprite
          source={assets.get(mossyCavern3Assets.world.poisonPlant)}
          x={4461}
          y={654}
          scale={0.32}
          anchor={{ x: 0.5, y: 0.5 }}
        />

        <Group>
          <RoundedRect x={5312} y={544} width={112} height={160} r={55} color="#2d5044" />
          <RoundedRect x={5332} y={568} width={72} height={136} r={35} color="#071a20" />
          <Circle cx={5368} cy={606} r={24} color="rgba(105, 242, 207, 0.32)" />
          <Circle cx={5368} cy={606} r={9} color="#c8fff1" />
        </Group>

        <PlayerSprites frame={frame} alpha={alpha} assets={assets} />
        <ParticleView
          effect="dust"
          height={MOSSY_CAVERN_3_WORLD_HEIGHT}
          presentation={presentation}
          system={system}
          width={MOSSY_CAVERN_3_WORLD_WIDTH}
        />
        <ParticleView
          effect="magic"
          height={MOSSY_CAVERN_3_WORLD_HEIGHT}
          presentation={presentation}
          system={system}
          width={MOSSY_CAVERN_3_WORLD_WIDTH}
        />
        <ParticleView
          effect="hurt"
          height={MOSSY_CAVERN_3_WORLD_HEIGHT}
          presentation={presentation}
          system={system}
          width={MOSSY_CAVERN_3_WORLD_WIDTH}
        />
        <ParticleView
          effect="victory"
          height={MOSSY_CAVERN_3_WORLD_HEIGHT}
          presentation={presentation}
          system={system}
          width={MOSSY_CAVERN_3_WORLD_WIDTH}
        />
      </GameWorld2D>

      <GameWorld2D viewport={viewport}>
        <Group opacity={0.48}>
          <Sprite source={assets.get(mossyCavern3Assets.world.keyboardPrompts)} frame="wasd" x={954} y={28} scale={1.05} />
          <Sprite source={assets.get(mossyCavern3Assets.world.keyboardPrompts)} frame="space" x={1034} y={40} scale={0.72} />
          <Sprite source={assets.get(mossyCavern3Assets.world.xboxPrompts)} frame="dpad" x={1140} y={27} scale={1.12} />
          <Sprite source={assets.get(mossyCavern3Assets.world.xboxPrompts)} frame="actionA" x={1200} y={31} scale={1.3} />
        </Group>
      </GameWorld2D>
    </>
  );
}

export default MossyCavern3Renderer;
