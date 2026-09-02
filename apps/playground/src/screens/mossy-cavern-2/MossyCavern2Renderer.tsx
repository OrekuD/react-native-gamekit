/** Skia presentation for the independent Mossy Cavern 2 GameKit session. */
import {
  Circle,
  Fill,
  Group,
  Rect,
  RoundedRect,
  type SkImage,
} from '@shopify/react-native-skia';
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
  type GameRendererProps,
  type ParticlePresentation,
} from 'rn-gamekit/react';
import type { LoadedImage } from 'rn-gamekit';

import {
  MOSSY_CAVERN_2_CONFIG,
  MOSSY_CAVERN_2_WORLD_BOUNDS,
  mossyCavern2Assets,
  mossyCavern2Hazards,
  mossyCavern2TileMap,
  type MossyCavern2Definition,
  type MossyCavern2RelicSnapshot,
  type MossyCavern2SlimeSnapshot,
} from './mossyCavern2Game.ts';
import {
  type MossyCavern2ParticleSystem,
} from './mossyCavern2Effects.ts';

type RendererProps = GameRendererProps<
  MossyCavern2Definition['scenes'],
  typeof mossyCavern2Assets
>;

/**
 * T20.3: the session-scoped system arrives through the shell's presentation
 * binding and the lifecycle source through GameView's context. Loading slots
 * render the static entry renderer without a binding and show nothing.
 */

/**
 * The loading slot deliberately has no asset lease or gameplay session. Keep
 * the hook-bearing world in a child so its hook topology is stable once the
 * shell publishes the actual ready session.
 */
export type MossyCavern2RendererProps = RendererProps & {
  /** Session-scoped pool supplied by the shell's presentation binding (T20.3). */
  readonly particleSystem?: MossyCavern2ParticleSystem;
};

export function MossyCavern2Renderer(props: MossyCavern2RendererProps) {
  if (props.assets === undefined || props.particleSystem === undefined) return null;
  return <MossyCavern2World {...props} assets={props.assets} particleSystem={props.particleSystem} />;
}

function MossyCavern2World({
  frame,
  alpha,
  viewport,
  camera,
  assets,
  particleSystem,
}: Omit<MossyCavern2RendererProps, 'particleSystem'> & {
  readonly assets: NonNullable<RendererProps['assets']>;
  readonly particleSystem: MossyCavern2ParticleSystem;
}) {
  const lifecycle = useGameLifecycleSource();
  const presentation = useParticlePresentation(particleSystem, {
    ...(lifecycle !== undefined ? { lifecycle } : {}),
  });
  const tileAtlas = assets.get(mossyCavern2Assets.world.tileAtlas);
  const tileSource = {
    image: tileAtlas.image as SkImage,
    frames: tileAtlas.frames,
  };

  return (
    <>
      <Fill color="#071510" />
      <GameWorld2D viewport={viewport} camera={camera}>
        <GameLayer2D parallax={{ x: 0.12, y: 0.12 }}>
          <Rect
            x={MOSSY_CAVERN_2_WORLD_BOUNDS.x}
            y={MOSSY_CAVERN_2_WORLD_BOUNDS.y}
            width={MOSSY_CAVERN_2_WORLD_BOUNDS.width}
            height={MOSSY_CAVERN_2_WORLD_BOUNDS.height}
            color="#0b2a1d"
          />
          <Sprite
            source={assets.get(mossyCavern2Assets.world.hills)}
            x={500}
            y={900}
            scale={0.68}
            opacity={0.56}
            anchor={{ x: 0.5, y: 1 }}
          />
          <Sprite
            source={assets.get(mossyCavern2Assets.world.hills)}
            x={1_760}
            y={900}
            scale={0.68}
            opacity={0.48}
            anchor={{ x: 0.5, y: 1 }}
          />
          <Sprite
            source={assets.get(mossyCavern2Assets.world.hills)}
            x={3_020}
            y={900}
            scale={0.68}
            opacity={0.52}
            anchor={{ x: 0.5, y: 1 }}
          />
        </GameLayer2D>

        <GameLayer2D parallax={{ x: 0.35, y: 0.35 }}>
          <Sprite
            source={assets.get(mossyCavern2Assets.world.backgroundDecoration)}
            x={430}
            y={530}
            scale={0.28}
            opacity={0.26}
            anchor={{ x: 0.5, y: 0.5 }}
          />
          <Sprite
            source={assets.get(mossyCavern2Assets.world.backgroundDecoration)}
            x={1_740}
            y={500}
            scale={0.28}
            opacity={0.23}
            anchor={{ x: 0.5, y: 0.5 }}
          />
          <Sprite
            source={assets.get(mossyCavern2Assets.world.backgroundDecoration)}
            x={3_060}
            y={520}
            scale={0.28}
            opacity={0.25}
            anchor={{ x: 0.5, y: 0.5 }}
          />
        </GameLayer2D>

        <GameLayer2D parallax={{ x: 0.62, y: 0.62 }}>
          <Sprite
            source={assets.get(mossyCavern2Assets.world.hangingPlants)}
            x={700}
            y={80}
            scale={0.31}
            opacity={0.7}
            anchor={{ x: 0.5, y: 0 }}
          />
          <Sprite
            source={assets.get(mossyCavern2Assets.world.hangingPlants)}
            x={2_200}
            y={40}
            scale={0.31}
            opacity={0.64}
            anchor={{ x: 0.5, y: 0 }}
          />
        </GameLayer2D>

        <TileMapLayer2D
          map={mossyCavern2TileMap}
          layer="terrain"
          source={tileSource}
          width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
          height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
          overscan={2}
        />
        <TileMapLayer2D
          map={mossyCavern2TileMap}
          layer="shelves"
          source={tileSource}
          width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
          height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
          overscan={2}
        />

        <Decorations assets={assets} />
        <Shrine frame={frame} />

        <SpriteBatch<
          MossyCavern2Definition['scenes'],
          'expedition',
          MossyCavern2RelicSnapshot
        >
          scene="expedition"
          commit={frame}
          alpha={alpha}
          source={tileAtlas}
          capacity={3}
          anchor={{ x: 0.5, y: 0.5 }}
          select={({ current }) => {
            'worklet';
            return current.relics;
          }}
          write={(write, relic, index) => {
            'worklet';
            write.set(
              index,
              'relic',
              relic.body.x + relic.body.width / 2,
              relic.body.y + relic.body.height / 2,
              0,
              0.64,
              !relic.collected,
            );
          }}
          cull={
            camera === undefined
              ? undefined
              : {
                  camera,
                  viewport,
                  padding: 64,
                  bounds: (relic) => {
                    'worklet';
                    return relic.body;
                  },
                }
          }
        />

        <SlimeBatch
          frame={frame}
          alpha={alpha}
          camera={camera}
          viewport={viewport}
          source={assets.get(mossyCavern2Assets.world.slimeGreen)}
          hue="green"
        />
        <SlimeBatch
          frame={frame}
          alpha={alpha}
          camera={camera}
          viewport={viewport}
          source={assets.get(mossyCavern2Assets.world.slimeOrange)}
          hue="orange"
        />

        <WizardPose
          frame={frame}
          alpha={alpha}
          source={assets.get(mossyCavern2Assets.world.wizardIdle)}
          pose="idle"
        />
        <WizardPose
          frame={frame}
          alpha={alpha}
          source={assets.get(mossyCavern2Assets.world.wizardWalk)}
          pose="walk"
        />
        <WizardPose
          frame={frame}
          alpha={alpha}
          source={assets.get(mossyCavern2Assets.world.wizardJump)}
          pose="jump"
        />
        <WizardPose
          frame={frame}
          alpha={alpha}
          source={assets.get(mossyCavern2Assets.world.wizardDash)}
          pose="dash"
        />

        <MossyCavernParticles presentation={presentation} system={particleSystem} />
      </GameWorld2D>
    </>
  );
}

function Decorations({
  assets,
}: {
  readonly assets: NonNullable<RendererProps['assets']>;
}) {
  return (
    <Group>
      <Sprite
        source={assets.get(mossyCavern2Assets.world.floatingPlatforms)}
        x={980}
        y={730}
        scale={0.26}
        opacity={0.72}
        anchor={{ x: 0.5, y: 0.5 }}
      />
      <Sprite
        source={assets.get(mossyCavern2Assets.world.floatingPlatforms)}
        x={2_560}
        y={690}
        scale={0.26}
        opacity={0.72}
        anchor={{ x: 0.5, y: 0.5 }}
      />
      <Sprite
        source={assets.get(mossyCavern2Assets.world.decorationsHazards)}
        x={1_960}
        y={846}
        scale={0.2}
        opacity={0.33}
        anchor={{ x: 0.5, y: 1 }}
      />
      <Sprite
        source={assets.get(mossyCavern2Assets.world.windPlant)}
        x={520}
        y={960}
        scale={0.16}
        anchor={{ x: 0.5, y: 1 }}
      />
      <Sprite
        source={assets.get(mossyCavern2Assets.world.windPlant)}
        x={1_330}
        y={960}
        scale={0.16}
        anchor={{ x: 0.5, y: 1 }}
      />
      {mossyCavern2Hazards.map((hazard) => (
        <Sprite
          key={`${hazard.x}-${hazard.y}`}
          source={assets.get(mossyCavern2Assets.world.poisonPlant)}
          x={hazard.x + hazard.width / 2}
          y={hazard.y + hazard.height}
          scale={0.13}
          anchor={{ x: 0.5, y: 1 }}
        />
      ))}
    </Group>
  );
}

function Shrine({ frame }: { readonly frame: RendererProps['frame'] }) {
  const completionOpacity = useDerivedValue(() => {
    'worklet';
    const commit = frame.value;
    if (commit.scene !== 'expedition') return 0.22;
    return commit.current.status === 'complete' ? 0.92 : 0.28;
  });
  return (
    <Group>
      <Circle cx={MOSSY_CAVERN_2_CONFIG.gateX + 36} cy={902} r={56} color="#a7eb69" opacity={completionOpacity} />
      <RoundedRect
        x={MOSSY_CAVERN_2_CONFIG.gateX}
        y={826}
        width={72}
        height={134}
        r={18}
        color="#315239"
      />
      <RoundedRect
        x={MOSSY_CAVERN_2_CONFIG.gateX + 18}
        y={850}
        width={36}
        height={110}
        r={12}
        color="#94ce62"
        opacity={completionOpacity}
      />
    </Group>
  );
}

function SlimeBatch({
  frame,
  alpha,
  camera,
  viewport,
  source,
  hue,
}: {
  readonly frame: RendererProps['frame'];
  readonly alpha: RendererProps['alpha'];
  readonly camera: RendererProps['camera'];
  readonly viewport: RendererProps['viewport'];
  readonly source: LoadedImage;
  readonly hue: 'green' | 'orange';
}) {
  return (
    <SpriteBatch<
      MossyCavern2Definition['scenes'],
      'expedition',
      MossyCavern2SlimeSnapshot
    >
      scene="expedition"
      commit={frame}
      alpha={alpha}
      source={source}
      capacity={4}
      anchor={{ x: 0.5, y: 1 }}
      select={({ current }) => {
        'worklet';
        return hue === 'green' ? current.greenSlimes : current.orangeSlimes;
      }}
      write={(write, slime, index) => {
        'worklet';
        write.set(
          index,
          'full',
          slime.body.x + slime.body.width / 2,
          slime.body.y + slime.body.height,
          0,
          0.15,
          slime.alive,
        );
      }}
      cull={
        camera === undefined
          ? undefined
          : {
              camera,
              viewport,
              padding: 80,
              bounds: (slime) => {
                'worklet';
                return slime.body;
              },
            }
      }
    />
  );
}

function WizardPose({
  frame,
  alpha,
  source,
  pose,
}: {
  readonly frame: RendererProps['frame'];
  readonly alpha: RendererProps['alpha'];
  readonly source: LoadedImage;
  readonly pose: 'idle' | 'walk' | 'jump' | 'dash';
}) {
  return (
    <GameSprite<MossyCavern2Definition['scenes'], 'expedition'>
      scene="expedition"
      commit={frame}
      alpha={alpha}
      source={source}
      anchor={{ x: 0.5, y: 1 }}
      select={({ previous, current, alpha: t }) => {
        'worklet';
        const previousBody = previous.player.body;
        const currentBody = current.player.body;
        const invulnerable = current.player.invulnerableRemaining > 0;
        const flicker = Math.floor(current.elapsedSeconds * 14) % 2 === 0;
        return {
          x:
            previousBody.x + previousBody.width / 2 +
            (currentBody.x + currentBody.width / 2 - (previousBody.x + previousBody.width / 2)) * t,
          y: previousBody.y + previousBody.height + (currentBody.y + currentBody.height - (previousBody.y + previousBody.height)) * t,
          scale: pose === 'dash' ? 0.24 : 0.21,
          flipX: current.player.facing === 'left',
          opacity: pose === 'dash' ? 1 : 0.96,
          visible: current.player.pose === pose && (!invulnerable || flicker),
        };
      }}
    />
  );
}

function MossyCavernParticles({ presentation, system }: {
  readonly presentation: ParticlePresentation;
  readonly system: MossyCavern2ParticleSystem;
}) {
  return (
    <Group>
      <ParticleView
        system={system}
        effect="dust"
        width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
        height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
        presentation={presentation}
      />
      <ParticleView
        system={system}
        effect="dash"
        width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
        height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
        presentation={presentation}
      />
      <ParticleView
        system={system}
        effect="relic"
        width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
        height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
        presentation={presentation}
      />
      <ParticleView
        system={system}
        effect="slime"
        width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
        height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
        presentation={presentation}
      />
      <ParticleView
        system={system}
        effect="damage"
        width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
        height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
        presentation={presentation}
      />
      <ParticleView
        system={system}
        effect="completion"
        width={MOSSY_CAVERN_2_CONFIG.logicalWidth}
        height={MOSSY_CAVERN_2_CONFIG.logicalHeight}
        presentation={presentation}
      />
    </Group>
  );
}
