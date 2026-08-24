import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

function host(tag: string) {
  const C = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (C as { displayName?: string }).displayName = tag;
  return C;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    ActivityIndicator: host('activity-indicator'),
    StyleSheet: {
      create: (s: Record<string, unknown>) => s,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  },
});

let AssetGateOverlay: typeof import('./AssetGateOverlay')['AssetGateOverlay'];

before(async () => {
  const mod = await import('./AssetGateOverlay.tsx');
  AssetGateOverlay = mod.AssetGateOverlay;
});

describe('AssetGateOverlay (T16-SF3)', () => {
  it('shows loading spinner when assetState is loading', async () => {
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(AssetGateOverlay as never, {
          gameId: 'platformer-lab',
          assetState: { status: 'loading', progress: 0.5, retry: () => {}, requestKey: 'test' } as never,
          onExit: () => {},
        } as never),
      );
    });
    const root = renderer!.root;
    assert.ok(root.findAll((n: any) => n.props?.testID === 'asset-gate-overlay').length > 0);
    assert.ok(root.findAll((n: any) => n.props?.testID === 'asset-gate-loading').length > 0);
    assert.equal(root.findAll((n: any) => n.props?.testID === 'asset-gate-error').length, 0);
  });

  it('shows error and retry when assetState is error', async () => {
    let retried = false;
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(AssetGateOverlay as never, {
          gameId: 'platformer-lab',
          assetState: {
            status: 'error',
            error: new Error('network failed'),
            retry: () => { retried = true; },
            requestKey: 'test',
          } as never,
          onExit: () => {},
        } as never),
      );
    });
    const root = renderer!.root;
    assert.ok(root.findAll((n: any) => n.props?.testID === 'asset-gate-error').length > 0);
    const retryBtn = root.findAll((n: any) => n.props?.testID === 'asset-gate-retry')[0]!;
    (retryBtn.props as { onPress: () => void }).onPress();
    assert.equal(retried, true, 'retry calls the active request retry');
  });

  it('back is always usable', async () => {
    let exited = false;
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(AssetGateOverlay as never, {
          gameId: 'platformer-lab',
          assetState: { status: 'loading', progress: 0, retry: () => {}, requestKey: 'x' } as never,
          onExit: () => { exited = true; },
        } as never),
      );
    });
    const back = renderer!.root.findAll((n: any) => n.props?.testID === 'asset-gate-back')[0]!;
    (back.props as { onPress: () => void }).onPress();
    assert.equal(exited, true);
  });
});
