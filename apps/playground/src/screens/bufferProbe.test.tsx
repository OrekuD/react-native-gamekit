/** Probe wiring tests. These prove isolation and inputs, never native redraw. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { before, describe, it, mock } from 'node:test';
import * as React from 'react';
import { act, create } from 'react-test-renderer';

(globalThis as Record<string, unknown>).React ??= React;
for (const extension of ['.png'] as const) {
  (Module as unknown as {
    _extensions: Record<string, (module: { exports: unknown }) => void>;
  })._extensions[extension] = (module) => { module.exports = 42; };
}

function host(tag: string) {
  const Component = ({ children, ...props }: Record<string, unknown>) =>
    React.createElement(tag, props, children as React.ReactNode);
  Component.displayName = tag;
  return Component;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'), Text: host('text'), Pressable: host('pressable'),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  },
});
mock.module('react-native-safe-area-context', {
  namedExports: { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
});
mock.module('@shopify/react-native-skia', {
  namedExports: { Canvas: host('canvas'), Group: host('group') },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => React.useState(() => ({
      value: initial,
      set(value: unknown) { this.value = value; },
    }))[0],
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  },
});

let ready = false;
let renders = 0;
let mounts = 0;
const image = { nativeImage: true };
const frames = {
  ground: { x: 0, y: 0, width: 32, height: 32 },
  brick: { x: 32, y: 0, width: 32, height: 32 },
};
const source = { descriptor: { kind: 'sprite-sheet' }, width: 64, height: 32, frames, image };
let Screen: (typeof import('./buffer-probe/BufferProbeScreen'))['default'];

before(async () => {
  const { GameWorldContext } = await import(
    '../../../../packages/gamekit/src/react/sprites/GameWorld2D.tsx'
  );
  function renderer(tag: string) {
    const Component = (props: Record<string, unknown>) => {
      renders += 1;
      React.useEffect(() => { mounts += 1; }, []);
      const world = React.useContext(GameWorldContext);
      return React.createElement(tag, { ...props, world });
    };
    Component.displayName = tag;
    return Component;
  }
  mock.module('rn-gamekit/react', {
    namedExports: {
      GameWorld2D: host('world'),
      useParticlePresentation: () => ({ clock: { value: 0 }, registry: { value: {} } }),
      SpriteBatch: renderer('sprite-batch'),
      TileMapLayer2D: renderer('tile-layer'),
      ParticleView: renderer('particle-view'),
      useGameAssets: () => ({ status: ready ? 'ready' : 'loading', assets: { get: () => source } }),
    },
  });
  Screen = (await import('./buffer-probe/BufferProbeScreen.tsx')).default;
});

function byTag(tree: ReturnType<typeof create>, tag: string) {
  return tree.root.findAll((node) => node.type === tag);
}

async function press(tree: ReturnType<typeof create>, id: string) {
  await act(() => {
    tree.root.findAll((node) => String(node.type) === 'pressable' && node.props.testID === id)[0]!.props.onPress();
  });
}

describe('Buffer Probe isolation', () => {
  it('uses one independent Canvas per renderer, static transforms, and the native image', async () => {
    ready = false;
    let tree!: ReturnType<typeof create>;
    const element = () => React.createElement(Screen, { onExit() {} } as never);
    await act(() => { tree = create(element()); });
    assert.equal(byTag(tree, 'sprite-batch').length, 0);
    ready = true;
    try {
      await act(() => { tree.update(element()); });
      const canvases = byTag(tree, 'canvas');
      assert.equal(canvases.length, 3, 'another renderer cannot force this Canvas to redraw');
      for (const canvas of canvases) {
        assert.equal(canvas.findAll((node) => ['sprite-batch', 'tile-layer', 'particle-view'].includes(String(node.type))).length, 1);
      }
      assert.equal(byTag(tree, 'group').length, 0, 'no changing viewport-derived transform');
      const particle = byTag(tree, 'particle-view')[0]!;
      assert.equal(particle.props.spriteSource.image, image, 'pass the decoded image, not its asset wrapper');
      const tile = byTag(tree, 'tile-layer')[0]!;
      assert.equal(tile.props.world.camera, undefined, 'stationary camera');
      assert.equal(tile.props.world.viewport.value.scale, 1);
    } finally {
      await act(() => tree.unmount());
    }
  });

  it('changes only shared inputs through deterministic phases and survives rerender/remount', async () => {
    ready = true;
    let tree!: ReturnType<typeof create>;
    await act(() => { tree = create(React.createElement(Screen, { onExit() {} } as never)); });
    try {
      const batch = byTag(tree, 'sprite-batch')[0]!.props;
      const tile = byTag(tree, 'tile-layer')[0]!.props;
      const particle = byTag(tree, 'particle-view')[0]!.props;
      const startRenders = renders;
      const startMounts = mounts;
      const selected = () => batch.select({ current: batch.commit.value.current, alpha: 0 });
      await press(tree, 'buffer-probe-initial');
      assert.deepEqual(selected().map((item: { x: number }) => item.x), [32, 96, 160]);
      assert.equal(tile.world.viewport.value.visibleLogicalBounds.x, 0);
      await press(tree, 'buffer-probe-move');
      assert.deepEqual(selected().map((item: { x: number }) => item.x), [128, 192, 256]);
      assert.equal(tile.world.viewport.value.visibleLogicalBounds.x, 128);
      let emission = particle.presentation.registry.value.effects.puff.particles[0];
      assert.equal(particle.presentation.clock.value - emission.bornAt, 1);
      assert.equal(particle.system.getActiveParticles('puff')[0].position.x, 104);
      assert.equal(particle.system.getActiveParticles('puff')[0].opacity, 0.75);
      await press(tree, 'buffer-probe-move');
      assert.equal(particle.system.getActiveParticles('puff')[0].position.x, 104, 'repeating a phase is deterministic');
      await press(tree, 'buffer-probe-hide');
      assert.equal(selected().length, 0);
      assert.equal(particle.presentation.registry.value.effects.puff.particles.length, 0);
      assert.equal(tile.world.viewport.value.visibleLogicalBounds.x, 640);
      await press(tree, 'buffer-probe-reappear');
      assert.equal(selected().length, 3);
      assert.ok(selected().every((item: { frame: string }) => item.frame === 'brick'));
      assert.equal(tile.world.viewport.value.visibleLogicalBounds.x, 64);
      await press(tree, 'buffer-probe-fade');
      emission = particle.presentation.registry.value.effects.puff.particles[0];
      assert.equal(particle.presentation.clock.value - emission.bornAt, 3);
      assert.equal(particle.system.getActiveParticles('puff')[0].position.x, 184);
      assert.equal(particle.system.getActiveParticles('puff')[0].opacity, 0.25);
      assert.equal(renders, startRenders, 'phase changes do not rerender React');
      assert.equal(mounts, startMounts, 'slot topology stays mounted');
      const commit = batch.commit.value;
      await press(tree, 'buffer-probe-rerender');
      assert.equal(byTag(tree, 'sprite-batch')[0]!.props.commit.value, commit);
      assert.equal(mounts, startMounts);
      await press(tree, 'buffer-probe-remount');
      assert.equal(mounts, startMounts + 3);
      assert.equal(byTag(tree, 'sprite-batch')[0]!.props.commit.value, commit);
      assert.equal(particle.system.status, 'running');
    } finally {
      const system = byTag(tree, 'particle-view')[0]!.props.system;
      await act(() => tree.unmount());
      assert.equal(system.status, 'disposed');
    }
  });
});
